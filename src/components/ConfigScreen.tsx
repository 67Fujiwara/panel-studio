import { useState } from 'react';
import { PartEditor } from './PartEditor';
import { useStore, type ConfigFile } from '../store';
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

  const [open, setOpen] = useState<string | null>(categories[0]?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);

  const exportFile = () => {
    const file: ConfigFile = { schemaVersion: 1, categories, devices, profile };
    downloadJson(file, 'panel-studio-config.json');
  };

  const importFile = async () => {
    const data = await pickJson<ConfigFile>();
    if (data?.schemaVersion === 1) loadConfig(data);
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>ConfigFile — 共通の部品表</h2>
        <p className="note">
          分類と部品をここで編集します。レイアウト画面のツリーはこの内容をそのまま表示します。
          共有フォルダに書き出しておけば、全員が同じ部品表を使えます。
        </p>
        <div className="row-buttons">
          <button onClick={addCategory}>＋ 分類を追加</button>
          <button onClick={exportFile}>書き出し（JSON）</button>
          <button onClick={() => void importFile()}>読み込み（JSON）</button>
        </div>
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
