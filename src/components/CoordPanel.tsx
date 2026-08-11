import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import type { LayoutResult } from '../types';

const r1 = (v: number) => Number(v.toFixed(1));

/**
 * 中板以外の面で使う座標入力。機器の「中心」座標で指定する。
 * 原点は面の左下 (0,0)。
 */
export function CoordPanel({ layout, devices }: { layout: LayoutResult; devices: DeviceLookup }) {
  const setCenter = useStore((s) => s.setCenter);
  const select = useStore((s) => s.select);
  const selectedUid = useStore((s) => s.selectedUid);
  const items = useStore((s) => s.items);
  const face = useStore((s) => s.face);

  // 座標をいじるたびに行が並び替わらないよう、「＋で足した順」で固定して出す
  const byUid = new Map(layout.placed.map((p) => [p.uid, p]));
  const rows = items
    .filter((i) => i.face === face)
    .map((i) => byUid.get(i.uid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  if (rows.length === 0) {
    return (
      <div className="panel">
        <h2>座標（中心）</h2>
        <p className="note">機器を選ぶとここに座標が出ます。原点は面の左下 (0,0) です。</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>座標（中心）</h2>
      <p className="note">
        原点は面の<b>左下 (0,0)</b>。機器の<b>中心</b>で指定します。図をドラッグしても更新されます。
      </p>
      <table className="coords">
        <thead>
          <tr>
            <th>型式</th>
            <th>X</th>
            <th>Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const spec = devices.get(p.specId);
            if (!spec) return null;
            const cx = r1(p.x + spec.size.w / 2);
            const cy = r1(p.y + spec.size.h / 2);
            return (
              <tr
                key={p.uid}
                className={selectedUid === p.uid ? 'on' : undefined}
                onClick={() => select(p.uid)}
              >
                <td>
                  <strong>{spec.model}</strong>
                  <span>
                    {spec.size.w}×{spec.size.h}
                  </span>
                </td>
                <td>
                  <input
                    type="number"
                    value={cx}
                    step={5}
                    onChange={(e) => setCenter(p, spec.size, Number(e.target.value), cy)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={cy}
                    step={5}
                    onChange={(e) => setCenter(p, spec.size, cx, Number(e.target.value))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
