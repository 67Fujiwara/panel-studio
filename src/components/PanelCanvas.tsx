import { useCallback, useEffect, useRef, useState } from 'react';
import { FACE_LABEL, faceSize } from '../data/faces';
import { ShapeGeometry } from './ShapeGeometry';
import { derivedMachining } from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import type { CategoryDef, FaceId, LayoutResult, Machining, PanelSpec } from '../types';

/** 手動配置時のスナップ間隔(mm) */
const SNAP = 5;
/**
 * 目盛りは 10mm 刻みが基準。
 * ただし縮小すると数字も線も潰れるので、画面上の間隔を見て段階的に間引く。
 */
const STEPS = [10, 20, 50, 100, 200, 500, 1000];
/** 数字を出すのに最低限ほしい画面上の間隔(px) */
const LABEL_MIN_PX = 30;
/** 目盛り線を引くのに最低限ほしい画面上の間隔(px) */
const TICK_MIN_PX = 4;
/** 面の中に薄く引くグリッドの間隔(mm) */
const GRID = 100;

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

/**
 * 加工1件の図形。
 * タップ穴は二重丸（外側が呼び径、内側が下穴）で、丸穴と見分けられるようにする。
 * 切り欠きは中心座標で持っているので、左下に直して描く。
 */
function cutShape(m: Machining, faceH: number) {
  if (m.kind === 'notch') {
    return (
      <rect x={m.x - m.w / 2} y={toSvgY(faceH, m.y, 0) - m.h / 2} width={m.w} height={m.h} />
    );
  }
  const cy = toSvgY(faceH, m.y, 0);
  if (!m.tap) return <circle cx={m.x} cy={cy} r={m.dia / 2} />;
  const outer = TAP_OUTER[m.tap] / 2;
  return (
    <>
      <circle cx={m.x} cy={cy} r={outer} />
      <circle cx={m.x} cy={cy} r={m.dia / 2} />
    </>
  );
}

/** タップの呼び径。二重丸の外側に使う。 */
const TAP_OUTER = { M3: 3, M4: 4, M5: 5, M6: 6 } as const;

