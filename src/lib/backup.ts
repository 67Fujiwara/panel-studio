/**
 * バックアップ先フォルダへの自動書き出し。
 *
 * このアプリのデータはブラウザの中（localStorage）にしかない。ブラウザの履歴を消したり、
 * PC を入れ替えたりすると、盤マスタも部品表も完了案件も一緒に消える。
 * かといって「書き出し（JSON）」を人が押して回るのは、押し忘れた日のぶんが消える運用になる。
 *
 * そこで **フォルダを1回だけ選んでもらい、あとは中身が変わるたびに勝手に書き出す**。
 * File System Access API のフォルダハンドルを IndexedDB に持っておくと、
 * 次に開いたときも同じフォルダに書き続けられる（localStorage には入らない型なので IndexedDB）。
 *
 * ⚠ API キーはここでも書き出さない。共有フォルダに置いたファイルからキーが漏れる。
 */

/**
 * 書き出すファイルは**全部入りの1つ**。以前は中身ごとに3ファイルへ分けていたが、
 * 「フォルダに何個もあって、どれを持っていけばいいのか分からない」ため1つにした。
 */
export const BACKUP_FILE = 'panel-studio-backup.json';

/**
 * 1つ前のバックアップ。
 *
 * 自動書き出しは同じファイルへ上書きするので、**間違って消した部品や壊れた状態も
 * そのまま上書きされる**。気づいたときには戻す先が無い、が実際に起きた。
 * 書く前に前の中身をこちらへ退避して、**1回分は戻せる**ようにする。
 *
 * ファイルは常にこの2つだけ。「フォルダに何個もあって分からない」は起こさない。
 */
export const BACKUP_PREV_FILE = 'panel-studio-backup.prev.json';

/** 旧版が書いていたファイル名。読み込み（復元）のときだけ使う。書くのはもうしない */
export const LEGACY_BACKUP_FILES = {
  config: 'panel-studio-settings.json',
  my: 'panel-studio-myparts.json',
  projects: 'panel-studio-projects.json',
} as const;

export type BackupKind = keyof typeof LEGACY_BACKUP_FILES;

/** バックアップの状態。画面の帯に出す。 */
export type BackupState = {
  /** フォルダを選べる環境か（Chrome 系のみ。Firefox / Safari には無い） */
  supported: boolean;
  /** 選んだフォルダの名前。未選択なら null */
  dirName: string | null;
  /** 最後に書けた時刻 */
  lastAt: number | null;
  /** 最後に失敗した理由。書けているあいだは null */
  error: string | null;
  /** 書き出し待ちの変更があるか */
  pending: boolean;
  /** いま書いている最中か。7MB 級だと数秒かかるので、押した手応えとして出す */
  writing: boolean;
};

/**
 * 自動で書き出すかどうかの覚え書き。
 *
 * 部品に外形（DXF から起こした形）を持たせると1ファイルが数 MB になる。
 * 変更のたびに書くと、その数 MB を JSON にして2回書き直すので手が止まる。
 * **手動にしておいて、区切りのいいところで「上書き保存」を押す**運用ができるようにする。
 */
const AUTO_KEY = 'panel-studio.backup-auto';

/** 既定は自動。書き忘れで消えるほうが痛いので、外すのは押した人の意思に任せる */
export function loadAutoFlag(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAutoFlag(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* 覚えられなくても、このセッション中は効く */
  }
}

export function fsAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// --- フォルダハンドルの保管（IndexedDB） ---

const DB = 'panel-studio';
const STORE = 'handles';
const KEY = 'backupDir';

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

/** 保存してあるフォルダハンドル。無ければ null。 */
export async function loadDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idb<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

async function saveDir(handle: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    await idb('readwrite', (s) => (handle ? s.put(handle, KEY) : s.delete(KEY)));
  } catch {
    // 保存できなくてもこのセッション中は書けるので、握って進む
  }
}

/**
 * 書き込みの許可を確かめる。
 * `withPrompt` が true のときだけ確認ダイアログを出す（クリックの流れの中でしか出せない）。
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  withPrompt: boolean,
): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const;
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  if (!withPrompt) return false;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

/** フォルダを選んでもらう。選ばれたら以後そこへ書く。 */
export async function pickDir(): Promise<FileSystemDirectoryHandle> {
  const show = window.showDirectoryPicker;
  if (!show) throw new Error('このブラウザはフォルダの指定に対応していません（Chrome / Edge が必要です）');
  const handle = await show.call(window, { mode: 'readwrite', id: 'panel-studio' });
  if (!(await ensurePermission(handle, true))) throw new Error('書き込みの許可がありません');
  await saveDir(handle);
  return handle;
}

export async function forgetDir(): Promise<void> {
  await saveDir(null);
}

/** 1ファイル書き出す。 */
export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(new Blob([text], { type: 'application/json' }));
  await w.close();
}

/** フォルダから1ファイル読む。無ければ null。 */
export async function readFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const file = await dir.getFileHandle(name);
    return await (await file.getFile()).text();
  } catch {
    return null;
  }
}

