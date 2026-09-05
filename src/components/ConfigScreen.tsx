import { useState } from 'react';
import { PartEditor } from './PartEditor';
import { EnclosureTable } from './EnclosureTable';
import { DuctRailSettings } from './DuctRailSettings';
import { DuctTable } from './DuctTable';
import { WorkAreaEditor } from './WorkAreaEditor';
import { PriceBookPanel } from './PriceBookPanel';
import { AiSettingsPanel } from './AiSettingsPanel';
import {
  loadBundle,
  makeBundle,
  useStore,
  type BackupBundle,
  type ConfigFile,
  type MyConfigFile,
  type ProjectFile,
} from '../store';
import { downloadJson, pickJson, pickJsonFiles } from '../lib/jsonFile';

/**
 * ConfigFile 画面。共通の部品表（分類と部品）を編集する。
 * ここで編集した内容がレイアウト画面のツリーにそのまま出る。
 */
export function ConfigScreen() {
  const categories = useStore((s) => s.categories);
  const devices = useStore((s) => s.devices);
  const profile = useStore((s) => s.profile);
  const addCategory = useStore((s) => s.addCategory);
  const updateCategory = useStore((s) => s.updateCategory);
  const removeCategory = useStore((s) => s.removeCategory);
  const addPart = useStore((s) => s.addPart);
  const loadConfig = useStore((s) => s.loadConfig);
  const enclosures = useStore((s) => s.enclosures);
  const ducts = useStore((s) => s.ducts);
  const prices = useStore((s) => s.prices);
  const owners = useStore((s) => s.owners);
  const myDevices = useStore((s) => s.myDevices);
  const projects = useStore((s) => s.projects);
  const loadMyConfig = useStore((s) => s.loadMyConfig);
  const loadProjectFile = useStore((s) => s.loadProjectFile);

  const [open, setOpen] = useState<string | null>(categories[0]?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);

  // 手で書き出す／読み込む口。ふだんはバックアップ先フォルダへ自動で書かれるので、
  // ここは「別の PC へ持っていく」「古いファイルを開く」ときの逃げ道
  const exportConfig = () => {
    const file: ConfigFile = {
      schemaVersion: 1,
      categories,
      devices,
      profile,
      enclosures,
      ducts,
      prices,
    };
    downloadJson(file, 'panel-studio-settings.json');
  };
  const importConfig = async () => {
    const data = await pickJson<ConfigFile>();
    if (data?.schemaVersion === 1) loadConfig(data);
  };
  const exportMy = () => {
    const file: MyConfigFile = { schemaVersion: 1, owners, devices: myDevices };
    downloadJson(file, 'panel-studio-myparts.json');
  };
  const importMy = async () => {
    const data = await pickJson<MyConfigFile>();
    if (data?.schemaVersion === 1) loadMyConfig(data);
  };
  const exportProjects = () => {
    const file: ProjectFile = { schemaVersion: 1, projects };
    downloadJson(file, 'panel-studio-projects.json');
  };
  const importProjects = async () => {
    const data = await pickJson<ProjectFile>();
    if (data?.schemaVersion === 1) loadProjectFile(data);
  };

  /**
   * 一括書き出しは**1ファイル**にまとめる。
   * 3ファイルを連続ダウンロードする方式は、ブラウザが2つ目以降をブロックして
   * 「1つしか落ちてこない」になりがち（複数ダウンロードは既定で要許可）。
   * 1ファイルなら確実に全部入りで渡せて、読み込みも1回で済む。
   */
  const exportAll = () => downloadJson(makeBundle(), 'panel-studio-backup.json');


  /**
   * ファイルの中身から種類を見分ける。ファイル名は見ない —
   * 改名されたファイルや全部入りの1ファイルでも、中身が合っていれば読めるようにする。
   */
  const detectKind = (data: unknown): 'bundle' | 'config' | 'my' | 'projects' | null => {
    const d = data as Record<string, unknown> | null;
    if (!d || d.schemaVersion !== 1) return null;
    if (d.kind === 'bundle' && d.config && d.my) return 'bundle';
    if (Array.isArray(d.projects)) return 'projects';
    if (Array.isArray(d.owners)) return 'my';
    if (Array.isArray(d.categories) && Array.isArray(d.devices)) return 'config';
    return null;
  };
  const KIND_LABEL = {
    bundle: '一括バックアップ（設定＋My部品＋完了案件）',
    config: '設定・盤マスタ・ダクト・部品表',
    my: 'My部品',
    projects: '完了案件',
  } as const;

  /** まとめて読み込む。複数ファイルも全部入りの1ファイルも、中身で見分けて正しい場所へ。 */
  const importAny = async () => {
    const picked = await pickJsonFiles();
    if (!picked) return; // キャンセル
    const loaded: string[] = [];
    const failed: string[] = [];
    for (const f of picked) {
      const kind = detectKind(f.data);
      if (kind === 'bundle') {
        // 空の完了案件で既存を消さない処理は loadBundle 側にある
        loadBundle(f.data as BackupBundle);
      } else if (kind === 'config') loadConfig(f.data as ConfigFile);
      else if (kind === 'my') loadMyConfig(f.data as MyConfigFile);
      else if (kind === 'projects') loadProjectFile(f.data as ProjectFile);
      if (kind) loaded.push(`${f.name} → ${KIND_LABEL[kind]}`);
      else
        failed.push(
          f.data === null
            ? `${f.name}（JSON として読めません）`
            : `${f.name}（このアプリのファイルではありません）`,
        );
    }
    // 何が起きたかを必ず知らせる。黙って何も起きないのが一番わかりにくい
    const lines = [
      ...(loaded.length ? ['読み込みました:', ...loaded.map((x) => `・${x}`)] : []),
      ...(failed.length ? ['読み込めませんでした:', ...failed.map((x) => `・${x}`)] : []),
    ];
    if (lines.length) window.alert(lines.join('\n'));
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>設定 — 盤マスタ・ダクト・部品表</h2>
        <p className="note">
          制御盤の型式、配線ダクトと DINレールの決め事、分類・部品をここで登録します。
          どれも案件ごとに変えるものではないので、レイアウト画面ではなくここにまとめてあります。
        </p>
      </div>

      <h3 className="section">バックアップ</h3>
      <p className="note">
        <b>ふだんは操作不要です。</b>画面上の帯でバックアップ先フォルダを決めておけば、
        設定・My部品・完了案件が<b>変わるたびに自動で書き出されます</b>
        （打っている最中は書かず、手が止まってから。動きがなくても一定時間ごとに書きます）。
        書き出されるのは<b>全部入りの1ファイル（panel-studio-backup.json）だけ</b>です。
        旧版が書いた3ファイル（settings / myparts / projects）は読み込みだけ対応しています。
      </p>
      <div className="row-buttons">
        <button onClick={exportAll}>一括書き出し（1ファイルに全部）</button>
        <button onClick={() => void importAny()}>一括読み込み</button>
      </div>
      <p className="note">
        外形線の軽量化（短い線の連結と 0.05mm の間引き）は<b>自動</b>です。DXF を取り込んだとき、
        バックアップを読み込んだとき、起動したときに、まだ軽くしていないものだけ軽くします。
        見た目は変わりません。
      </p>
      <p className="note">
        一括書き出しは<b>全部入りの1ファイル</b>（panel-studio-backup.json）を作ります。
        別の PC へはこれ1つ持っていけば足ります。読み込みはファイル名でなく
        <b>中身で種類を判別</b>するので、全部入りでも下の個別ファイルでも、名前が変わっていても、
        複数まとめて選んでも、それぞれ正しい場所へ入ります。
      </p>
      <table className="backup-io">
        <thead>
          <tr>
            <th>中身</th>
            <th>ファイル名</th>
            <th>手動</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>設定・盤マスタ・ダクト・部品表</td>
            <td>panel-studio-settings.json</td>
            <td className="cand-actions">
              <button onClick={exportConfig}>書き出し</button>
              <button onClick={() => void importConfig()}>読み込み</button>
            </td>
          </tr>
          <tr>
            <td>My部品（担当者ごとの部品）</td>
            <td>panel-studio-myparts.json</td>
            <td className="cand-actions">
              <button onClick={exportMy}>書き出し</button>
              <button onClick={() => void importMy()}>読み込み</button>
            </td>
          </tr>
          <tr>
            <td>完了案件</td>
            <td>panel-studio-projects.json</td>
            <td className="cand-actions">
              <button onClick={exportProjects} disabled={projects.length === 0}>
                書き出し
              </button>
              <button onClick={() => void importProjects()}>読み込み</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="note warn">
        ⚠ <b>API キーはどのファイルにも入りません。</b>
        共有フォルダに置いたファイルからキーが漏れないようにするためです。
        キーは各自のブラウザにだけ残るので、PC を替えたら入れ直してください。
      </p>

      <EnclosureTable />

      <PriceBookPanel />

      <WorkAreaEditor />

      <DuctTable />

      <DuctRailSettings />

      <AiSettingsPanel />

      <h3 className="section">部品表</h3>
      <div className="row-buttons">
        <button onClick={addCategory}>＋ 分類を追加</button>
      </div>

      <ul className="tree big">
        {categories.map((c) => {
          const parts = devices.filter((d) => d.category === c.id);
          const isOpen = open === c.id;
          return (
            <li key={c.id}>
              <div className="tree-branch-row">
                <button
                  className="tree-branch"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  <span className={`caret${isOpen ? ' open' : ''}`} aria-hidden="true" />
                  <span className="swatch" style={{ background: c.color }} />
                  <span className="tree-label">{c.label}</span>
                  <span className="tree-count">{parts.length}</span>
                </button>
                <input
                  className="cat-name"
                  type="text"
                  value={c.label}
                  onChange={(e) => updateCategory(c.id, { label: e.target.value })}
                  aria-label="分類名"
                />
                <input
                  type="color"
                  value={c.color}
                  onChange={(e) => updateCategory(c.id, { color: e.target.value })}
                  aria-label="色"
                />
                <button onClick={() => removeCategory(c.id)} aria-label="分類を削除">
                  ×
                </button>
              </div>

              {isOpen && (
                <ul className="tree-leaves">
                  {parts.map((p) => (
                    <li key={p.id}>
                      <button
                        className="part-row"
                        onClick={() => setEditing(editing === p.id ? null : p.id)}
                      >
                        <strong>{p.model}</strong>
                        <span>
                          {p.maker} {p.name} — {p.size.w}×{p.size.h}×{p.size.d}
                          {p.mountHoles
                            ? ` / 取付穴 φ${p.mountHoles.dia} ${p.mountHoles.pitchX}×${p.mountHoles.pitchY}`
                            : ''}
                          {p.shape ? ' / 形状あり' : ''}
                        </span>
                      </button>
                      {editing === p.id && <PartEditor part={p} categories={categories} />}
                    </li>
                  ))}
                  <li>
                    <button
                      className="addpart"
                      onClick={() => setEditing(addPart('config', c.id))}
                    >
                      ＋ この分類に部品を追加
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