export function PanelCanvas({ panel, face, layout, devices, categories }: Props) {
  const { w: faceW, h: faceH } = faceSize(panel, face);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>({ x: -PAD, y: -PAD, w: faceW + PAD * 2, h: faceH + PAD * 2 });
  // 目盛りの間引きと文字の大きさを画面の実寸で決めるため、描画領域の幅を測っておく
  const [pxWidth, setPxWidth] = useState(900);
  const selectedUid = useStore((s) => s.selectedUid);
  const select = useStore((s) => s.select);
  const pin = useStore((s) => s.pin);
  const manual = useStore((s) => s.machining);
  const underlay = useStore((s) => s.underlays[face]);
  const setUnderlay = useStore((s) => s.setUnderlay);
  const moveItem = useStore((s) => s.moveItem);
  const selectCut = useStore((s) => s.selectCut);
  const selectedCut = useStore((s) => s.selectedCut);
  const selectDuct = useStore((s) => s.selectDuct);
  const selectedDuct = useStore((s) => s.selectedDuct);
  const removeSelected = useStore((s) => s.removeSelected);
  const restoreDucts = useStore((s) => s.restoreDucts);
  const removedHere = useStore((s) => s.removedDucts[face]?.length ?? 0);

  // 選択中の機器・ダクトを Delete / Backspace で消す
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement;
      // 入力欄で編集しているときは消さない
      if (el instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      const s = useStore.getState();
      if (!s.selectedUid && s.selectedDuct === null) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected]);

  // 面や盤サイズが変わったら全体が入るように戻す
  useEffect(() => {
    setView({ x: -PAD, y: -PAD, w: faceW + PAD * 2, h: faceH + PAD * 2 });
  }, [faceW, faceH, face]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 0;
      if (w > 0) setPxWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  /**
   * ドラッグ中の位置から、入れ込む先の段と「どの機器の直前に入れるか」を決める。
   *
   * 段はいちばん近いものを選ぶ。ダクトの上に落としたときに段が決まらず
   * 1段目へ飛んでしまうのを避けるため、範囲に入っているかではなく距離で見る。
   */
  const dropTarget = (clientX: number, clientY: number, dragUid: string) => {
    const at = toFace(clientX, clientY);
    const rows = layout.rows;
    let targetRow = 0;
    if (rows.length > 0) {
      // 段の中心までの距離がいちばん短い段
      const nearest = rows.reduce((best, r) =>
        Math.abs(at.y - (r.y + r.h / 2)) < Math.abs(at.y - (best.y + best.h / 2)) ? r : best,
      );
      targetRow = nearest.index;
    }
    const others = layout.placed
      .filter((p) => p.uid !== dragUid)
      .sort((a, b) => a.row - b.row || a.x - b.x);
    const before = others.find((p) => {
      const w = devices.get(p.specId)?.size.w ?? 0;
      return p.row > targetRow || (p.row === targetRow && at.x < p.x + w / 2);
    });
    return { row: targetRow, before: before?.uid ?? null };
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
    /** つかんだときの段。ここから変わったら上下に動かしたとみなす */
    fromRow: number;
    lastBefore: string | null | undefined;
    lastRow: number | undefined;
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
      // 既定: 他の機器の間へ入れ込む。並び順が変わると配置がその場で組み直される。
      // 上下に動かしたときは段の指定も付け替える（並び順だけでは段は変わらないため）
      const { row, before } = dropTarget(e.clientX, e.clientY, d.uid);
      const movedRow = row !== d.fromRow ? row : undefined;
      if (before !== d.lastBefore || movedRow !== d.lastRow) {
        d.lastBefore = before;
        d.lastRow = movedRow;
        moveItem(d.uid, before, movedRow);
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

  // mm ↔ px の換算。目盛りの間引きと、拡大しても一定の大きさで見せる文字に使う
  const scale = view.w / Math.max(1, pxWidth);
  const tickStep = STEPS.find((st) => st / scale >= TICK_MIN_PX) ?? 1000;
  const labelStep = STEPS.find((st) => st / scale >= LABEL_MIN_PX) ?? 1000;
  const labelSize = 13 * scale;
  const tickLong = 14 * scale;
  const tickMid = 9 * scale;
  const tickShort = 5 * scale;
  // 数字と数字のちょうど中間に目盛りが来るときだけ、少し長い線にして数えやすくする
  const half = labelStep / 2;
  const hasHalf = half % tickStep === 0;
  const tickLen = (v: number) =>
    v % labelStep === 0 ? tickLong : hasHalf && v % half === 0 ? tickMid : tickShort;

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
          {ticks(faceW, GRID).slice(1).map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={faceH} />
          ))}
          {ticks(faceH, GRID).slice(1).map((y) => (
            <line key={`h${y}`} x1={0} y1={faceH - y} x2={faceW} y2={faceH - y} />
          ))}
        </g>

        {/* 目盛り。原点は左下 (0,0) */}
        <g className="ruler">
          {/* 下辺（X） */}
          <line x1={0} y1={faceH} x2={faceW} y2={faceH} className="axis" />
          {ticks(faceW, tickStep).map((x) => (
            <line
              key={`tx${x}`}
              x1={x}
              y1={faceH}
              x2={x}
              y2={faceH + tickLen(x)}
              className={x % labelStep === 0 ? 'major' : undefined}
            />
          ))}
          {/* 0 の目盛り値は原点の 0,0 と重なるので出さない */}
          {ticks(faceW, labelStep).slice(1).map((x) => (
            <text
              key={`lx${x}`}
              x={x}
              y={faceH + tickLong + labelSize}
              fontSize={labelSize}
              className="tick-label"
            >
              {x}
            </text>
          ))}
          {/* 左辺（Y） */}
          <line x1={0} y1={0} x2={0} y2={faceH} className="axis" />
          {ticks(faceH, tickStep).map((y) => (
            <line
              key={`ty${y}`}
              x1={0}
              y1={faceH - y}
              x2={-tickLen(y)}
              y2={faceH - y}
              className={y % labelStep === 0 ? 'major' : undefined}
            />
          ))}
          {ticks(faceH, labelStep).slice(1).map((y) => (
            <text
              key={`ly${y}`}
              x={-(tickLong + labelSize * 0.4)}
              y={faceH - y}
              fontSize={labelSize}
              className="tick-label right"
            >
              {y}
            </text>
          ))}
          {/* 原点 */}
          <circle cx={0} cy={faceH} r={3 * scale} className="origin" />
          <text
            x={-(tickLong + labelSize * 0.4)}
            y={faceH + tickLong + labelSize}
            fontSize={labelSize}
            className="tick-label origin-label right"
          >
            0,0
          </text>
        </g>

        {/*
          配線ダクト（中板のみ）。選んで Delete キーで消せる。
          消したダクトは消えたまま残らず、薄い枠と＋で位置に出して押し戻せるようにする。
        */}
        {layout.ducts.map((d) => {
          const y = toSvgY(faceH, d.y, d.h);
          if (d.removed) {
            return (
              <g
                key={`duct${d.id}`}
                className="duct-slot"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  restoreDucts(d.id);
                }}
              >
                <rect x={d.x} y={y} width={d.w} height={d.h} />
                <text x={d.x + d.w / 2} y={y + d.h / 2} fontSize={Math.min(d.h * 0.45, 16)}>
                  ＋ ダクトを戻す
                </text>
                <title>ここにダクトを戻す</title>
              </g>
            );
          }
          return (
            <rect
              key={`duct${d.id}`}
              x={d.x}
              y={y}
              width={d.w}
              height={d.h}
              className={`duct${selectedDuct === d.id ? ' selected' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                selectDuct(selectedDuct === d.id ? null : d.id);
              }}
            >
              <title>
                ダクト {d.id + 1} 本目（{Math.round(d.w)}mm）／ Delete キーで消せます
              </title>
            </rect>
          );
        })}

        {/* 機器 */}
        {layout.placed.map((p) => {
          const spec = devices.get(p.specId);
          if (!spec) return null;
          const bad = violatingUids.has(p.uid);
          const label = spec.model.split(' ')[0] ?? '';
          const fontSize = Math.min(14, Math.max(spec.size.w, spec.size.h) / 5);
          const need = label.length * fontSize * 0.6;
          // 横に入らなければ 90 度（反時計回り）に倒して縦に出す
          const horizontal = need <= spec.size.w - 4;
          const vertical = !horizontal && need <= spec.size.h - 4 && spec.size.w >= fontSize * 1.2;
          const cx = p.x + spec.size.w / 2;
          const cy = toSvgY(faceH, p.y, spec.size.h) + spec.size.h / 2;
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
                  fromRow: p.row,
                  lastBefore: undefined,
                  lastRow: undefined,
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
              {(horizontal || vertical) && !spec.shape && (
                <text
                  x={cx}
                  y={cy}
                  fontSize={fontSize}
                  clipPath={`url(#clip-${p.uid})`}
                  transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
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
          {autoCuts.map((m) => (
            <g key={m.id}>{cutShape(m, faceH)}</g>
          ))}
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
              {cutShape(m, faceH)}
            </g>
          ))}
        </g>
      </svg>

      <div className="canvas-overlay">
        {underlay && (
          <button onClick={() => setUnderlay(face, undefined)}>
            下敷き（{underlay.w}×{underlay.h}）を消す
          </button>
        )}
        {removedHere > 0 && (
          <button onClick={() => restoreDucts()}>消したダクト {removedHere} 本を全部戻す</button>
        )}
      </div>

      <div className="canvas-hint">
        {FACE_LABEL(face)}（{faceW} × {faceH}）／ 原点は左下 0,0 ／ ホイールで拡大縮小・背景ドラッグで移動 ／
        <b>機器をドラッグすると上下左右どこへでも入れ込めます</b>
        （Shift＋ドラッグで自由に置く・{SNAP}mm スナップ）／
        機器・ダクトを選んで <b>Delete</b> で削除
      </div>
    </div>
  );
}