/**
 * 書き出しをまとめる係。
 *
 * 変更のたびに書くとキー入力1つでファイルを開き直すことになるので、
 * **少し待ってからまとめて書く**（打っている最中は書かない）。
 * 変更が続いても放置されないよう、上限の間隔でも書く。
 *
 * 自動を切ると、書くのは**人が「上書き保存」を押したときだけ**になる。
 * それでも閉じる直前には書く（押し忘れたぶんを捨てないため）。
 */
export class BackupWriter {
  private dir: FileSystemDirectoryHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = new Set<BackupKind>();
  private busy = false;
  private auto = true;
  /**
   * 最後に書いた中身。次に書くときの見比べ用。
   *
   * - 中身が同じなら書かない（同じ数 MB を書き直さない）
   * - 「1つ前」へ退避するとき、フォルダから読み直さずに済む
   */
  private lastText: string | null = null;

  constructor(
    /** 書き出す中身（全部入りの1ファイルぶん）を取り出す。呼ばれた時点の最新を返すこと */
    private readonly snapshot: () => unknown,
    /** 状態が変わったら知らせる（画面の帯の更新用） */
    private readonly onChange: (patch: Partial<BackupState>) => void,
    /** 変更が止まってから書くまでの待ち時間(ms) */
    private readonly debounceMs = 30000,
    /** 変更が続いていても、この間隔では必ず書く(ms) */
    private readonly periodMs = 300000,
  ) {}

  setDir(dir: FileSystemDirectoryHandle | null) {
    this.dir = dir;
    this.lastText = null;
    this.onChange({ dirName: dir?.name ?? null, error: null });
    // フォルダを決めた時点で、いまの中身をひととおり書いておく
    if (dir) this.mark('config', 'my', 'projects');
  }

  hasDir() {
    return this.dir !== null;
  }

  /** 自動書き出しの入切。切ったら待ち時間のタイマーも止める */
  setAuto(on: boolean) {
    this.auto = on;
    if (!on && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (on) this.mark();
  }

  /** 中身が変わったことを伝える。実際の書き出しはまとめて後で。 */
  mark(...kinds: BackupKind[]) {
    for (const k of kinds) this.dirty.add(k);
    if (!this.dir || this.dirty.size === 0) return;
    this.onChange({ pending: true });
    // 手動のときは印だけ付けて待つ。書くのはボタンか、閉じる直前
    if (!this.auto) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /**
   * 溜まっているぶんをいますぐ書く。
   *
   * `force` はボタンから押されたとき。溜まっていなくても中身を見に行き、
   * 同じなら書かずに時刻だけ更新する（押したのに無反応、を避ける）。
   */
  async flush(force = false): Promise<void> {
    if (!this.dir || this.busy) return;
    if (this.dirty.size === 0 && !force) return;
    this.busy = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const kinds = [...this.dirty];
    this.dirty.clear();
    this.onChange({ writing: true });
    try {
      if (!(await ensurePermission(this.dir, false))) {
        // 再読み込み後などで許可が切れている。人がボタンを押すまで待つ
        throw new Error('フォルダへの書き込み許可が切れています。選び直してください。');
      }
      // どこが変わっていても書くのは全部入りの1ファイル。kinds は「書く必要があるか」の印
      void kinds;
      /*
       * 整形（インデント）は付けない。外形線を持つ部品表だと整形だけで 4倍
       * （3.9MB → 16MB）になり、書くのも読むのも遅くなる。人が目で読むファイルではない
       */
      const text = JSON.stringify(this.snapshot());
      /*
       * 上書きする前に、いまフォルダにある中身を「1つ前」へ退避する。
       * 中身が同じときは動かさない（同じものを2つ持っても戻す先にならない）。
       * 退避に失敗しても本体の書き出しは続ける — 最新が書けないほうが困る。
       */
      const before = this.lastText ?? (await readFile(this.dir, BACKUP_FILE));
      if (before === text) {
        // 前と同じ。数 MB を書き直しても増えるものがないので、押した時刻だけ返す
        this.onChange({ lastAt: Date.now(), error: null, pending: false });
        return;
      }
      try {
        if (before !== null) await writeFile(this.dir, BACKUP_PREV_FILE, before);
      } catch {
        /* 退避できなくても最新は書く */
      }
      await writeFile(this.dir, BACKUP_FILE, text);
      this.lastText = text;
      this.onChange({ lastAt: Date.now(), error: null, pending: false });
    } catch (e) {
      // 失敗したぶんは次にもう一度書く
      for (const k of kinds) this.dirty.add(k);
      this.onChange({ error: e instanceof Error ? e.message : String(e), pending: true });
    } finally {
      this.busy = false;
      this.onChange({ writing: false });
    }
  }

  /** 一定間隔での書き出しを始める。溜まっていなければ何もしない。 */
  startTimer(): () => void {
    const id = setInterval(() => {
      if (this.auto) void this.flush();
    }, this.periodMs);
    return () => clearInterval(id);
  }
}
