import { CATEGORY_COLOR, CATEGORY_LABEL, SAMPLE_DEVICES } from '../data/devices';
import { useStore } from '../store';
import type { DeviceCategory, MountType } from '../types';

const CATEGORIES: DeviceCategory[] = ['breaker', 'contactor', 'relay', 'plc', 'psu', 'terminal', 'other'];

export function DevicePicker() {
  const items = useStore((s) => s.items);
  const addDevice = useStore((s) => s.addDevice);
  const removeDevice = useStore((s) => s.removeDevice);
  const setMount = useStore((s) => s.setMount);

  const countOf = (specId: string) => items.filter((i) => i.specId === specId).length;
  const mountOf = (specId: string) => items.find((i) => i.specId === specId)?.mount;

  return (
    <div className="panel">
      <h2>使用機器</h2>
      <p className="note">
        個数を変えると、そのまま盤面レイアウトと BOM の両方に反映されます（機器マスタが唯一の情報源）。
      </p>
      {CATEGORIES.map((cat) => {
        const list = SAMPLE_DEVICES.filter((d) => d.category === cat);
        if (list.length === 0) return null;
        return (
          <section key={cat}>
            <h3>
              <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
              {CATEGORY_LABEL[cat]}
            </h3>
            {list.map((d) => {
              const n = countOf(d.id);
              const mount = mountOf(d.id) ?? d.mount[0]!;
              return (
                <div key={d.id} className={`dev${n > 0 ? ' on' : ''}`}>
                  <div className="dev-main">
                    <strong>{d.model}</strong>
                    <span>
                      {d.name} — {d.size.w}×{d.size.h}×{d.size.d}
                    </span>
                  </div>
                  <div className="dev-ctl">
                    {d.mount.length > 1 && n > 0 && (
                      <select
                        value={mount}
                        title="取付方式"
                        onChange={(e) => setMount(d.id, e.target.value as MountType)}
                      >
                        <option value="din">DIN</option>
                        <option value="plate">直付</option>
                      </select>
                    )}
                    {d.mount.length === 1 && n > 0 && (
                      <span className="mount-fixed">{d.mount[0] === 'din' ? 'DIN' : '直付'}</span>
                    )}
                    <button onClick={() => removeDevice(d.id)} disabled={n === 0} aria-label="減らす">
                      −
                    </button>
                    <b>{n}</b>
                    <button onClick={() => addDevice(d.id, 1)} aria-label="増やす">
                      ＋
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
