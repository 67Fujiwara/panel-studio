/**
 * 部品表・設定・My部品を**このブラウザに残す**（立ち上げ直したときに戻す）。
 *
 * これまで完了案件と作業中案件は localStorage に残していたが、部品表と設定は
 * メモリにしか無く、閉じると初期の21件に戻っていた。**登録した部品が毎回消える**のは
 * 使い物にならないので、ここで残す。
 *
 * 置き場所は IndexedDB。localStorage は 5MB 前後で頭打ちで、部品に外形（DXF から
 * 起こした形）を持たせると部品表だけで数 MB になり入り切らない。IndexedDB なら
 * 文字列にせず構造のまま入れられ、上限も桁違いに大きい。
 *
 * 書くのは中身が変わって少し止まってから（1秒）。バックアップ先フォルダへの
 * 書き出し（backup.ts）とは別で、こちらは**同じ PC で開き直したときのため**、
 * あちらは**別の PC へ持っていく・壊れたときに戻すため**。
 *
 * ⚠ API キーは残さない。キーは panel-studio.ai（localStorage）だけに置き、ここには入れない。
 */
import type { ConfigFile, MyConfigFile } from '../store';
import { useStore } from '../store';

const DB = 'panel-studio-state';
const STORE = 'kv';
const CONFIG_KEY = 'config';
const MY_KEY = 'my';
/** 変更が止まってから書くまで(ms) */
const DEBOUNCE_MS = 1000;
/** 起動時の読み込みをこれ以上待たない(ms)。IndexedDB が固まっても画面は出す */
const HYDRATE_TIMEOUT_MS = 4000;

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

/**
 * 起動時に呼ぶ。残してあるものをストアへ戻してから、以後の変更を見張って書き続ける。
 *
 * **戻し終えるまで見張りを始めない**のが要点。先に見張ると、初期の21件が
 * 「変更」として残してある部品表の上に書かれ、せっかくのものが消える。
 */
export async function startPersisting(): Promise<void> {
  if (!available()) return;

  // 1) 戻す。長くても HYDRATE_TIMEOUT_MS で切り上げて画面を出す
  const timeout = new Promise<{ config: null; my: null }>((r) =>
    setTimeout(() => r({ config: null, my: null }), HYDRATE_TIMEOUT_MS),
  );
  const saved = await Promise.race([loadPersisted(), timeout]);
  const s = useStore.getState();
  if (saved.config) s.loadConfig(saved.config);
  if (saved.my) s.loadMyConfig(saved.my);

  // 2) 見張る。どちらが変わったかで書き分ける（部品表は大きいので My部品のたびに書かない）
  let cfgTimer: ReturnType<typeof setTimeout> | null = null;
  let myTimer: ReturnType<typeof setTimeout> | null = null;
  const write = (key: string, value: unknown) =>
    idb('readwrite', (st) => st.put(value, key)).catch(() => {
      /* 書けなくてもこのセッションは動く。次の変更でまた試す */
    });
  useStore.subscribe((now, before) => {
    if (
      now.categories !== before.categories ||
      now.devices !== before.devices ||
      now.profile !== before.profile ||
      now.enclosures !== before.enclosures ||
      now.ducts !== before.ducts ||
      now.prices !== before.prices
    ) {
      if (cfgTimer) clearTimeout(cfgTimer);
      cfgTimer = setTimeout(() => void write(CONFIG_KEY, snapshotConfig()), DEBOUNCE_MS);
    }
    if (now.owners !== before.owners || now.myDevices !== before.myDevices) {
      if (myTimer) clearTimeout(myTimer);
      myTimer = setTimeout(() => void write(MY_KEY, snapshotMy()), DEBOUNCE_MS);
    }
  });
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
  });
}
