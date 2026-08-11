import { useState } from 'react';
import { PartEditor } from './PartEditor';
import { downloadJson, pickJson } from '../lib/jsonFile';
import { useStore, type MyConfigFile } from '../store';

/**
 * MyConfig 画面。担当者ごとの My部品を登録する。
 *
 * 「本人だけが見える」ではなく、共有フォルダに置いた1つの JSON を全員が読む前提。
 * 誰がどの部品を持っているかが分かるようにするのが狙い。
 */
export function MyConfigScreen() {
  const categories = useStore((s) => s.categories);
  const owners = useStore((s) => s.owners);
  const myDevices = useStore((s) => s.myDevices);
  const addOwner = useStore((s) => s.addOwner);
  const removeOwner = useStore((s) => s.removeOwner);
  const addPart = useStore((s) => s.addPart);
  const loadMyConfig = useStore((s) => s.loadMyConfig);

  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(owners[0] ?? null);
  const [editing, setEditing] = useState<string | null>(null);

  const exportFile = () => {
    const file: MyConfigFile = { schemaVersion: 1, owners, devices: myDevices };
    downloadJson(file, 'panel-studio-myparts.json');
  };
  const importFile = async () => {
    const data = await pickJson<MyConfigFile>();
    if (data?.schemaVersion === 1) loadMyConfig(data);
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>My部品 — 担当者ごとの部品</h2>
        <p className="note">
          ここで登録した部品は、レイアウト画面のツリーに
          <b>My部品 → 担当者 → 部品</b> の形で出ます。
          共有フォルダに書き出しておけば、<b>他の担当者からも見えます</b>。
        </p>
        <div className="row-buttons">
          <input
            type="text"
            className="search"
            placeholder="担当者名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={() => {
              addOwner(name.trim());
              setOpen(name.trim());
              setName('');
            }}
          >
            ＋ 担当者を追加
          </button>
          <button onClick={exportFile}>書き出し（JSON）</button>
          <button onClick={() => void importFile()}>読み込み（JSON）</button>
        </div>
      </div>

      {owners.length === 0 && (
        <p className="note">まだ担当者がいません。上の欄に名前を入れて追加してください。</p>
      )}

      <ul className="tree big">
        {owners.map((o) => {
          const parts = myDevices.filter((d) => d.owner === o);
          const isOpen = open === o;
          return (
            <li key={o}>
              <div className="tree-branch-row">
                <button
                  className="tree-branch"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : o)}
                >
                  <span className={`caret${isOpen ? ' open' : ''}`} aria-hidden="true" />
                  <span className="tree-label">{o}</span>
                  <span className="tree-count">{parts.length}</span>
                </button>
                <button onClick={() => removeOwner(o)} aria-label="担当者を削除">
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
                      onClick={() =>
                        setEditing(addPart('my', categories[0]?.id ?? 'other', o))
                      }
                    >
                      ＋ {o} の部品を追加
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
