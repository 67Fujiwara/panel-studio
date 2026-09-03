import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_FILE,
  BACKUP_PREV_FILE,
  BackupWriter,
  ensurePermission,
  fsAccessSupported,
  LEGACY_BACKUP_FILES,
  loadAutoFlag,
  loadDir,
  pickDir,
  readFile,
  saveAutoFlag,
  type BackupKind,
  type BackupState,
} from '../lib/backup';
import {
  loadBundle,
  makeBundle,
  useStore,
  type BackupBundle,
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
    writing: false,
  });
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(loadAutoFlag);
  const writerRef = useRef<BackupWriter | null>(null);
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);

  // 書き出す中身はストアから直に取る。React の描画とは切り離しておきたいので getState を使う。
  // 書くのは常に全部入りの1ファイル（panel-studio-backup.json）
  const snapshot = (): unknown => makeBundle();

  // 書き出し係を1つだけ作る。中身の変化を見張って、止まったところでまとめて書く
  useEffect(() => {
    const writer = new BackupWriter(snapshot, (patch) => setState((v) => ({ ...v, ...patch })));
    writerRef.current = writer;
    writer.setAuto(loadAutoFlag());

    void (async () => {
      const dir = await loadDir();
      if (!dir) return;
      dirRef.current = dir;
      // 再読み込み直後は許可が「保留」になることがある。ここでは聞かず、名前だけ出す
      setState((v) => ({ ...v, dirName: dir.name }));
      if (await ensurePermission(dir, false)) writer.setDir(dir);
      else
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

  /*
   * 自動を切っているあいだは、押し忘れたまま閉じると消える。
   * 未保存のときだけブラウザの確認を挟む（自動のときは邪魔なので出さない）。
   */
  useEffect(() => {
    if (auto || !state.pending) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [auto, state.pending]);

  const choose = async () => {
    setBusy(true);
    try {
      const dir = await pickDir();
      dirRef.current = dir;
      writerRef.current?.setDir(dir);
      // フォルダに既にファイルがあれば、そちらを取り込むか聞く。
      // 新しい PC で開いたときに、書き出したものを拾い直せるようにするため
      await offerRestore(dir);
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

  // 手動にしているあいだの未保存は、書けていないのと同じ扱いで目立たせる
  const unsaved = !auto && state.pending && !state.writing;

  return (
    <div className={`backupbar${state.error || unsaved ? ' warn' : ' ok'}`}>
      <span className="mark">{state.error || unsaved ? '!' : '✓'}</span>
      <span>
        バックアップ先: <b>{state.dirName}</b>
        {state.error ? (
          <em className="bad"> — {state.error}</em>
        ) : state.writing ? (
          <em> — 書き出し中…</em>
        ) : state.pending ? (
          <em className={auto ? undefined : 'bad'}>
            {auto ? ' — 書き出し待ち…' : ' — 未保存の変更があります'}
          </em>
        ) : state.lastAt ? (
          <em> — 最終 {new Date(state.lastAt).toLocaleTimeString('ja-JP')}</em>
        ) : (
          <em>{auto ? ' — 変更があれば自動で書き出します' : ' — 「上書き保存」で書き出します'}</em>
        )}
      </span>
      {state.error && (
        <button disabled={busy} onClick={() => void regrant()}>
          許可し直す
        </button>
      )}
      {/*
        いま書く口。部品に外形を持たせると1ファイルが数 MB になり、
        変更のたびに書かれると手が止まる。自動を切って、ここで区切りよく書けるようにする
      */}
      <button
        className={state.pending ? 'primary' : undefined}
        disabled={busy || state.writing}
        title="いまの内容をバックアップ先へ上書きします"
        onClick={() => void writerRef.current?.flush(true)}
      >
        {state.writing ? '書き出し中…' : '上書き保存'}
      </button>
      <label className="check inline" title="切ると、書き出すのは「上書き保存」を押したときと、閉じる直前だけになります">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            saveAutoFlag(e.target.checked);
            writerRef.current?.setAuto(e.target.checked);
          }}
        />
        <span>自動</span>
      </label>
      {/*
        1つ前へ戻す口。間違って消した・壊れた状態のまま上書きされたときの逃げ道。
        押しても勝手には戻さず、中身の要約を見せてから確かめる
      */}
      <button
        disabled={busy}
        title="自動バックアップの「1つ前」を読み込みます"
        onClick={() => void restorePrev()}
      >
        1つ前に戻す
      </button>
      <button disabled={busy} onClick={() => void choose()}>
        変更
      </button>
    </div>
  );

  /** 1つ前のバックアップを読み込む。無ければその旨を出す。 */
  async function restorePrev() {
    const dir = dirRef.current;
    if (!dir) return;
    setBusy(true);
    try {
      const text = await readFile(dir, BACKUP_PREV_FILE);
      if (text === null) {
        window.alert(
          `「1つ前」のバックアップはまだありません（${BACKUP_PREV_FILE}）。\n` +
            '自動書き出しが2回目に走った時点から作られます。',
        );
        return;
      }
      const b = JSON.parse(text) as BackupBundle;
      if (b.schemaVersion !== 1 || b.kind !== 'bundle') {
        window.alert('「1つ前」のファイルが読めませんでした。');
        return;
      }
      // 戻す前に中身を見せる。件数が減るなら、それが分かってから決められる
      const now = useStore.getState();
      const n = (v: unknown[] | undefined) => v?.length ?? 0;
      const msg =
        '「1つ前」のバックアップを読み込みます。\n\n' +
        `部品表: ${n(now.devices)} → ${n(b.config?.devices)} 件\n` +
        `My部品: ${n(now.myDevices)} → ${n(b.my?.devices)} 件\n` +
        `完了案件: ${n(now.projects)} → ${n(b.projects?.projects)} 件\n\n` +
        '※ いまの内容は上書きされます。';
      if (!window.confirm(msg)) return;
      loadBundle(b);
    } catch (e) {
      window.alert(`読み込めませんでした: ${String(e)}`);
    } finally {
      setBusy(false);
    }
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

  // いまの形式（全部入りの1ファイル）を先に見る。無ければ「1つ前」も拾う
  const bundleText = (await readFile(dir, BACKUP_FILE)) ?? (await readFile(dir, BACKUP_PREV_FILE));
  // 旧版の3ファイルは読み込み（復元）だけ対応する。書くのはもうしない
  const config = bundleText ? null : await readFile(dir, LEGACY_BACKUP_FILES.config);
  const my = bundleText ? null : await readFile(dir, LEGACY_BACKUP_FILES.my);
  const projects = bundleText ? null : await readFile(dir, LEGACY_BACKUP_FILES.projects);

  const found: string[] = [];
  if (bundleText) found.push('全部入りバックアップ');
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
    if (bundleText) {
      const b = JSON.parse(bundleText) as BackupBundle;
      if (b.schemaVersion === 1 && b.kind === 'bundle') loadBundle(b);
      return;
    }
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
