import { useStore } from '../store';
import type { PanelSpec } from '../types';

function Cell({
  value,
  onChange,
  width = 68,
}: {
  value: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  return (
    <input
      type="number"
      className="encl-num"
      style={{ width }}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/**
 * 盤マスタ。型式ごとの寸法をここに貯めていく。
 *
 * 盤サイズ画面の「型式（登録済みから選ぶ）」はこの表を引いている。
 * DXF から寸法を取ったらそのまま登録できるよう、「今の盤を登録」を用意してある。
 * 同じ盤を何度も測り直さずに済むようにするのが狙い。
 */
export function EnclosureTable() {
  const enclosures = useStore((s) => s.enclosures);
  const panel = useStore((s) => s.panel);
  const addEnclosure = useStore((s) => s.addEnclosure);
  const updateEnclosure = useStore((s) => s.updateEnclosure);
  const removeEnclosure = useStore((s) => s.removeEnclosure);
  const setPanel = useStore((s) => s.setPanel);

  const patchOuter = (i: number, e: PanelSpec, patch: Partial<PanelSpec['outer']>) =>
    updateEnclosure(i, { outer: { ...e.outer, ...patch } });
  const patchPlate = (i: number, e: PanelSpec, patch: Partial<PanelSpec['plate']>) =>
    updateEnclosure(i, { plate: { ...e.plate, ...patch } });
  const patchDepth = (i: number, e: PanelSpec, patch: Partial<PanelSpec['depth']>) =>
    updateEnclosure(i, { depth: { ...e.depth, ...patch } });

  return (
    <>
      <h3 className="section">盤マスタ（制御盤の型式）</h3>
      <p className="note">
        ここに登録した型式が、<b>盤サイズ画面の「型式（登録済みから選ぶ）」</b>に出ます。
        DXF から寸法を取ったあと「今の盤を登録」を押せば、そのまま型式として残せます。
        <b>「背面→中板上面」はメーカー図面の値が実物と合わない</b>ので、実測値を入れてください。
      </p>
      <div className="row-buttons">
        <button onClick={() => addEnclosure()}>
          ＋ 今の盤を登録（{panel.model || '無題'}）
        </button>
      </div>

      <div className="tablewrap">
        <table className="encl">
          <thead>
            <tr>
              <th>型式</th>
              <th colSpan={3}>外形 W × H × D</th>
              <th colSpan={2}>中板 W × H</th>
              <th>背面→中板上面</th>
              <th>扉裏の突出</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {enclosures.map((e, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    className="encl-model"
                    value={e.model}
                    onChange={(ev) => updateEnclosure(i, { model: ev.target.value })}
                    aria-label="型式"
                  />
                </td>
                <td>
                  <Cell value={e.outer.w} onChange={(w) => patchOuter(i, e, { w })} />
                </td>
                <td>
                  <Cell value={e.outer.h} onChange={(h) => patchOuter(i, e, { h })} />
                </td>
                <td>
                  <Cell value={e.outer.d} onChange={(d) => patchOuter(i, e, { d })} />
                </td>
                <td>
                  <Cell value={e.plate.w} onChange={(w) => patchPlate(i, e, { w })} />
                </td>
                <td>
                  <Cell value={e.plate.h} onChange={(h) => patchPlate(i, e, { h })} />
                </td>
                <td>
                  <Cell
                    value={e.depth.backToPlate}
                    onChange={(backToPlate) => patchDepth(i, e, { backToPlate })}
                  />
                </td>
                <td>
                  <Cell
                    value={e.depth.doorProjection}
                    onChange={(doorProjection) => patchDepth(i, e, { doorProjection })}
                  />
                </td>
                <td>
                  <button onClick={() => setPanel(e)} title="この型式を今の盤に読み込む">
                    使う
                  </button>
                </td>
                <td>
                  <button onClick={() => removeEnclosure(i)} aria-label="型式を削除">
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {enclosures.length === 0 && (
              <tr>
                <td colSpan={10} className="note">
                  登録された型式がありません。「今の盤を登録」で追加できます。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
