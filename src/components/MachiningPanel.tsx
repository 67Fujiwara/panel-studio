import { useState } from 'react';
import { faceSize } from '../data/faces';
import {
  TAP_DRILL,
  autoMachining,
  groupByDevice,
  machiningLabel,
  machiningOverlaps,
  overlappingCutIds,
  summarizeMachining,
} from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { areaViolations, resolveArea } from '../lib/workArea';
import { rotatedSize } from '../types';
import { useStore } from '../store';
import { CutFields, HolePicker } from './HolePicker';
import type { LayoutResult, Machining } from '../types';

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
  const ductMaster = useStore((s) => s.ducts);

  // 既定は畳んだ状態。開いたものだけ id を持つ
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [catalogOpen, setCatalogOpen] = useState(false);

  const size = faceSize(panel, face);
  const auto = autoMachining(face, layout, devices, profile, ductMaster);
  const mine = manual.filter((m) => m.face === face);
  const summary = summarizeMachining([...auto, ...mine]);
  const groups = groupByDevice(auto, layout.placed, devices);
  const center = { x: Math.round(size.w / 2), y: Math.round(size.h / 2) };
  // 加工同士のかぶりは配置の違反と一緒に「チェック」へ出す
  const allCuts = [...auto, ...mine];
  // 加工有効範囲の外に出ているものも一緒に出す。板金屋に断られるのが一番高くつく
  const placedRects = layout.placed.map((p) => {
    const spec = devices.get(p.specId);
    const s2 = spec ? rotatedSize(spec.size, p.rot) : { w: 0, h: 0 };
    return { uid: p.uid, model: spec?.model ?? p.specId, rect: { x: p.x, y: p.y, ...s2 } };
  });
  const checks = [
    ...layout.violations,
    ...machiningOverlaps(allCuts),
    ...areaViolations(panel, face, allCuts, placedRects),
  ];
  const hasArea = resolveArea(panel, face) !== null;
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
      {hasArea && (
        <p className="note area">
          この面には<b>加工有効範囲</b>が登録されています。図のグレーの部分は加工できません。
          はみ出したものは下の「チェック」に出ます。
        </p>
      )}

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
        <button className={catalogOpen ? 'on' : undefined} onClick={() => setCatalogOpen((v) => !v)}>
          ＋ カタログから…
        </button>
      </div>
      {catalogOpen && (
        <>
          <p className="note">
            メーカーのキャビスタと同じ穴種です。押すと面の中央に入るので、座標と寸法を直してください。
          </p>
          <HolePicker
            onPick={(make) => {
              addAndOpen(make(center.x, center.y));
              setCatalogOpen(false);
            }}
          />
        </>
      )}

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
                    <CutFields
                      value={m}
                      tapOk={tapOk}
                      tapNg={tapNg}
                      onChange={(v) => updateMachining(m.id, v)}
                    />
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
            <li
              key={i}
              className={
                v.kind === 'cut-overlap' ? 'cut' : v.kind === 'out-of-area' ? 'area' : undefined
              }
            >
              {v.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type { Machining };
