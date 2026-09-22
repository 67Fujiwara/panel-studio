import { FACES, FACE_LABEL } from '../data/faces';
import type { DeviceLookup } from '../lib/layout';
import { defaultShowOn } from '../lib/projection';
import { useStore } from '../store';
import { rotatedSize } from '../types';
import type { FaceId, LayoutResult, MountSide } from '../types';

const r1 = (v: number) => Number(v.toFixed(1));

/** 「他の面にも表示」で選べる面。中板は箱の一部ではないので出さない */
const OTHER_FACES = FACES.filter((f) => f.id !== 'plate');

/**
 * 中板以外の面で使う座標入力。機器の「中心」座標で指定する。
 * 原点は面の左下 (0,0)。
 *
 * 座標のほかに、キャビネットの面ならではの 2 つもここで決める:
 *  - 外側／内側: 面のどちら側に付けるか（内側は外から見えないので図では破線）
 *  - 他の面にも表示: 付けた面のほかにどの面の図にも投影として出すか
 */
export function CoordPanel({ layout, devices }: { layout: LayoutResult; devices: DeviceLookup }) {
  const setCenter = useStore((s) => s.setCenter);
  const select = useStore((s) => s.select);
  const selectedUid = useStore((s) => s.selectedUid);
  const items = useStore((s) => s.items);
  const face = useStore((s) => s.face);
  const setItemSide = useStore((s) => s.setItemSide);
  const setItemShowOn = useStore((s) => s.setItemShowOn);

  // 座標をいじるたびに行が並び替わらないよう、「＋で足した順」で固定して出す。
  // 並べる向きは**新しいものが上**。足した1台がすぐ目に入り、そのまま座標を打てる
  // （足すたびに下へ伸びると、毎回スクロールして探すことになる）
  const byUid = new Map(layout.placed.map((p) => [p.uid, p]));
  const rows = items
    .filter((i) => i.face === face)
    .map((i) => byUid.get(i.uid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .reverse();

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
        <b>外側／内側</b>は面のどちら側に付けるか（内側は外から見えないので破線で描きます）。
        <b>他の面にも表示</b>にチェックした面の図には、この機器が投影（薄い線）で出ます。
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
            // 回した機器は幅と高さが入れ替わるので、見かけの寸法で中心を出す
            const size = rotatedSize(spec.size, p.rot);
            const cx = r1(p.x + size.w / 2);
            const cy = r1(p.y + size.h / 2);
            const side: MountSide = p.side ?? 'out';
            const showOn = p.showOn ?? defaultShowOn(face, Boolean(spec.sideShape));
            const on = selectedUid === p.uid;
            return [
              <tr key={p.uid} className={on ? 'on' : undefined} onClick={() => select(p.uid)}>
                <td>
                  <strong>{spec.model}</strong>
                  <span>
                    {size.w}×{size.h}×D{spec.size.d}
                    {side === 'in' ? ' ・内側' : ''}
                  </span>
                </td>
                <td>
                  <input
                    type="number"
                    value={cx}
                    step={5}
                    onChange={(e) => setCenter(p, size, Number(e.target.value), cy)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={cy}
                    step={5}
                    onChange={(e) => setCenter(p, size, cx, Number(e.target.value))}
                  />
                </td>
              </tr>,
              // 選んだ 1 台だけ、外側／内側と他の面の設定を下に出す（全部に出すと表が縦に伸びる）
              on && (
                <tr key={`${p.uid}-opt`} className="on coord-opts">
                  <td colSpan={3}>
                    <div className="coord-side">
                      <span>取付</span>
                      <label className="check inline">
                        <input type="radio" name={`side-${p.uid}`} checked={side === 'out'} onChange={() => setItemSide(p.uid, 'out')} />
                        <span>外側</span>
                      </label>
                      <label className="check inline">
                        <input type="radio" name={`side-${p.uid}`} checked={side === 'in'} onChange={() => setItemSide(p.uid, 'in')} />
                        <span>内側</span>
                      </label>
                    </div>
                    <div className="coord-show">
                      <span>他の面にも表示</span>
                      {OTHER_FACES.filter((f) => f.id !== face).map((f) => (
                        <label key={f.id} className="check inline">
                          <input
                            type="checkbox"
                            checked={showOn.includes(f.id)}
                            onChange={(e) => {
                              const next: FaceId[] = e.target.checked
                                ? [...showOn, f.id]
                                : showOn.filter((x) => x !== f.id);
                              setItemShowOn(p.uid, next);
                            }}
                          />
                          <span>{FACE_LABEL(f.id)}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
