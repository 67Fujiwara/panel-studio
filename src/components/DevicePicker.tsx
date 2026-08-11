import { useMemo, useState } from 'react';
import { CATEGORY_COLOR, CATEGORY_LABEL, SAMPLE_DEVICES } from '../data/devices';
import { FACE_BY_ID } from '../data/faces';
import { useStore } from '../store';
import type { DeviceCategory, DeviceSpec, MountType } from '../types';

const CATEGORIES: DeviceCategory[] = [
  'breaker',
  'contactor',
  'relay',
  'plc',
  'psu',
  'terminal',
  'operator',
  'other',
];

const MOUNT_LABEL: Record<MountType, string> = { din: 'DIN', direct: '直付' };

type Node = { key: string; label: string; color?: string; devices: DeviceSpec[] };

/**
 * 機器の選択。種類が増えても縦に伸び続けないよう、折りたためるツリーにしてある。
 * 使用中の機器がある枝は自動で開く。
 */
export function DevicePicker() {
  const face = useStore((s) => s.face);
  const items = useStore((s) => s.items);
  const addDevice = useStore((s) => s.addDevice);
  const removeDevice = useStore((s) => s.removeDevice);
  const setMount = useStore((s) => s.setMount);

  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const allowedMounts = FACE_BY_ID.get(face)?.mounts ?? [];
  const countOf = (specId: string) =>
    items.filter((i) => i.specId === specId && i.face === face).length;
  const mountOf = (specId: string) =>
    items.find((i) => i.specId === specId && i.face === face)?.mount;

  const nodes = useMemo<Node[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (d: DeviceSpec) =>
      !q ||
      d.model.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.maker.toLowerCase().includes(q);

    // その面に取り付けられない機器は出さない
    const usable = SAMPLE_DEVICES.filter(
      (d) => d.mount.some((m) => allowedMounts.includes(m)) && match(d),
    );

    return CATEGORIES.map((c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      color: CATEGORY_COLOR[c],
      devices: usable.filter((d) => d.category === c),
    })).filter((nd) => nd.devices.length > 0);
  }, [query, allowedMounts]);

  const isOpen = (nd: Node) => {
    if (query.trim()) return true; // 検索中は全部開く
    if (closed[nd.key] !== undefined) return !closed[nd.key];
    return nd.devices.some((d) => countOf(d.id) > 0); // 使用中の枝は開く
  };

  return (
    <div className="panel">
      <h2>使用機器</h2>
      <p className="note">
        個数を変えると、そのままレイアウトと BOM の両方に反映されます（機器マスタが唯一の情報源）。
      </p>
      <input
        type="search"
        className="search"
        placeholder="型式・品名・メーカーで絞り込み"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="tree">
        {nodes.map((nd) => {
          const open = isOpen(nd);
          const used = nd.devices.reduce((sum, d) => sum + countOf(d.id), 0);
          return (
            <li key={nd.key}>
              <button
                className="tree-branch"
                aria-expanded={open}
                onClick={() => setClosed((c) => ({ ...c, [nd.key]: open }))}
              >
                <span className={`caret${open ? ' open' : ''}`} aria-hidden="true" />
                <span className="swatch" style={{ background: nd.color }} />
                <span className="tree-label">{nd.label}</span>
                <span className="tree-count">{used > 0 ? used : nd.devices.length}</span>
              </button>

              {open && (
                <ul className="tree-leaves">
                  {nd.devices.map((d) => {
                    const count = countOf(d.id);
                    const mount = mountOf(d.id) ?? d.mount.find((m) => allowedMounts.includes(m));
                    const selectable = d.mount.filter((m) => allowedMounts.includes(m));
                    return (
                      <li key={d.id} className={`dev${count > 0 ? ' on' : ''}`}>
                        <div className="dev-main">
                          <strong>{d.model}</strong>
                          <span>
                            {d.name} — {d.size.w}×{d.size.h}×{d.size.d}
                          </span>
                        </div>
                        <div className="dev-ctl">
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
                          <button
                            onClick={() => removeDevice(d.id)}
                            disabled={count === 0}
                            aria-label="減らす"
                          >
                            −
                          </button>
                          <b>{count}</b>
                          <button onClick={() => addDevice(d.id, 1)} aria-label="増やす">
                            ＋
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {nodes.length === 0 && <p className="note">該当する機器がありません。</p>}
    </div>
  );
}
