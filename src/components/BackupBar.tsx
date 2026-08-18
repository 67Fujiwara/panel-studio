import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_FILES,
  BackupWriter,
  ensurePermission,
  fsAccessSupported,
  loadDir,
  pickDir,
  readFile,
  type BackupKind,
  type BackupState,
} from '../lib/backup';
import {
  hasSavedConfig,
  hasSavedMy,
  useStore,
  type ConfigFile,
  type MyConfigFile,
  type ProjectFile,
} from '../store';

/**
 * バックアップ先の帯。
 *
 * 「データはこのブラウザの中にしかない」ことを、決めるまでは出しっぱなしにする。
 * 消えてから気づく類の話なので、控えめに出しても意味がない。
 * 決めたあとは細い1行になり、最後に書けた時刻だけを出す。
 */
export function BackupBar() {
  const [state, setState] = useState<BackupState>({
    supported: fsAccessSupported(),
    dirName: null,
    lastAt: null,
    error: null,
    pending: false,
  });
  const [busy, setBusy] = useState(false);
  const writerRef = useRef<BackupWriter | null>(null);
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);

  // 書き出す中身はストアから直に取る。React の描画とは切り離しておきたいので getState を使う
  const snapshot = (kind: BackupKind): unknown => {
    const s = useStore.getState();
    if (kind === 'config') {
      const f: ConfigFile = {
        schemaVersion: 1,
        categories: s.categories,
        devices: s.devices,
        profile: s.profile,
        enclosures: s.enclosures,
        ducts: s.ducts,
        prices: s.prices,
      };
      return f;
    }
    if (kind === 'my') {
      const f: MyConfigFile = { schemaVersion: 1, owners: s.owners, devices: s.myDevices };
      return f;
    }
    const f: ProjectFile = { schemaVersion: 1, projects: s.projects };
    return f;
  };

  // 書き出し係を1つだけ作る。中身の変化を見張って、止まったところでまとめて書く
  useEffect(() => {
    const writer = new BackupWriter(snapshot, (patch) => setState((v) => ({ ...v, ...patch })));
    writerRef.current = writer;

    void (async () => {
      const dir = await loadDir();
      if (!dir) return;
      dirRef.current = dir;
      // 再読み込み直後は許可が「保留」になることがある。ここでは聞かず、名前だけ出す
      setState((v) => ({ ...v, dirName: dir.name }));
      if (await ensurePermission(dir, false)) {
        // 書く前に読む。新しい PC などブラウザ側が空のときは、
        // フォルダの中身を先に取り込まないと、空の状態で上書きしてしまう
        await restoreMissing(dir);
        writer.setDir(dir);
      } else
        setState((v) => ({
          ...v,
          error: '書き込みの許可を確かめてください（「許可し直す」を押す）',
        }));
    })();

    // どこが変わったかで書き分ける。案件の記録と部品表を毎回まとめて書き直さない
    const unsub = useStore.subscribe((now, before) => {
      const kinds: BackupKind[] = [];
      if (
        now.categories !== before.categories ||
        now.devices !== before.devices ||
        now.profile !== before.profile ||
        now.enclosures !== before.enclosures ||
        now.ducts !== before.ducts ||
        now.prices !== before.prices
      )
        kinds.push('config');
      if (now.owners !== before.owners || now.myDevices !== before.myDevices) kinds.push('my');
      if (now.projects !== before.projects) kinds.push('projects');
      if (kinds.length > 0) writer.mark(...kinds);
    });

    const stopTimer = writer.startTimer();
    // 閉じる前に取りこぼしを書く（この時点で書けなければ諦める）
    const onHide = () => void writer.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      unsub();
      stopTimer();
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  const choose = async () => {
    setBusy(true);
    try {
      const dir = await pickDir();
      dirRef.current = dir;
      // フォルダに既にファイルがあれば、そちらを取り込むか聞く。
      // 書き出し係を動かすのは取り込みが済んでから。先に動かすと、確認に
      // 時間をかけているあいだに空の状態でフォルダを上書きしてしまう
      await offerRestore(dir);
      writerRef.current?.setDir(dir);
    } catch (e) {
      // 選ぶのをやめただけなら黙って戻る
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setState((v) => ({ ...v, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const regrant = async () => {
    const dir = dirRef.current;
    if (!dir) return;
    setBusy(true);
    try {
      if (await ensurePermission(dir, true)) {
        // ここでも書く前に読む。ブラウザ側が空のままフォルダを上書きしない
        await restoreMissing(dir);
        writerRef.current?.setDir(dir);
        setState((v) => ({ ...v, error: null }));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!state.supported) {
    return (
      <div className="backupbar warn">
        <span className="mark">!</span>
        <span>
          データは<b>このブラウザの中だけ</b>に保存されています。このブラウザはバックアップ先の
          フォルダ指定に対応していないため、<b>Chrome か Edge で開いてください</b>
          （設定画面から手で書き出すこともできます）。
        </span>
      </div>
    );
  }

  if (!state.dirName) {
    return (
      <div className="backupbar warn">
        <span className="mark">!</span>
        <span>
          データは<b>このブラウザの中だけ</b>に保存されています。
          <b>バックアップ先フォルダ</b>を決めておくと、変わるたびに自動で書き出します。
        </span>
        <button className="primary" disabled={busy} onClick={() => void choose()}>
          バックアップ先を選ぶ
        </button>
      </div>
    );
  }

  return (
    <div className={`backupbar${state.error ? ' warn' : ' ok'}`}>
      <span className="mark">{state.error ? '!' : '✓'}</span>
      <span>
        バックアップ先: <b>{state.dirName}</b>
        {state.error ? (
          <em className="bad"> — {state.error}</em>
        ) : state.pending ? (
          <em> — 書き出し待ち…</em>
        ) : state.lastAt ? (
          <em> — 最終 {new Date(state.lastAt).toLocaleTimeString('ja-JP')}</em>
        ) : (
          <em> — 変更があれば自動で書き出します</em>
        )}
      </span>
      {state.error && (
        <button disabled={busy} onClick={() => void regrant()}>
          許可し直す
        </button>
      )}
      <button disabled={busy} onClick={() => void choose()}>
        変更
      </button>
    </div>
  );
}

/**
 * ブラウザ側に無いものだけ、バックアップ先から黙って取り込む。
 *
 * 起動時・許可し直し時に呼ぶ。新しい PC やブラウザのデータを消した直後は
 * ブラウザ側が空なので、フォルダの中身が正になる。すでにブラウザ側に
 * データがあるときは何もしない（どちらが新しいか機械では決められないため。
 * 明示的に取り込みたいときは設定画面の一括読み込みを使う）。
 */
async function restoreMissing(dir: FileSystemDirectoryHandle) {
  const s = useStore.getState();
  try {
    if (!hasSavedConfig()) {
      const text = await readFile(dir, BACKUP_FILES.config);
      if (text) {
        const f = JSON.parse(text) as ConfigFile;
        if (f.schemaVersion === 1) s.loadConfig(f);
      }
    }
    if (!hasSavedMy()) {
      const text = await readFile(dir, BACKUP_FILES.my);
      if (text) {
        const f = JSON.parse(text) as MyConfigFile;
        if (f.schemaVersion === 1) s.loadMyConfig(f);
      }
    }
    if (s.projects.length === 0) {
      const text = await readFile(dir, BACKUP_FILES.projects);
      if (text) {
        const f = JSON.parse(text) as ProjectFile;
        if (f.schemaVersion === 1) s.loadProjectFile(f);
      }
    }
  } catch {
    // 壊れたファイルはここでは黙って飛ばす（手動の読み込みでエラーを出す）
  }
}

/**
 * バックアップ先に既にファイルがあれば、読み込むか聞く。
 *
 * 新しい PC でこのアプリを開いた直後は中身が空なので、
 * 何もしないと**空の状態でフォルダを上書きしてしまう**。そこを塞ぐのが狙い。
 */
async function offerRestore(dir: FileSystemDirectoryHandle) {
  const s = useStore.getState();
  const found: string[] = [];
  const config = await readFile(dir, BACKUP_FILES.config);
  const my = await readFile(dir, BACKUP_FILES.my);
  const projects = await readFile(dir, BACKUP_FILES.projects);
  if (config) found.push('設定・部品表');
  if (my) found.push('My部品');
  if (projects) found.push('完了案件');
  if (found.length === 0) return;

  const dirty = s.projects.length > 0 || s.myDevices.length > 0;
  const msg =
    `このフォルダには既にバックアップがあります（${found.join('・')}）。\n` +
    `読み込んで、いまの内容を置き換えますか？\n\n` +
    (dirty ? '※ いまこのブラウザにある内容は上書きされます。' : '※ 別の PC で作った内容を引き継げます。');
  if (!window.confirm(msg)) return;

  try {
    if (config) {
      const f = JSON.parse(config) as ConfigFile;
      if (f.schemaVersion === 1) s.loadConfig(f);
    }
    if (my) {
      const f = JSON.parse(my) as MyConfigFile;
      if (f.schemaVersion === 1) s.loadMyConfig(f);
    }
    if (projects) {
      const f = JSON.parse(projects) as ProjectFile;
      if (f.schemaVersion === 1) s.loadProjectFile(f);
    }
  } catch (e) {
    window.alert(`読み込めませんでした: ${String(e)}`);
  }
}
