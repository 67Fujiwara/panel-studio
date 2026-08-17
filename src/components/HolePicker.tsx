import { useState } from 'react';
import { HOLE_CATALOG } from '../lib/holes';
import { TAP_DRILL, TAP_SIZES } from '../lib/machining';
import type { MachiningDraft, PilotArrange, Pilots, TapSize } from '../types';

/**
 * 穴カタログとパラメータ欄。
 * 面の加工（MachiningPanel）と部品の追加加工（PartEditor）の両方で使うので、
 * ストアに触らず値と onChange だけで動く作りにしてある。
 */

const ARRANGES: { id: PilotArrange; label: string }[] = [
  { id: 'pcd', label: 'PCD（円周に等配）' },
  { id: 'lr', label: '左右' },
  { id: 'tb', label: '上下の辺に沿って' },
  { id: 'corners', label: '四隅' },
  { id: 'diag-tl', label: '対角（左上）' },
  { id: 'diag-tr', label: '対角（右上）' },
  { id: 'even', label: '四隅＋辺に均等' },
];

/** カタログ。タブはメーカーのキャビスタと同じ並び。 */
export function HolePicker({ onPick }: { onPick: (make: (x: number, y: number) => MachiningDraft) => void }) {
  const [tab, setTab] = useState(0);
  const group = HOLE_CATALOG[tab]!;
  return (
    <div className="holepicker">
      <div className="tabs small">
        {HOLE_CATALOG.map((g, i) => (
          <button key={g.group} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
            {g.group}
          </button>
        ))}
      </div>
      <div className="hole-grid">
        {group.items.map((it) => (
          <button key={it.id} onClick={() => onPick(it.make)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** ねじ下穴の編集欄。個数 0 で「無し」。 */
function PilotFields({
  value,
  kind,
  onChange,
}: {
  value: Pilots | undefined;
  kind: 'hole' | 'slot' | 'notch';
  onChange: (v: Pilots | undefined) => void;
}) {
  const p: Pilots =
    value ??
    (kind === 'hole'
      ? { n: 0, dia: 4.5, arrange: 'pcd', pcd: 36, angle: 90 }
      : kind === 'slot'
        ? { n: 0, dia: 4.5, arrange: 'lr', offset: 8 }
        : { n: 0, dia: 4.5, arrange: 'corners', offset: 6 });
  const set = (patch: Partial<Pilots>) => {
    const next = { ...p, ...patch };
    onChange(next.n > 0 ? next : undefined);
  };
  const arranges =
    kind === 'hole'
      ? ARRANGES.filter((a) => a.id === 'pcd')
      : kind === 'slot'
        ? ARRANGES.filter((a) => a.id === 'lr')
        : ARRANGES.filter((a) => a.id !== 'pcd');
  return (
    <>
      <div className="grid2">
        <Num label="ねじ下穴 個数" value={p.n} onChange={(n) => set({ n })} />
        {p.n > 0 && <Num label="下穴径 φ" value={p.dia} step={0.1} onChange={(dia) => set({ dia })} />}
      </div>
      {p.n > 0 && (
        <div className="grid2">
          {arranges.length > 1 && (
            <label className="sel">
              <span>並べ方</span>
              <select
                value={p.arrange}
                onChange={(e) => set({ arrange: e.target.value as PilotArrange })}
              >
                {arranges.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {p.arrange === 'pcd' ? (
            <>
              <Num label="PCD" value={p.pcd ?? 36} onChange={(pcd) => set({ pcd })} />
              <Num label="開始角°" value={p.angle ?? 90} step={15} onChange={(angle) => set({ angle })} />
            </>
          ) : (
            <Num label="縁からの持ち出し" value={p.offset ?? 6} onChange={(offset) => set({ offset })} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * 加工1件のパラメータ欄。X/Y と、穴種ごとの寸法とねじ下穴。
 * posLabel で「X/Y」（面の座標）とも「中心からX/Y」（部品の相対）とも読ませられる。
 */
export function CutFields({
  value,
  onChange,
  tapOk,
  tapNg,
  posLabel = ['X', 'Y'],
}: {
  value: MachiningDraft;
  onChange: (v: MachiningDraft) => void;
  tapOk: boolean;
  tapNg?: string;
  posLabel?: [string, string];
}) {
  const m = value;
  const set = (patch: Record<string, unknown>) => onChange({ ...m, ...patch } as MachiningDraft);
  return (
    <>
      {m.kind === 'hole' && (
        <label className="sel">
          <span>穴の種類</span>
          <select
            value={m.tap ?? 'through'}
            title={tapOk ? undefined : tapNg}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'through') set({ tap: undefined, dia: 22 });
              else set({ tap: v as TapSize, dia: TAP_DRILL[v as TapSize] });
            }}
          >
            <option value="through">丸穴（径を指定）</option>
            {TAP_SIZES.map((t) => (
              <option key={t} value={t} disabled={!tapOk && m.tap !== t}>
                {t} タップ（下穴 φ{TAP_DRILL[t]}）
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid2">
        <Num label={posLabel[0]} value={m.x} onChange={(x) => set({ x })} />
        <Num label={posLabel[1]} value={m.y} onChange={(y) => set({ y })} />

        {m.kind === 'hole' && !m.tap && (
          <Num label="径 φ（0で穴群のみ）" value={m.dia} step={0.5} onChange={(dia) => set({ dia })} />
        )}
        {m.kind === 'slot' && (
          <>
            <Num label="全長" value={m.len} onChange={(len) => set({ len })} />
            <Num label="幅 φ" value={m.dia} step={0.5} onChange={(dia) => set({ dia })} />
            <label className="num check">
              <span>縦向き</span>
              <input
                type="checkbox"
                checked={Boolean(m.vert)}
                onChange={(e) => set({ vert: e.target.checked || undefined })}
              />
            </label>
          </>
        )}
        {m.kind === 'notch' && (
          <>
            <Num label="幅" value={m.w} onChange={(w) => set({ w })} />
            <Num label="高さ" value={m.h} onChange={(h) => set({ h })} />
            <Num label="角R（R付角穴）" value={m.r ?? 0} onChange={(r) => set({ r: r || undefined })} />
            <Num label="角落としC（変形角穴）" value={m.c ?? 0} onChange={(c) => set({ c: c || undefined })} />
          </>
        )}
        {m.kind === 'dcut' && (
          <>
            <Num label="径 φ" value={m.dia} step={0.5} onChange={(dia) => set({ dia })} />
            <Num label="二面幅" value={m.across} step={0.1} onChange={(across) => set({ across })} />
            <label className="sel">
              <span>面の数</span>
              <select value={m.flats} onChange={(e) => set({ flats: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>D穴（1面）</option>
                <option value={2}>ダブルD（2面）</option>
              </select>
            </label>
          </>
        )}
        {m.kind === 'keyhole' && (
          <>
            <Num label="大穴 φ" value={m.dia} step={0.5} onChange={(dia) => set({ dia })} />
            <Num label="小穴 φ" value={m.dia2} step={0.5} onChange={(dia2) => set({ dia2 })} />
            <Num label="中心距離" value={m.pitch} step={0.5} onChange={(pitch) => set({ pitch })} />
          </>
        )}
        {m.kind === 'keyway' && (
          <>
            <Num label="径 φ" value={m.dia} step={0.5} onChange={(dia) => set({ dia })} />
            <Num label="溝幅" value={m.kw} step={0.5} onChange={(kw) => set({ kw })} />
            <Num label="溝深さ" value={m.kh} step={0.5} onChange={(kh) => set({ kh })} />
            <label className="sel">
              <span>溝の向き</span>
              <select value={m.at} onChange={(e) => set({ at: e.target.value as 'top' | 'bottom' })}>
                <option value="top">上</option>
                <option value="bottom">下</option>
              </select>
            </label>
          </>
        )}
      </div>
      {(m.kind === 'hole' || m.kind === 'slot' || m.kind === 'notch') && (
        <PilotFields value={m.pilots} kind={m.kind} onChange={(pilots) => set({ pilots })} />
      )}
    </>
  );
}
