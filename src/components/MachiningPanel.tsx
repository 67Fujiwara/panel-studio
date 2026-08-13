import { useState } from 'react';
import { faceSize } from '../data/faces';
import {
  TAP_DRILL,
  TAP_SIZES,
  autoMachining,
  groupByDevice,
  machiningLabel,
  machiningOverlaps,
  overlappingCutIds,
  summarizeMachining,
} from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import type { LayoutResult, Machining, TapSize } from '../types';

/**
 * 加工（穴あけ・切り欠き）の座標。
 * どの機器から出た加工かが分かるよう、使用機器ごとにまとめて表示する。
 * 手で足した加工は1行に畳め、選ぶとキャンバス上で強調される。
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
  const profile = useStore((s) => s.profile);
  const manual = useStore((s) => s.machining);
  const addMachining = useStore((s) => s.addMachining);
  const updateMachining = useStore((s) => s.updateMachining);
  const removeMachining = useStore((s) => s.removeMachining);
  const select = useStore((s) => s.select);
  const selectCut = useStore((s) => s.selectCut);
  const selectedUid = useStore((s) => s.selectedUid);
  const selectedCut = useStore((s) => s.selectedCut);

  // 既定は畳んだ状態。開いたものだけ id を持つ
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const size = faceSize(panel, face);
  const auto = autoMachining(face, layout, devices, profile);
  const mine = manual.filter((m) => m.face === face);
  const summary = summarizeMachining([...auto, ...mine]);
  const groups = groupByDevice(auto, layout.placed, devices);
  const center = { x: Math.round(size.w / 2), y: Math.round(size.h / 2) };
  // 加工同士のかぶりは配置の違反と一緒に「チェック」へ出す
  const allCuts = [...auto, ...mine];
  const checks = [...layout.violations, ...machiningOverlaps(allCuts)];
  const hitIds = overlappingCutIds(allCuts);

  const addAndOpen = (draft: Parameters<typeof addMachining>[0]) => addMachining(draft);

  /**
   * タップは中板だけ。
   * タップはダクトや機器をネジ止めするための下穴で、板の裏からナットを当てられない
   * 中板だから成り立つ。扉や側面は表に出る面で、開口はふつう通し穴になる。
   */
  const tapOk = face === 'plate';
  const tapNg = 'タップは中板だけです（扉・側面は通し穴で加工します）';

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
              <li key={m.id} className={hitIds.has(m.id) ? 'hit' : undefined}>
                <span className="cut-kind">{machiningLabel(m)}</span>
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
        <button onClick={() => addAndOpen({ kind: 'hole', ...center, dia: 22 })}>＋ 丸穴</button>
        <button
          disabled={!tapOk}
          title={tapOk ? undefined : tapNg}
          onClick={() => addAndOpen({ kind: 'hole', ...center, dia: TAP_DRILL.M4, tap: 'M4' })}
        >
          ＋ タップ
        </button>
        <button onClick={() => addAndOpen({ kind: 'notch', ...center, w: 100, h: 100 })}>
          ＋ 切り欠き
        </button>
      </div>

      {mine.length > 0 && (
        <>
          <h3>手動で追加した加工（{mine.length}）</h3>
          {mine.map((m) => {
            const open = expanded[m.id] ?? false;
            const on = selectedCut === m.id;
            return (
              <div
                key={m.id}
                className={`cutedit${on ? ' on' : ''}${open ? '' : ' collapsed'}${
                  hitIds.has(m.id) ? ' hit' : ''
                }`}
              >
                <div className="cutedit-head" onClick={() => selectCut(on ? null : m.id)}>
                  <button
                    className="cut-toggle"
                    aria-expanded={open}
                    aria-label={open ? '畳む' : '開く'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded((x) => ({ ...x, [m.id]: !open }));
                    }}
                  >
                    <span className={`caret${open ? ' open' : ''}`} aria-hidden="true" />
                  </button>
                  <strong>{machiningLabel(m)}</strong>
                  <span className="cut-pos">
                    X{m.x} Y{m.y}
                  </span>
                  <button
                    className="cut-del"
                    aria-label="削除"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMachining(m.id);
                    }}
                  >
                    ×
                  </button>
                </div>

                {open && (
                  <div className="cutedit-body">
                    {m.kind === 'hole' && (
                      <label className="sel">
                        <span>穴の種類</span>
                        <select
                          value={m.tap ?? 'through'}
                          title={tapOk ? undefined : tapNg}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'through') updateMachining(m.id, { tap: undefined, dia: 22 });
                            else
                              updateMachining(m.id, {
                                tap: v as TapSize,
                                dia: TAP_DRILL[v as TapSize],
                              });
                          }}
                        >
                          <option value="through">丸穴（径を指定）</option>
                          {/* 中板以外はタップに変えられない。既にタップの加工は選び直せる */}
                          {TAP_SIZES.map((t) => (
                            <option key={t} value={t} disabled={!tapOk && m.tap !== t}>
                              {t} タップ（下穴 φ{TAP_DRILL[t]}）
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="grid2">
                      <Num label="X" value={m.x} onChange={(x) => updateMachining(m.id, { x })} />
                      <Num label="Y" value={m.y} onChange={(y) => updateMachining(m.id, { y })} />
                      {/* タップは呼びで決まるので下穴径は出さない */}
                      {m.kind === 'hole' && !m.tap ? (
                        <Num label="径 φ" value={m.dia} onChange={(dia) => updateMachining(m.id, { dia })} />
                      ) : m.kind === 'notch' ? (
                        <>
                          <Num label="幅" value={m.w} onChange={(w) => updateMachining(m.id, { w })} />
                          <Num label="高さ" value={m.h} onChange={(h) => updateMachining(m.id, { h })} />
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
      {checks.length === 0 ? (
        <p className="ok">違反なし</p>
      ) : (
        <ul className="violations">
          {checks.map((v, i) => (
            <li key={i} className={v.kind === 'cut-overlap' ? 'cut' : undefined}>
              {v.message}
            </li>
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

export type { Machining };
