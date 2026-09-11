/**
 * 「このブラウザに残す」係。起動時に戻し、以後は変わるたびに残す。
 *
 * 残すもの:
 *  - 部品表・設定・My部品 …… IndexedDB（数 MB になるので localStorage には入らない）
 *  - いまの机（設計中のレイアウト）…… 作業中案件へ自動でしまう（localStorage）。
 *    これまでは切り替え・新規のときだけしまっていたので、閉じると机の上が消えていた。
 *    変更が止まって1秒でしまい、次に開いたときは同じ案件を机に戻す
 *  - 外形線の軽量化 …… 部品表が変わるたびに、まだ軽くしていないものだけ軽くする。
 *    済みの印（shape.lite）で見分けるので、2回目以降はほぼ何もしない
 *
 * 戻す元は2つ:
 *  1. IndexedDB（同じ PC で開き直したとき）
 *  2. 共有フォルダの写し panel-studio-backup.js（ブラウザの中身が消えていた・別の PC で開いたとき）。
 *     file:// の HTML は隣のファイルを fetch できないが script としてなら読めるので、
 *     バックアップ係が JSON と一緒に script 形式の写しも書いておき、起動時に読む。
 *     ブラウザに何も残っていなければ黙って戻し、残っているのに写しのほうが新しければ
 *     （別の PC で書かれた）帯で知らせて、人が読むかどうかを決める。
 *
 * localStorage は 5MB 前後で頭打ち。部品に外形（DXF から起こした形）を持たせると
 * 部品表だけで数 MB になり入り切らない。IndexedDB なら文字列にせず構造のまま入れられ、
 * 上限も桁違いに大きい。
 *
 * バックアップ先フォルダへの書き出し（backup.ts）とは別で、こちらは**同じ PC で
 * 開き直したときのため**、あちらは**別の PC へ持っていく・壊れたときに戻すため**。
 *
 * ⚠ API キーは残さない。キーは panel-studio.ai（localStorage）だけに置き、ここには入れない。
 */
import type { ConfigFile, MyConfigFile } from '../store';
import { isBundle, loadBundle, useStore } from '../store';
import { loadBackupSeen, loadSidecar } from './backup';
import { liteMasters } from './liteMasters';

const DB = 'panel-studio-state';
const STORE = 'kv';
const CONFIG_KEY = 'config';
const MY_KEY = 'my';
/** 机に出している作業中案件の id（localStorage） */
const CURRENT_DRAFT_KEY = 'panel-studio.current-draft';
/** 変更が止まってから書くまで(ms) */
const DEBOUNCE_MS = 1000;
/** 起動時の読み込みをこれ以上待たない(ms)。IndexedDB が固まっても画面は出す */
const HYDRATE_TIMEOUT_MS = 15000;
/** 共有フォルダの写しを待つ上限(ms)。数 MB を共有フォルダから読むぶん長めに */
const SIDECAR_TIMEOUT_MS = 20000;

/**
 * 起動時に何をどこから戻したか。帯（BackupBar）が「ブラウザが空だったからフォルダから戻す」
 * の判断に使う。
 */
export const persistInfo = {
  /** IndexedDB に部品表・設定が残っていて、それを戻した */
  fromBrowser: false,
  /** 共有フォルダの写し（panel-studio-backup.js）から戻した */
  fromSidecar: false,
  /** 起動時の戻しが済んだ（これより前に IndexedDB へ書くと、残してあるものを既定値で潰す） */
  settled: false,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

const available = () => typeof indexedDB !== 'undefined';

/** 残してある部品表・設定と My部品。無ければ null。 */
export async function loadPersisted(): Promise<{ config: ConfigFile | null; my: MyConfigFile | null }> {
  if (!available()) return { config: null, my: null };
  try {
    const [config, my] = await Promise.all([
      idb<ConfigFile | undefined>('readonly', (s) => s.get(CONFIG_KEY)),
      idb<MyConfigFile | undefined>('readonly', (s) => s.get(MY_KEY)),
    ]);
    return {
      config: config && config.schemaVersion === 1 ? config : null,
      my: my && my.schemaVersion === 1 ? my : null,
    };
  } catch {
    return { config: null, my: null };
  }
}

function snapshotConfig(): ConfigFile {
  const s = useStore.getState();
  return {
    schemaVersion: 1,
    categories: s.categories,
    devices: s.devices,
    profile: s.profile,
    enclosures: s.enclosures,
    ducts: s.ducts,
    prices: s.prices,
  };
}

function snapshotMy(): MyConfigFile {
  const s = useStore.getState();
  return { schemaVersion: 1, owners: s.owners, devices: s.myDevices };
}

const readCurrentDraft = (): string | null => {
  try {
    return localStorage.getItem(CURRENT_DRAFT_KEY);
  } catch {
    return null;
  }
};
const writeCurrentDraft = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CURRENT_DRAFT_KEY, id);
    else localStorage.removeItem(CURRENT_DRAFT_KEY);
  } catch {
    /* 覚えられなくても致命ではない */
  }
};

