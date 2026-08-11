import { faceSize } from '../data/faces';
import { derivedMachining, summarizeMachining } from '../lib/machining';
import { useStore } from '../store';
import type { LayoutResult, Machining } from '../types';

/**
 * 面の加工（穴あけ・切り欠き）。
 * 機器から自動で決まる分と、手で足す分の両方を扱う。
 */
export function MachiningPanel({ layout }: { layout: LayoutResult }) {
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const manual = useStore((s) => s.machining);
  const addMachining = useStore((s) => s.addMachining);
  const updateMachining = useStore((s) => s.updateMachining);
  const removeMachining = useStore((s) => s.removeMachining);

  const size = faceSize(panel, face);
  const auto = derivedMachining(layout.placed);
  const mine = manual.filter((m) => m.face === face);
  const all = [...auto, ...mine];
  const summary = summarizeMachining(all);

  const center = { x: Math.round(size.w / 2), y: Math.round(size.h / 2) };

  return (
    <div className="panel">
      <h2>加工</h2>
      <p className="note">
        押ボタンや表示器を置くと、<b>穴・角穴が座標付きで自動で出ます</b>（下の「機器から自動」）。
        自動で出ない加工は手で足してください。
      </p>

      <div className="row-buttons">
        <button onClick={() => addMachining({ kind: 'hole', ...center, dia: 22 })}>＋ 穴あけ</button>
        <button onClick={() => addMachining({ kind: 'notch', ...center, w: 100, h: 100 })}>
          ＋ 切り欠き
        </button>
      </div>

      {auto.length > 0 && (
        <>
          <h3>機器から自動（{auto.length}）</h3>
          <ul className="cutlist">
            {auto.map((m) => (
              <li key={m.id}>
                <span className="cut-kind">{label(m)}</span>
                <span className="cut-pos">
                  X{m.x} Y{m.y}
                </span>
                <span className="cut-note">{m.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {mine.length > 0 && (
        <>
          <h3>手動（{mine.length}）</h3>
          {mine.map((m) => (
            <div key={m.id} className="cutedit">
              <div className="cutedit-head">
                <strong>{m.kind === 'hole' ? '穴あけ' : '切り欠き'}</strong>
                <button onClick={() => removeMachining(m.id)} aria-label="削除">
                  ×
                </button>
              </div>
              <div className="grid2">
                <Num label="X" value={m.x} onChange={(x) => updateMachining(m.id, { x })} />
                <Num label="Y" value={m.y} onChange={(y) => updateMachining(m.id, { y })} />
                {m.kind === 'hole' ? (
                  <Num label="径 φ" value={m.dia} onChange={(dia) => updateMachining(m.id, { dia })} />
                ) : (
                  <>
                    <Num label="幅" value={m.w} onChange={(w) => updateMachining(m.id, { w })} />
                    <Num label="高さ" value={m.h} onChange={(h) => updateMachining(m.id, { h })} />
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {summary.length > 0 && (
        <>
          <h3>集計</h3>
          <ul className="cutsummary">
            {summary.map((s) => (
              <li key={s.label}>
                <span>{s.label}</span>
                <b>{s.qty}</b>
              </li>
            ))}
          </ul>
        </>
      )}

      {all.length === 0 && <p className="note">この面にはまだ加工がありません。</p>}
    </div>
  );
}

const label = (m: Machining) =>
  m.kind === 'hole' ? `φ${m.dia} 穴` : `${m.w}×${m.h} 角穴`;

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
