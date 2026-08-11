import { faceSize } from '../data/faces';
import { derivedMachining, groupByDevice, summarizeMachining } from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import type { LayoutResult, Machining } from '../types';

const label = (m: Machining) => (m.kind === 'hole' ? `φ${m.dia} 穴` : `${m.w}×${m.h} 角穴`);

/**
 * 加工（穴あけ・切り欠き）の座標。
 * どの機器から出た加工かが分かるよう、使用機器ごとにまとめて表示する。
 */
export function MachiningPanel({
  layout,
  devices,
}: {
  layout: LayoutResult;
  devices: DeviceLookup;
}) {
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const manual = useStore((s) => s.machining);
  const addMachining = useStore((s) => s.addMachining);
  const updateMachining = useStore((s) => s.updateMachining);
  const removeMachining = useStore((s) => s.removeMachining);
  const select = useStore((s) => s.select);
  const selectedUid = useStore((s) => s.selectedUid);

  const size = faceSize(panel, face);
  const auto = derivedMachining(layout.placed, devices);
  const mine = manual.filter((m) => m.face === face);
  const summary = summarizeMachining([...auto, ...mine]);
  const groups = groupByDevice(auto, layout.placed, devices);
  const center = { x: Math.round(size.w / 2), y: Math.round(size.h / 2) };

  return (
    <div className="panel">
      <h2>加工</h2>
      <p className="note">
        押ボタン・表示器の開口と、直付け機器の取付穴が<b>座標付きで自動で出ます</b>。
        原点は面の左下 (0,0)。自動で出ない加工は下のボタンで足してください。
      </p>

      {groups.map((g) => (
        <div
          key={g.uid}
          className={`cutgroup${selectedUid === g.uid ? ' on' : ''}`}
          onClick={() => select(g.uid)}
        >
          <h3>{g.model}</h3>
          <ul className="cutlist">
            {g.items.map((m) => (
              <li key={m.id}>
                <span className="cut-kind">{label(m)}</span>
                <span className="cut-pos">
                  X{m.x} Y{m.y}
                </span>
                <span className="cut-note">{m.note?.replace(`${g.model} `, '')}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="row-buttons">
        <button onClick={() => addMachining({ kind: 'hole', ...center, dia: 22 })}>＋ 穴あけ</button>
        <button onClick={() => addMachining({ kind: 'notch', ...center, w: 100, h: 100 })}>
          ＋ 切り欠き
        </button>
      </div>

      {mine.length > 0 && (
        <>
          <h3>手動で追加した加工（{mine.length}）</h3>
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

      <h2>チェック</h2>
      {layout.violations.length === 0 ? (
        <p className="ok">違反なし</p>
      ) : (
        <ul className="violations">
          {layout.violations.map((v, i) => (
            <li key={i}>{v.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
