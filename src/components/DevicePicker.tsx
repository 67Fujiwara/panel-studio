import { useMemo, useState } from 'react';
import { FACE_BY_ID } from '../data/faces';
import { useStore } from '../store';
import { hasTapCuts } from '../types';
import type { DeviceSpec, MountType } from '../types';

const MOUNT_LABEL: Record<MountType, string> = { din: 'DIN', direct: '直付' };

/**
 * 機器の選択。種類が増えても縦に伸び続けないよう、折りたためるツリーにしてある。
 *
 * 枝の構成:
 *   分類（ConfigFile の内容）→ 部品
 *   My部品 → 担当者 → 部品（MyConfig の内容）
 */
export function DevicePicker() {
  const face = useStore((s) => s.face);
  const items = useStore((s) => s.items);
  const categories = useStore((s) => s.categories);
  const devices = useStore((s) => s.devices);
  const owners = useStore((s) => s.owners);
  const myDevices = useStore((s) => s.myDevices);
  const addDevice = useStore((s) => s.addDevice);
  const removeDevice = useStore((s) => s.removeDevice);
  const setMount = useStore((s) => s.setMount);
  const setItemRow = useStore((s) => s.setItemRow);
  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;

  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const allowedMounts = FACE_BY_ID.get(face)?.mounts ?? [];
  const countOf = (specId: string) =>
    items.filter((i) => i.specId === specId && i.face === face).length;
  const mountOf = (specId: string) =>
    items.find((i) => i.specId === specId && i.face === face)?.mount;
  const rowOf = (specId: string) =>
    items.find((i) => i.specId === specId && i.face === face)?.row;

  const q = query.trim().toLowerCase();
  const usable = useMemo(() => {
    const match = (d: DeviceSpec) =>
      !q ||
      d.model.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.maker.toLowerCase().includes(q);
    const ok = (d: DeviceSpec) => d.mount.some((m) => allowedMounts.includes(m)) && match(d);
    return { config: devices.filter(ok), my: myDevices.filter(ok) };
  }, [q, devices, myDevices, allowedMounts]);

  const branchOpen = (key: string, hasUsed: boolean) => {
    if (q) return true;
    if (closed[key] !== undefined) return !closed[key];
    return hasUsed;
  };
  const toggle = (key: string, open: boolean) => setClosed((c) => ({ ...c, [key]: open }));

  const Leaf = ({ d }: { d: DeviceSpec }) => {
    const count = countOf(d.id);
    const mount = mountOf(d.id) ?? d.mount.find((m) => allowedMounts.includes(m));
    const selectable = d.mount.filter((m) => allowedMounts.includes(m));
    const tapOnly = hasTapCuts(d);
    return (
      <li className={`dev${count > 0 ? ' on' : ''}`}>
        <div className="dev-main">
          <strong>{d.model}</strong>
          <span>
            {d.name} — {d.size.w}×{d.size.h}×{d.size.d}
          </span>
        </div>
        <div className="dev-ctl">
          {count > 0 && hasDucts && (
            <select
              value={rowOf(d.id) ?? ''}
              title="何段目に置くか"
              onChange={(e) =>
                setItemRow(d.id, e.target.value === '' ? undefined : Number(e.target.value))
              }
            >
              <option value="">自動</option>
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}段
                </option>
              ))}
            </select>
          )}
          {count > 0 &&
            (selectable.length > 1 ? (
              <select
                value={mount}
                title="取付方式"
                onChange={(e) => setMount(d.id, e.target.value as MountType)}
              >
                {selectable.map((m) => (
                  <option key={m} value={m}>
                    {MOUNT_LABEL[m]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mount-fixed">{mount && MOUNT_LABEL[mount]}</span>
            ))}
          <button onClick={() => removeDevice(d.id)} disabled={count === 0} aria-label="減らす">
            −
          </button>
          <b>{count}</b>
          <button
            onClick={() => addDevice(d.id, 1)}
            aria-label="増やす"
            // タップ穴加工付きの部品は中板専用。裏からナットを当てられない加工のため
            disabled={tapOnly && !hasDucts}
            title={
              tapOnly && !hasDucts
                ? 'タップ穴加工付きの部品は中板にだけ取り付けられます'
                : undefined
            }
          >
            ＋
          </button>
        </div>
      </li>
    );
  };

  const myUsed = usable.my.reduce((s, d) => s + countOf(d.id), 0);
  const myOpen = branchOpen('__my__', myUsed > 0);
  const ownersWithParts = owners.filter((o) => usable.my.some((d) => d.owner === o));

  return (
    <div className="panel">
      <h2>使用部品</h2>
      <input
        type="search"
        className="search"
        placeholder="型式・品名・メーカーで絞り込み"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="tree">
        {categories.map((c) => {
          const list = usable.config.filter((d) => d.category === c.id);
          if (list.length === 0) return null;
          const used = list.reduce((s, d) => s + countOf(d.id), 0);
          const open = branchOpen(c.id, used > 0);
          return (
            <li key={c.id}>
              <button className="tree-branch" aria-expanded={open} onClick={() => toggle(c.id, open)}>
                <span className={`caret${open ? ' open' : ''}`} aria-hidden="true" />
                <span className="swatch" style={{ background: c.color }} />
                <span className="tree-label">{c.label}</span>
                <span className="tree-count">{used > 0 ? used : list.length}</span>
              </button>
              {open && (
                <ul className="tree-leaves">
                  {list.map((d) => (
                    <Leaf key={d.id} d={d} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}

        {ownersWithParts.length > 0 && (
          <li>
            <button
              className="tree-branch"
              aria-expanded={myOpen}
              onClick={() => toggle('__my__', myOpen)}
            >
              <span className={`caret${myOpen ? ' open' : ''}`} aria-hidden="true" />
              <span className="swatch my" />
              <span className="tree-label">My部品</span>
              <span className="tree-count">{myUsed > 0 ? myUsed : usable.my.length}</span>
            </button>
            {myOpen && (
              <ul className="tree-leaves">
                {ownersWithParts.map((o) => {
                  const list = usable.my.filter((d) => d.owner === o);
                  const used = list.reduce((s, d) => s + countOf(d.id), 0);
                  const open = branchOpen(`my:${o}`, used > 0);
                  return (
                    <li key={o}>
                      <button
                        className="tree-branch"
                        aria-expanded={open}
                        onClick={() => toggle(`my:${o}`, open)}
                      >
                        <span className={`caret${open ? ' open' : ''}`} aria-hidden="true" />
                        <span className="tree-label">{o}</span>
                        <span className="tree-count">{used > 0 ? used : list.length}</span>
                      </button>
                      {open && (
                        <ul className="tree-leaves">
                          {list.map((d) => (
                            <Leaf key={d.id} d={d} />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
