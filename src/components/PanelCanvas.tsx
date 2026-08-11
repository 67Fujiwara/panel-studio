import { useCallback, useEffect, useRef, useState } from 'react';
import { FACE_LABEL, faceSize } from '../data/faces';
import { ShapeGeometry } from './ShapeGeometry';
import { derivedMachining } from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import type { CategoryDef, FaceId, LayoutResult, PanelSpec } from '../types';

/** 手動配置時のスナップ間隔(mm) */
const SNAP = 5;
/** 目盛りの主目盛り・補助目盛り(mm) */
const MAJOR = 100;
const MINOR = 50;

type Props = {
  panel: PanelSpec;
  face: FaceId;
  layout: LayoutResult;
  devices: DeviceLookup;
  categories: CategoryDef[];
};

type ViewBox = { x: number; y: number; w: number; h: number };

/** 面の座標(Y上向き, 原点=左下) を SVG 座標(Y下向き, 原点=左上) に変換する。 */
const toSvgY = (faceH: number, y: number, h: number) => faceH - y - h;

/** 目盛りのぶん、面のまわりに取る余白(mm) */
const PAD = 70;

export function PanelCanvas({ panel, face, layout, devices, categories }: Props) {
  const { w: faceW, h: faceH } = faceSize(panel, face);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>({ x: -PAD, y: -PAD, w: faceW + PAD * 2, h: faceH + PAD * 2 });
  const selectedUid = useStore((s) => s.selectedUid);
  const select = useStore((s) => s.select);
  const pin = useStore((s) => s.pin);
  const manual = useStore((s) => s.machining);
  const underlay = useStore((s) => s.underlays[face]);
  const setUnderlay = useStore((s) => s.setUnderlay);
  const moveItem = useStore((s) => s.moveItem);
  const selectCut = useStore((s) => s.selectCut);
  const selectedCut = useStore((s) => s.selectedCut);

  // 面や盤サイズが変わったら全体が入るように戻す
  useEffect(() => {
    setView({ x: -PAD, y: -PAD, w: faceW + PAD * 2, h: faceH + PAD * 2 });
  }, [faceW, faceH, face]);

  const colorOf = (cat: string) => categories.find((c) => c.id === cat)?.color ?? '#7d8894';
  const violatingUids = new Set(layout.violations.map((v) => v.uid));
  const autoCuts = derivedMachining(layout.placed, devices);
  const manualCuts = manual.filter((m) => m.face === face);

  /** 画面上の座標を面の座標(mm, 左下原点)に直す。viewBox の余白も含めて正確に変換する。 */
  const toFace = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: faceH - p.y };
  };

  /** ドラッグ中の位置から「どの機器の直前に入れるか」を決める。 */
  const insertBefore = (clientX: number, clientY: number, dragUid: string) => {
    const at = toFace(clientX, clientY);
    const rows = layout.rows;
    let targetRow = 0;
    if (rows.length > 0) {
      const hit = rows.find((r) => at.y >= r.y && at.y <= r.y + r.h);
      if (hit) targetRow = hit.index;
      else if (at.y < rows[rows.length - 1]!.y) targetRow = rows[rows.length - 1]!.index;
    }
    const others = layout.placed
      .filter((p) => p.uid !== dragUid)
      .sort((a, b) => a.row - b.row || a.x - b.x);
    const before = others.find((p) => {
      const w = devices.get(p.specId)?.size.w ?? 0;
      return p.row > targetRow || (p.row === targetRow && at.x < p.x + w / 2);
    });
    return before?.uid ?? null;
  };

  /** 画面上の px を mm に変換する係数 */
  const mmPerPx = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    return view.w / rect.width;
  }, [view.w]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    setView((v) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return v;
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const nw = v.w * factor;
      const nh = v.h * factor;
      return { x: v.x + (v.w - nw) * px, y: v.y + (v.h - nh) * py, w: nw, h: nh };
    });
  };

  const panRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    uid: string;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    /** Shift 併用のときは並べ替えではなく座標を自由に動かす */
    free: boolean;
    lastBefore: string | null | undefined;
  } | null>(null);

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panRef.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    select(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const k = mmPerPx();
    if (dragRef.current) {
      const d = dragRef.current;
      if (d.free) {
        // Shift 併用: 座標を自由に動かして固定する
        const dx = (e.clientX - d.startX) * k;
        const dy = (e.clientY - d.startY) * k;
        const placed = layout.placed.find((p) => p.uid === d.uid);
        const spec = placed && devices.get(placed.specId);
        if (!placed || !spec) return;
        const nx = Math.round((d.ox + dx) / SNAP) * SNAP;
        // SVG は Y 下向きなので、面の座標では符号が反転する
        const ny = Math.round((d.oy - dy) / SNAP) * SNAP;
        pin({
          ...placed,
          x: Math.max(0, Math.min(faceW - spec.size.w, nx)),
          y: Math.max(0, Math.min(faceH - spec.size.h, ny)),
        });
        return;
      }
      // 既定: 他の機器の間へ入れ込む。並び順が変わると配置がその場で組み直される
      const before = insertBefore(e.clientX, e.clientY, d.uid);
      if (before !== d.lastBefore) {
        d.lastBefore = before;
        moveItem(d.uid, before);
      }
      return;
    }
    if (panRef.current) {
      const dx = (e.clientX - panRef.current.x) * k;
      const dy = (e.clientY - panRef.current.y) * k;
      panRef.current = { x: e.clientX, y: e.clientY };
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  };

  const endPointer = () => {
    panRef.current = null;
    dragRef.current = null;
  };

  const ticks = (length: number, step: number) =>
    Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => i * step);

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
      >
        <rect x={0} y={0} width={faceW} height={faceH} className="plate" />

        {/*
          DXF から取り込んだ下敷き。
          実寸 mm のまま 1:1 で敷く。面の大きさに引き伸ばすと図が歪むうえ、
          寸法が合っていないことに気づけなくなるため。
        */}
        {underlay && (
          <g className="underlay" transform={`translate(0 ${faceH}) scale(1 -1)`}>
            <ShapeGeometry shape={underlay} color="currentColor" />
          </g>
        )}

        {/* 100mm グリッド */}
        <g className="grid">
          {ticks(faceW, MAJOR).slice(1).map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={faceH} />
          ))}
          {ticks(faceH, MAJOR).slice(1).map((y) => (
            <line key={`h${y}`} x1={0} y1={faceH - y} x2={faceW} y2={faceH - y} />
          ))}
        </g>

        {/* 目盛り。原点は左下 (0,0) */}
        <g className="ruler">
          {/* 下辺（X） */}
          <line x1={0} y1={faceH} x2={faceW} y2={faceH} className="axis" />
          {ticks(faceW, MINOR).map((x) => (
            <line
              key={`tx${x}`}
              x1={x}
              y1={faceH}
              x2={x}
              y2={faceH + (x % MAJOR === 0 ? 14 : 7)}
            />
          ))}
          {/* 0 の目盛り値は原点の 0,0 と重なるので出さない */}
          {ticks(faceW, MAJOR).slice(1).map((x) => (
            <text key={`lx${x}`} x={x} y={faceH + 32} className="tick-label">
              {x}
            </text>
          ))}
          {/* 左辺（Y） */}
          <line x1={0} y1={0} x2={0} y2={faceH} className="axis" />
          {ticks(faceH, MINOR).map((y) => (
            <line
              key={`ty${y}`}
              x1={0}
              y1={faceH - y}
              x2={-(y % MAJOR === 0 ? 14 : 7)}
              y2={faceH - y}
            />
          ))}
          {ticks(faceH, MAJOR).slice(1).map((y) => (
            <text key={`ly${y}`} x={-18} y={faceH - y} className="tick-label right">
              {y}
            </text>
          ))}
          {/* 原点 */}
          <circle cx={0} cy={faceH} r={4} className="origin" />
          <text x={-20} y={faceH + 32} className="tick-label origin-label right">
            0,0
          </text>
        </g>

        {/* 配線ダクト（中板のみ） */}
        {layout.ducts.map((d, i) => (
          <rect
            key={`duct${i}`}
            x={d.x}
            y={toSvgY(faceH, d.y, d.h)}
            width={d.w}
            height={d.h}
            className="duct"
          />
        ))}

        {/* 機器 */}
        {layout.placed.map((p) => {
          const spec = devices.get(p.specId);
          if (!spec) return null;
          const bad = violatingUids.has(p.uid);
          const label = spec.model.split(' ')[0] ?? '';
          const fontSize = Math.min(14, spec.size.w / 5);
          // 収まらないラベルは出さない（clipPath で切ると読めない文字列が残るため）
          const labelFits = label.length * fontSize * 0.6 <= spec.size.w - 4;
          return (
            <g
              key={p.uid}
              className={`device${selectedUid === p.uid ? ' selected' : ''}${bad ? ' violation' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                select(p.uid);
                dragRef.current = {
                  uid: p.uid,
                  startX: e.clientX,
                  startY: e.clientY,
                  ox: p.x,
                  oy: p.y,
                  free: e.shiftKey,
                  lastBefore: undefined,
                };
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              }}
            >
              <clipPath id={`clip-${p.uid}`}>
                <rect
                  x={p.x}
                  y={toSvgY(faceH, p.y, spec.size.h)}
                  width={spec.size.w}
                  height={spec.size.h}
                />
              </clipPath>
              <rect
                x={p.x}
                y={toSvgY(faceH, p.y, spec.size.h)}
                width={spec.size.w}
                height={spec.size.h}
                fill={colorOf(spec.category)}
                fillOpacity={spec.shape ? 0.14 : 1}
              />
              {spec.shape && (
                // 部品の座標系は左下原点・Y上向きなので、拡縮と同時に Y を反転する
                <g
                  transform={`translate(${p.x} ${faceH - p.y}) scale(${
                    spec.size.w / (spec.shape.w || 1)
                  } ${-spec.size.h / (spec.shape.h || 1)})`}
                >
                  <ShapeGeometry shape={spec.shape} color={colorOf(spec.category)} />
                </g>
              )}
              {labelFits && !spec.shape && (
                <text
                  x={p.x + spec.size.w / 2}
                  y={toSvgY(faceH, p.y, spec.size.h) + spec.size.h / 2}
                  fontSize={fontSize}
                  clipPath={`url(#clip-${p.uid})`}
                >
                  {label}
                </text>
              )}
              {p.pinned && (
                <circle cx={p.x + 5} cy={toSvgY(faceH, p.y, spec.size.h) + 5} r={3} className="pin" />
              )}
            </g>
          );
        })}

        {/* 加工（穴・切り欠き）。機器の上に重ねて描き、隠れないようにする */}
        <g className="cutouts">
          {autoCuts.map((m) =>
            m.kind === 'hole' ? (
              <circle key={m.id} cx={m.x} cy={toSvgY(faceH, m.y, 0)} r={m.dia / 2} />
            ) : (
              <rect key={m.id} x={m.x} y={toSvgY(faceH, m.y, m.h)} width={m.w} height={m.h} />
            ),
          )}
          {/* 手で足した加工は選べる。選ぶと色を変えて強調する */}
          {manualCuts.map((m) => (
            <g
              key={m.id}
              className={`cut${selectedCut === m.id ? ' on' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                selectCut(selectedCut === m.id ? null : m.id);
              }}
            >
              {m.kind === 'hole' ? (
                <circle cx={m.x} cy={toSvgY(faceH, m.y, 0)} r={m.dia / 2} />
              ) : (
                <rect x={m.x} y={toSvgY(faceH, m.y, m.h)} width={m.w} height={m.h} />
              )}
            </g>
          ))}
        </g>
      </svg>

      {underlay && (
        <button className="underlay-clear" onClick={() => setUnderlay(face, undefined)}>
          下敷き（{underlay.w}×{underlay.h}）を消す
        </button>
      )}

      <div className="canvas-hint">
        {FACE_LABEL(face)}（{faceW} × {faceH}）／ 原点は左下 0,0 ／ ホイールで拡大縮小・背景ドラッグで移動 ／
        <b>機器をドラッグすると他の機器の間に入ります</b>（Shift＋ドラッグで自由に置く・{SNAP}mm スナップ）
      </div>
    </div>
  );
}
