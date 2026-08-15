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

/** 書き出すファイル名。中身ごとに分けて、片方が壊れても片方は読めるようにする。 */
export const BACKUP_FILES = {
  config: 'panel-studio-settings.json',
  my: 'panel-studio-myparts.json',
  projects: 'panel-studio-projects.json',
} as const;

export type BackupKind = keyof typeof BACKUP_FILES;

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
};

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
 */
export class BackupWriter {
  private dir: FileSystemDirectoryHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = new Set<BackupKind>();
  private busy = false;

  constructor(
    /** 書き出す中身を取り出す。呼ばれた時点の最新を返すこと */
    private readonly snapshot: (kind: BackupKind) => unknown,
    /** 状態が変わったら知らせる（画面の帯の更新用） */
    private readonly onChange: (patch: Partial<BackupState>) => void,
    /** 変更が止まってから書くまでの待ち時間(ms) */
    private readonly debounceMs = 3000,
    /** 変更が続いていても、この間隔では必ず書く(ms) */
    private readonly periodMs = 60000,
  ) {}

  setDir(dir: FileSystemDirectoryHandle | null) {
    this.dir = dir;
    this.onChange({ dirName: dir?.name ?? null, error: null });
    // フォルダを決めた時点で、いまの中身をひととおり書いておく
    if (dir) this.mark('config', 'my', 'projects');
  }

  hasDir() {
    return this.dir !== null;
  }

  /** 中身が変わったことを伝える。実際の書き出しはまとめて後で。 */
  mark(...kinds: BackupKind[]) {
    for (const k of kinds) this.dirty.add(k);
    if (!this.dir || this.dirty.size === 0) return;
    this.onChange({ pending: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** 溜まっているぶんをいますぐ書く。 */
  async flush(): Promise<void> {
    if (!this.dir || this.busy || this.dirty.size === 0) return;
    this.busy = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const kinds = [...this.dirty];
    this.dirty.clear();
    try {
      if (!(await ensurePermission(this.dir, false))) {
        // 再読み込み後などで許可が切れている。人がボタンを押すまで待つ
        throw new Error('フォルダへの書き込み許可が切れています。選び直してください。');
      }
      for (const k of kinds) {
        await writeFile(this.dir, BACKUP_FILES[k], JSON.stringify(this.snapshot(k), null, 2));
      }
      this.onChange({ lastAt: Date.now(), error: null, pending: false });
    } catch (e) {
      // 失敗したぶんは次にもう一度書く
      for (const k of kinds) this.dirty.add(k);
      this.onChange({ error: e instanceof Error ? e.message : String(e), pending: true });
    } finally {
      this.busy = false;
    }
  }

  /** 一定間隔での書き出しを始める。溜まっていなければ何もしない。 */
  startTimer(): () => void {
    const id = setInterval(() => void this.flush(), this.periodMs);
    return () => clearInterval(id);
  }
}
