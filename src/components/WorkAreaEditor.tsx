import { useState } from 'react';
import { FACES, FACE_LABEL, faceSize } from '../data/faces';
import { NITTO_RA_PRESET, blankFaceArea, resolveArea } from '../lib/workArea';
import { useStore } from '../store';
import type { AreaExclude, FaceId, FaceWorkArea, PanelSpec, WorkArea } from '../types';

const ANCHORS: { id: AreaExclude['anchor']; label: string }[] = [
  { id: 'bottom-left', label: '左下' },
  { id: 'bottom-right', label: '右下' },
  { id: 'top-left', label: '左上' },
  { id: 'top-right', label: '右上' },
];

function Num({
  label,
  value,
  onChange,
  width = 62,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  return (
    <label className="num tight">
      {label && <span>{label}</span>}
      <input
        type="number"
        style={{ width }}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * 加工有効範囲の登録。
 *
 * メーカーの加工有効範囲図は**模式図で寸法値どおりに図形が描かれていない**と注記があり、
 * 製品の DXF にもハッチングは入っていない。図から自動で読み取る道が無いので、
 * **数値を型式ごとに1回だけ登録**して使い回す形にした。
 * 端からの入り込みは盤の大きさが変わっても同じ値なので、シリーズ単位で効く。
 */
export function WorkAreaEditor() {
  const enclosures = useStore((s) => s.enclosures);
  const updateEnclosure = useStore((s) => s.updateEnclosure);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);

  // 「いまの盤」も編集できるようにする。DXF から取り込んだだけでマスタに無い型式があるため
  const [target, setTarget] = useState<number>(-1);
  const spec: PanelSpec = target < 0 ? panel : (enclosures[target] ?? panel);
  const area: WorkArea = spec.workArea ?? {};
  const [openFace, setOpenFace] = useState<FaceId | null>(null);

  const write = (next: WorkArea) => {
    if (target < 0) setPanel({ workArea: next });
    else updateEnclosure(target, { workArea: next });
  };

  const setFace = (face: FaceId, v: FaceWorkArea | undefined) => {
    const next = { ...area };
    if (v) next[face] = v;
    else delete next[face];
    write(next);
  };

  const applyPreset = () => {
    if (
      !window.confirm(
        '日東工業 RA形（片扉）の値を入れます。いまの登録は置き換わります。\n\n' +
          '※ メーカーの加工有効範囲図から数値だけを写したものです。\n' +
          '   案件の納入仕様書と突き合わせてから使ってください。',
      )
    )
      return;
    write(structuredClone(NITTO_RA_PRESET));
  };

  return (
    <>
      <h3 className="section">加工有効範囲</h3>
      <p className="note">
        面の端から何ミリ内側までなら穴を開けられるかを、<b>型式ごとに1回</b>登録します。
        登録した面では、範囲の外がレイアウト画面でグレーになり、はみ出した機器・加工が
        <b>チェックに出ます</b>。登録していない面は面いっぱい使える扱いで、判定しません。
      </p>
      <p className="note warn">
        ⚠ メーカーの「加工有効範囲図」は<b>模式図で、図中の寸法値どおりに図形が描かれていません</b>
        （図面の注記のとおりです）。製品の DXF にもハッチングは入っていないため、
        <b>図から自動で読み取ることはできません。</b>数値を人が1回入れる形にしています。
      </p>

      <div className="grid2">
        <label className="sel">
          <span>登録先</span>
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            <option value={-1}>いまの盤（{panel.model || '型式未設定'}）</option>
            {enclosures.map((p, i) => (
              <option key={p.model} value={i}>
                {p.model}
              </option>
            ))}
          </select>
        </label>
        <div className="row-buttons preset">
          <button onClick={applyPreset}>日東工業 RA形の値を入れる</button>
          <button onClick={() => write({})} disabled={Object.keys(area).length === 0}>
            全部消す
          </button>
        </div>
      </div>

      <table className="workarea">
        <thead>
          <tr>
            <th>面</th>
            <th>上</th>
            <th>下</th>
            <th>左</th>
            <th>右</th>
            <th>除外</th>
            <th>使える範囲</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {FACES.map((f) => {
            const a = area[f.id];
            const size = faceSize(spec, f.id);
            const resolved = a ? resolveArea({ ...spec, workArea: area }, f.id) : null;
            const open = openFace === f.id;
            return (
              <tr key={f.id} className={a ? undefined : 'off'}>
                <td>
                  <strong>{FACE_LABEL(f.id)}</strong>
                  <span className="dim">
                    {size.w}×{size.h}
                  </span>
                </td>
                {a ? (
                  (['top', 'bottom', 'left', 'right'] as const).map((side) => (
                    <td key={side}>
                      <Num
                        value={a.inset[side]}
                        onChange={(v) => setFace(f.id, { ...a, inset: { ...a.inset, [side]: v } })}
                      />
                    </td>
                  ))
                ) : (
                  <td colSpan={4} className="dim">
                    未登録（面いっぱい使えるものとして扱います）
                  </td>
                )}
                <td>
                  {a && (
                    <button className="linkish" onClick={() => setOpenFace(open ? null : f.id)}>
                      {a.excludes.length} 件
                    </button>
                  )}
                </td>
                <td className="dim">
                  {resolved ? `${Math.round(resolved.rect.w)}×${Math.round(resolved.rect.h)}` : '—'}
                </td>
                <td>
                  {a ? (
                    <button onClick={() => setFace(f.id, undefined)} aria-label="登録を消す">
                      ×
                    </button>
                  ) : (
                    <button onClick={() => setFace(f.id, blankFaceArea())}>登録</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {openFace && area[openFace] && (
        <ExcludeEditor
          face={openFace}
          value={area[openFace]!}
          onChange={(v) => setFace(openFace, v)}
          onClose={() => setOpenFace(null)}
        />
      )}
    </>
  );
}

/**
 * 除外矩形の編集。ボルトホルダーや中板四隅の角欠きを避けるためのもの。
 * 位置は**角からの距離**で持つので、盤の大きさが変わっても付いてくる。
 */
function ExcludeEditor({
  face,
  value,
  onChange,
  onClose,
}: {
  face: FaceId;
  value: FaceWorkArea;
  onChange: (v: FaceWorkArea) => void;
  onClose: () => void;
}) {
  const set = (i: number, patch: Partial<AreaExclude>) =>
    onChange({
      ...value,
      excludes: value.excludes.map((e, j) => (i === j ? { ...e, ...patch } : e)),
    });

  return (
    <div className="excludes">
      <div className="excludes-head">
        <h4>{FACE_LABEL(face)} — 除外する部分（{value.excludes.length}）</h4>
        <button onClick={onClose}>閉じる</button>
      </div>
      <p className="note">
        ボルトホルダーや取付ボルトのように<b>その面の中で使えない部分</b>を四角で抜きます。
        位置は<b>角からの距離</b>で持つので、盤の大きさが変わっても付いてきます。
      </p>
      <table className="workarea">
        <thead>
          <tr>
            <th>基準の角</th>
            <th>横</th>
            <th>縦</th>
            <th>幅</th>
            <th>高さ</th>
            <th>メモ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {value.excludes.map((e, i) => (
            <tr key={i}>
              <td>
                <select
                  value={e.anchor}
                  onChange={(ev) => set(i, { anchor: ev.target.value as AreaExclude['anchor'] })}
                >
                  {ANCHORS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Num value={e.dx} onChange={(dx) => set(i, { dx })} />
              </td>
              <td>
                <Num value={e.dy} onChange={(dy) => set(i, { dy })} />
              </td>
              <td>
                <Num value={e.w} onChange={(w) => set(i, { w })} />
              </td>
              <td>
                <Num value={e.h} onChange={(h) => set(i, { h })} />
              </td>
              <td>
                <input
                  type="text"
                  value={e.note ?? ''}
                  placeholder="ボルトホルダー など"
                  onChange={(ev) => set(i, { note: ev.target.value })}
                />
              </td>
              <td>
                <button
                  aria-label="除外を消す"
                  onClick={() =>
                    onChange({ ...value, excludes: value.excludes.filter((_, j) => j !== i) })
                  }
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-buttons">
        <button
          onClick={() =>
            onChange({
              ...value,
              excludes: [
                ...value.excludes,
                { anchor: 'top-left', dx: 0, dy: 0, w: 50, h: 50 },
              ],
            })
          }
        >
          ＋ 除外を追加
        </button>
      </div>
    </div>
  );
}
