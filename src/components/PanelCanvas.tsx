import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_COLOR, DEVICE_BY_ID } from '../data/devices';
import { useStore } from '../store';
import type { LayoutResult, PanelSpec } from '../types';

/** 手動配置時のスナップ間隔(mm) */
const SNAP = 5;

type Props = { panel: PanelSpec; layout: LayoutResult };

type ViewBox = { x: number; y: number; w: number; h: number };

/** 中板座標(Y上向き, 原点=左下) を SVG 座標(Y下向き, 原点=左上) に変換する。 */
const toSvgY = (plateH: number, y: number, h: number) => plateH - y - h;

export function PanelCanvas({ panel, layout }: Props) {
  const { w: plateW, h: plateH } = panel.plate;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>({ x: -40, y: -40, w: plateW + 80, h: plateH + 80 });
  const selectedUid = useStore((s) => s.selectedUid);
  const select = useStore((s) => s.select);
  const pin = useStore((s) => s.pin);

  // 盤サイズが変わったら全体が入るように戻す
  useEffect(() => {
    setView({ x: -40, y: -40, w: plateW + 80, h: plateH + 80 });
  }, [plateW, plateH]);

  const violatingUids = new Set(layout.violations.map((v) => v.uid));

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
      // ポインタ位置を固定して拡大縮小する
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const nw = v.w * factor;
      const nh = v.h * factor;
      return { x: v.x + (v.w - nw) * px, y: v.y + (v.h - nh) * py, w: nw, h: nh };
    });
  };

  const panRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ uid: string; startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );

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
      const dx = (e.clientX - d.startX) * k;
      const dy = (e.clientY - d.startY) * k;
      const placed = layout.placed.find((p) => p.uid === d.uid);
      const spec = placed && DEVICE_BY_ID.get(placed.specId);
      if (!placed || !spec) return;
      const nx = Math.round((d.ox + dx) / SNAP) * SNAP;
      // SVG は Y 下向きなので、中板座標では符号が反転する
      const ny = Math.round((d.oy - dy) / SNAP) * SNAP;
      pin({
        ...placed,
        x: Math.max(0, Math.min(plateW - spec.size.w, nx)),
        y: Math.max(0, Math.min(plateH - spec.size.h, ny)),
      });
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
        {/* 中板(取付板) */}
        <rect x={0} y={0} width={plateW} height={plateH} className="plate" />

        {/* 100mm グリッド */}
        <g className="grid">
          {Array.from({ length: Math.floor(plateW / 100) }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={plateH} />
          ))}
          {Array.from({ length: Math.floor(plateH / 100) }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={(i + 1) * 100} x2={plateW} y2={(i + 1) * 100} />
          ))}
        </g>

        {/* 配線ダクト */}
        {layout.ducts.map((d, i) => (
          <rect
            key={`duct${i}`}
            x={d.x}
            y={toSvgY(plateH, d.y, d.h)}
            width={d.w}
            height={d.h}
            className="duct"
          />
        ))}

        {/* 機器 */}
        {layout.placed.map((p) => {
          const spec = DEVICE_BY_ID.get(p.specId);
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
                };
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              }}
            >
              <clipPath id={`clip-${p.uid}`}>
                <rect
                  x={p.x}
                  y={toSvgY(plateH, p.y, spec.size.h)}
                  width={spec.size.w}
                  height={spec.size.h}
                />
              </clipPath>
              <rect
                x={p.x}
                y={toSvgY(plateH, p.y, spec.size.h)}
                width={spec.size.w}
                height={spec.size.h}
                fill={CATEGORY_COLOR[spec.category]}
              />
              {labelFits && (
                <text
                  x={p.x + spec.size.w / 2}
                  y={toSvgY(plateH, p.y, spec.size.h) + spec.size.h / 2}
                  fontSize={fontSize}
                  clipPath={`url(#clip-${p.uid})`}
                >
                  {label}
                </text>
              )}
              {p.pinned && (
                <circle cx={p.x + 5} cy={toSvgY(plateH, p.y, spec.size.h) + 5} r={3} className="pin" />
              )}
            </g>
          );
        })}
      </svg>

      <div className="canvas-hint">
        ホイールで拡大縮小 / 背景ドラッグで移動 / 機器ドラッグで手動配置（{SNAP}mm スナップ）
      </div>
    </div>
  );
}
