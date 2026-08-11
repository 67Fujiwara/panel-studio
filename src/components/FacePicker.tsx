import { FACES, faceSize } from '../data/faces';
import { useStore } from '../store';

/**
 * 面の選択画面。
 * 既存図面が三角法なので、それに合わせた並びでカードを置く。
 * カードを押すとその面のレイアウト画面へ遷移する。
 */
export function FacePicker() {
  const panel = useStore((s) => s.panel);
  const items = useStore((s) => s.items);
  const machining = useStore((s) => s.machining);
  const openFace = useStore((s) => s.openFace);

  return (
    <div className="facepicker">
      <div className="facepicker-head">
        <h2>{panel.model}</h2>
        <p>
          外形 {panel.outer.w} × {panel.outer.h} × D{panel.outer.d} ／ 中板 {panel.plate.w} ×{' '}
          {panel.plate.h}
        </p>
        <p className="note">
          加工したい面を選ぶとレイアウト画面に移ります。並びは既存図面と同じ<b>三角法</b>です。
          中板だけが配線ダクトと DIN レールを扱い、他の面は直接取り付けと穴あけ・切り欠き加工の対象です。
        </p>
      </div>

      <div className="facegrid">
        {FACES.map((f) => {
          const size = faceSize(panel, f.id);
          const devices = items.filter((i) => i.face === f.id).length;
          const cuts = machining.filter((m) => m.face === f.id).length;
          return (
            <button
              key={f.id}
              className={`facecard${f.id === 'plate' ? ' plate' : ''}`}
              style={{ gridColumn: f.grid.col, gridRow: f.grid.row }}
              onClick={() => openFace(f.id)}
            >
              <strong>{f.label}</strong>
              <span className="dim">
                {size.w} × {size.h}
              </span>
              <span className="hint">{f.hint}</span>
              <span className="counts">
                {devices > 0 && <em>機器 {devices}</em>}
                {cuts > 0 && <em>加工 {cuts}</em>}
                {devices === 0 && cuts === 0 && <em className="empty">未設定</em>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