/** 上限つきで待つ。過ぎたら fallback を返すが、元の Promise は捨てない（遅れて来た結果も使える） */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/**
 * 起動時に呼ぶ。残してあるものをストアへ戻してから、以後の変更を見張って書き続ける。
 *
 * **戻し終えるまで見張りを始めない**のが要点。先に見張ると、初期の21件が
 * 「変更」として残してある部品表の上に書かれ、せっかくのものが消える。
 */
export async function startPersisting(): Promise<void> {
  // 共有フォルダの写しは読むのに時間がかかることがあるので、先に読み始めておく
  const sidecarP = loadSidecar(SIDECAR_TIMEOUT_MS).catch(() => null);

  // 1) 部品表・設定・My部品を IndexedDB から戻す。長くても HYDRATE_TIMEOUT_MS で切り上げて画面を出す
  let hydrateLate: Promise<{ config: ConfigFile | null; my: MyConfigFile | null }> | null = null;
  if (available()) {
    type Loaded = { config: ConfigFile | null; my: MyConfigFile | null; timedOut?: boolean };
    const p: Promise<Loaded> = loadPersisted();
    const saved = await withTimeout<Loaded>(p, HYDRATE_TIMEOUT_MS, { config: null, my: null, timedOut: true });
    const s = useStore.getState();
    if (saved.config) s.loadConfig(saved.config);
    if (saved.my) s.loadMyConfig(saved.my);
    persistInfo.fromBrowser = Boolean(saved.config || saved.my);
    // 時間切れなら、遅れて来た結果を待って（人がまだ触っていなければ）あとから戻す
    if (saved.timedOut) hydrateLate = p;
  }

  // 2) ブラウザに何も残っていなければ、共有フォルダの写しから戻す（新しい PC・消えたブラウザ）。
  //    残っていれば待たずに先へ進み、写しのほうが新しいときだけあとで知らせる
  if (!persistInfo.fromBrowser && !hydrateLate) {
    const sc = await sidecarP;
    if (isBundle(sc)) {
      loadBundle(sc);
      persistInfo.fromSidecar = true;
    }
  } else {
    void sidecarP.then((sc) => {
      if (!isBundle(sc) || !sc.savedAt) return;
      if (sc.savedAt > loadBackupSeen()) useStore.getState().setNewerBackup({ savedAt: sc.savedAt, bundle: sc });
    });
  }

  // 3) 机に出していた作業中案件を戻す（机は白紙なので、しまう側は何も起きない）
  {
    const id = readCurrentDraft();
    const s = useStore.getState();
    if (id && s.drafts.some((d) => d.id === id)) s.switchDraft(id);
  }

  // 4) 見張る（外形線の軽量化は見張りを付けてから。軽くした結果を IndexedDB へ書くのは見張り側）
  let cfgTimer: ReturnType<typeof setTimeout> | null = null;
  let myTimer: ReturnType<typeof setTimeout> | null = null;
  let deskTimer: ReturnType<typeof setTimeout> | null = null;
  let liteTimer: ReturnType<typeof setTimeout> | null = null;
  /** 人が部品表・設定に触ったか。時間切れのあと遅れて来た IndexedDB の中身を当てていいかの判断用 */
  let touched = false;
  const write = (key: string, value: unknown) =>
    available() && persistInfo.settled
      ? idb('readwrite', (st) => st.put(value, key)).catch(() => {
          /* 書けなくてもこのセッションは動く。次の変更でまた試す */
        })
      : Promise.resolve();

  useStore.subscribe((now, before) => {
    // 部品表・設定（大きいので My部品とは別に書く）
    if (
      now.categories !== before.categories ||
      now.devices !== before.devices ||
      now.profile !== before.profile ||
      now.enclosures !== before.enclosures ||
      now.ducts !== before.ducts ||
      now.prices !== before.prices
    ) {
      touched = true;
      if (cfgTimer) clearTimeout(cfgTimer);
      cfgTimer = setTimeout(() => void write(CONFIG_KEY, snapshotConfig()), DEBOUNCE_MS);
    }
    if (now.owners !== before.owners || now.myDevices !== before.myDevices) {
      touched = true;
      if (myTimer) clearTimeout(myTimer);
      myTimer = setTimeout(() => void write(MY_KEY, snapshotMy()), DEBOUNCE_MS);
    }
    // 部品表が入れ替わったら（読み込み・復元）、軽くしていない外形線を軽くする
    if (now.devices !== before.devices || now.myDevices !== before.myDevices) {
      if (liteTimer) clearTimeout(liteTimer);
      liteTimer = setTimeout(() => liteMasters(), DEBOUNCE_MS);
    }
    // 机の上（設計中のレイアウト）は作業中案件へ自動でしまう
    if (
      now.items !== before.items ||
      now.pinned !== before.pinned ||
      now.machining !== before.machining ||
      now.panel !== before.panel ||
      now.profile !== before.profile ||
      now.removedDucts !== before.removedDucts ||
      now.underlays !== before.underlays ||
      now.face !== before.face
    ) {
      if (deskTimer) clearTimeout(deskTimer);
      deskTimer = setTimeout(() => useStore.getState().autoStash(), DEBOUNCE_MS);
    }
    if (now.currentDraftId !== before.currentDraftId) writeCurrentDraft(now.currentDraftId);
  });

  if (hydrateLate) {
    /*
     * IndexedDB が時間切れだったとき。結果が来るまで IndexedDB へは書かない（settled=false）。
     * 来たら、人がまだ触っていなければそれを戻す。触っていれば人の側を採る
     * （既定値の上に部品を足した・一括読み込みした、など。それを消すほうが痛い）
     */
    void hydrateLate.then((saved) => {
      const s = useStore.getState();
      if (!touched) {
        if (saved.config) s.loadConfig(saved.config);
        if (saved.my) s.loadMyConfig(saved.my);
        persistInfo.fromBrowser = Boolean(saved.config || saved.my);
      }
      persistInfo.settled = true;
      // 触っていたぶんは、settled になったいま書く
      if (touched) {
        void write(CONFIG_KEY, snapshotConfig());
        void write(MY_KEY, snapshotMy());
      }
      liteMasters();
    });
  } else {
    persistInfo.settled = true;
    // 写しから戻したぶんは、まだ IndexedDB に無いのでここで書いておく
    if (persistInfo.fromSidecar) {
      void write(CONFIG_KEY, snapshotConfig());
      void write(MY_KEY, snapshotMy());
    }
  }

  // 5) 外形線をまだ軽くしていないものは、ここで一度だけ軽くする（旧データの取り込み分）。
  //    見張りを付けたあとなので、軽くした結果はそのまま IndexedDB へ書かれる
  liteMasters();

  // 閉じる直前の取りこぼしを拾う（待ち中のものがあればその場で書く）
  window.addEventListener('pagehide', () => {
    if (cfgTimer) {
      clearTimeout(cfgTimer);
      cfgTimer = null;
      void write(CONFIG_KEY, snapshotConfig());
    }
    if (myTimer) {
      clearTimeout(myTimer);
      myTimer = null;
      void write(MY_KEY, snapshotMy());
    }
    if (deskTimer) {
      clearTimeout(deskTimer);
      deskTimer = null;
      useStore.getState().autoStash();
    }
  });
}
