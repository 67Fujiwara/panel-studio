import { useState } from 'react';
import { PartEditor } from './PartEditor';
import { EnclosureTable } from './EnclosureTable';
import { DuctRailSettings } from './DuctRailSettings';
import { DuctTable } from './DuctTable';
import { AiSettingsPanel } from './AiSettingsPanel';
import {
  useStore,
  type ConfigFile,
  type MyConfigFile,
  type ProjectFile,
} from '../store';
import { downloadJson, pickJson } from '../lib/jsonFile';

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
    const file: ConfigFile = { schemaVersion: 1, categories, devices, profile, enclosures, ducts };
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
        以前は3つの画面に分かれていた書き出し・読み込みは、ここにまとめました。
      </p>
      <table className="encl backup-io">
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
