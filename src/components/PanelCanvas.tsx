import { useCallback, useEffect, useRef, useState } from 'react';
import { DIN_RAIL_WIDTH } from '../data/enclosures';
import { FACE_LABEL, faceSize } from '../data/faces';
import { computeRails } from '../lib/layout';
import { ShapeGeometry } from './ShapeGeometry';
import { autoMachining } from '../lib/machining';
import type { DeviceLookup } from '../lib/layout';
import { useStore } from '../store';
import { ductSpecAt, rotatedSize } from '../types';
import type {
  CategoryDef,
  Duct,
  DuctTarget,
  FaceId,
  LayoutResult,
  Machining,
  PanelSpec,
} from '../types';

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewBox>({ x: -PAD, y: -PAD, w: faceW + PAD * 2, h: faceH + PAD * 2 });
  // 目盛りの間引きと文字の大きさを画面の実寸で決めるため、描画領域の大きさを測っておく
  const [pxSize, setPxSize] = useState({ w: 900, h: 700 });
  const profile = useStore((s) => s.profile);
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
  const rotateItem = useStore((s) => s.rotateItem);
  const setDuctSpecAt = useStore((s) => s.setDuctSpecAt);
  const ductMaster = useStore((s) => s.ducts);
  /** ダクトをダブルクリックしたときに出す型式の一覧。位置は canvas-wrap の中の座標 */
  const [ductPick, setDuctPick] = useState<{
    target: DuctTarget;
    x: number;
    y: number;
  } | null>(null);
  /** そのダクト1本を名指しする指定。横は上からの通し番号、縦は左から何本目か */
  const targetOf = (d: Duct): DuctTarget => (d.vert === undefined ? d.id : { vert: d.vert });
  /** そのダクトに効いている型式名。ツールチップに出す */
  const ductNameOf = (d: Duct) => ductSpecAt(profile, ductMaster, targetOf(d)).model;
  const restoreDucts = useStore((s) => s.restoreDucts);
  const removedHere = useStore((s) => s.removedDucts[face]?.length ?? 0);

  // 選択中の機器・ダクトを Delete / Backspace で消す。Esc は型式の一覧を閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setDuctPick(null);
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
      const h = e?.contentRect.height ?? 0;
      if (w > 0 && h > 0) setPxSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colorOf = (cat: string) => categories.find((c) => c.id === cat)?.color ?? '#7d8894';
  const violatingUids = new Set(layout.violations.map((v) => v.uid));
  const autoCuts = autoMachining(face, layout, devices, profile);
  const manualCuts = manual.filter((m) => m.face === face);
  const rails = computeRails(layout, devices, profile.rail.endMargin);

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
      const spec = devices.get(p.specId);
      const w = spec ? rotatedSize(spec.size, p.rot).w : 0;
      return p.row > targetRow || (p.row === targetRow && at.x < p.x + w / 2);
    });
    return { row: targetRow, before: before?.uid ?? null };
  };

  /** 画面上の px を mm に変換する係数 */
  const mmPerPx = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return 1;
    // 上と同じ理由で、縦横のうち縮尺を決めるほうを採る
    return Math.max(view.w / rect.width, view.h / rect.height);
  }, [view.w, view.h]);

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
    /** つかんだ時点の段割り。他の機器を動かさないために使う */
    rowsAtGrab: Map<string, number>;
    lastBefore: string | null | undefined;
    lastRow: number | undefined;
  } | null>(null);

  /** ドラッグ中は文字が選択されないようにする。図の外へ出ても効くよう body に付ける。 */
  const holdSelection = (on: boolean) => document.body.classList.toggle('dragging', on);

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    holdSelection(true);
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
        const size = rotatedSize(spec.size, placed.rot);
        const nx = Math.round((d.ox + dx) / SNAP) * SNAP;
        // SVG は Y 下向きなので、面の座標では符号が反転する
        const ny = Math.round((d.oy - dy) / SNAP) * SNAP;
        pin({
          ...placed,
          x: Math.max(0, Math.min(faceW - size.w, nx)),
          y: Math.max(0, Math.min(faceH - size.h, ny)),
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
        // つかむ前の段割りを渡して、動かした1台以外は今の段にとどめる
        moveItem(d.uid, before, movedRow, d.rowsAtGrab);
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
    holdSelection(false);
  };

  // 図から離れたところでボタンを放しても選択止めを解く
  useEffect(() => {
    const off = () => holdSelection(false);
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
    return () => {
      window.removeEventListener('pointerup', off);
      window.removeEventListener('pointercancel', off);
      holdSelection(false);
    };
  }, []);

  const ticks = (length: number, step: number) =>
    Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => i * step);

  /*
    mm ↔ px の換算。目盛りの間引きと、拡大しても一定の大きさで見せる文字に使う。

    viewBox は既定の `xMidYMid meet` なので、**縦横で余るほうではなく足りないほう**が
    実際の縮尺を決める。幅だけで割ると、側面のような縦長の面で縮尺を小さく見積もり、
    目盛りの数字が読めない大きさになる。
  */
  const scale = Math.max(view.w / Math.max(1, pxSize.w), view.h / Math.max(1, pxSize.h));
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
    <div className="canvas-wrap" ref={wrapRef}>
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
              onDoubleClick={(e) => {
                // ダブルクリックで型式の一覧を出して選ばせる。縦横どちらも1本単位
                e.stopPropagation();
                const box = wrapRef.current?.getBoundingClientRect();
                setDuctPick({
                  target: targetOf(d),
                  x: e.clientX - (box?.left ?? 0),
                  y: e.clientY - (box?.top ?? 0),
                });
              }}
            >
              <title>
                {ductNameOf(d)}／
                {d.vert === undefined
                  ? `横ダクト ${d.id + 1} 本目（幅 ${Math.round(d.h)}mm）`
                  : `縦ダクト 左から ${d.vert + 1} 本目（幅 ${Math.round(d.w)}mm）`}
                {'\n'}ダブルクリックで型式を選ぶ・Delete キーで削除
              </title>
            </rect>
          );
        })}

        {/* DINレール。両端の余長は設定で決まる。機器の下に敷く */}
        {rails.map((r) => (
          <rect
            key={`rail${r.row}`}
            x={r.x}
            y={toSvgY(faceH, r.y + DIN_RAIL_WIDTH / 2, 0)}
            width={r.length}
            height={DIN_RAIL_WIDTH}
            className="rail"
          >
            <title>
              DINレール {r.row + 1} 段目 — 切断長 {Math.round(r.length)}mm
            </title>
          </rect>
        ))}

        {/* 機器 */}
        {layout.placed.map((p) => {
          const spec = devices.get(p.specId);
          if (!spec) return null;
          const bad = violatingUids.has(p.uid);
          const label = spec.model.split(' ')[0] ?? '';
          // 見かけの寸法。90/270 回すと幅と高さが入れ替わる
          const size = rotatedSize(spec.size, p.rot);
          const fontSize = Math.min(14, Math.max(size.w, size.h) / 5);
          const need = label.length * fontSize * 0.6;
          // 横に入らなければ 90 度（反時計回り）に倒して縦に出す
          const horizontal = need <= size.w - 4;
          const vertical = !horizontal && need <= size.h - 4 && size.w >= fontSize * 1.2;
          const cx = p.x + size.w / 2;
          const cy = toSvgY(faceH, p.y, size.h) + size.h / 2;
          return (
            <g
              key={p.uid}
              className={`device${spec.shape ? ' shaped' : ''}${
                selectedUid === p.uid ? ' selected' : ''
              }${bad ? ' violation' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                holdSelection(true);
                select(p.uid);
                dragRef.current = {
                  uid: p.uid,
                  startX: e.clientX,
                  startY: e.clientY,
                  ox: p.x,
                  oy: p.y,
                  free: e.shiftKey,
                  fromRow: p.row,
                  rowsAtGrab: new Map(layout.placed.map((q) => [q.uid, q.row])),
                  lastBefore: undefined,
                  lastRow: undefined,
                };
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              }}
              onDoubleClick={(e) => {
                // ダブルクリックで 90° ずつ回す
                e.stopPropagation();
                rotateItem(p.uid);
              }}
            >
              <clipPath id={`clip-${p.uid}`}>
                <rect x={p.x} y={toSvgY(faceH, p.y, size.h)} width={size.w} height={size.h} />
              </clipPath>
              {/*
                CAD の外形線がある機器は、外形線そのものが機器の姿。
                四角の枠と塗りは出さない。枠があると外形線との間が「隙間」に見えて、
                隣の機器との間隔を読み違えるため（当たり判定用に透明なまま残す）。
              */}
              <rect
                x={p.x}
                y={toSvgY(faceH, p.y, size.h)}
                width={size.w}
                height={size.h}
                fill={spec.shape ? 'transparent' : colorOf(spec.category)}
              />
              {spec.shape && (
                /*
                  回転は外形の中心まわりで掛ける。SVG は Y 下向きなので、
                  面の座標での反時計回りは SVG では逆回りになる。
                  その内側で、部品の座標系（左下原点・Y上向き）を中心合わせで敷く。
                */
                <g transform={`rotate(${-(p.rot ?? 0)} ${cx} ${cy})`}>
                  <g
                    transform={`translate(${cx - spec.size.w / 2} ${cy + spec.size.h / 2}) scale(${
                      spec.size.w / (spec.shape.w || 1)
                    } ${-spec.size.h / (spec.shape.h || 1)})`}
                  >
                    <ShapeGeometry shape={spec.shape} color={colorOf(spec.category)} />
                  </g>
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
                <circle cx={p.x + 5} cy={toSvgY(faceH, p.y, size.h) + 5} r={3} className="pin" />
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

      {/* ダクトの型式を選ぶ一覧。ダブルクリックした場所に出す */}
      {ductPick && (
        <>
          <div className="pick-veil" onPointerDown={() => setDuctPick(null)} />
          <div
            className="ductpick"
            style={{
              left: Math.min(ductPick.x, Math.max(0, (wrapRef.current?.clientWidth ?? 0) - 240)),
              top: Math.min(ductPick.y, Math.max(0, (wrapRef.current?.clientHeight ?? 0) - 220)),
            }}
          >
            <div className="ductpick-head">
              {ductPick.target === 'all'
                ? 'ダクトの型式（盤ぜんたい）'
                : typeof ductPick.target === 'number'
                  ? `横ダクト ${ductPick.target + 1} 本目の型式`
                  : `縦ダクト 左から ${ductPick.target.vert + 1} 本目の型式`}
            </div>
            <ul>
              {ductMaster.map((d) => {
                const cur = ductSpecAt(profile, ductMaster, ductPick.target).id === d.id;
                return (
                  <li key={d.id}>
                    <button
                      className={cur ? 'on' : undefined}
                      onClick={() => {
                        setDuctSpecAt(ductPick.target, d.id);
                        setDuctPick(null);
                      }}
                    >
                      <strong>{d.model}</strong>
                      <span>
                        幅 {d.width} / 高さ {d.height}
                      </span>
                    </button>
                  </li>
                );
              })}
              {/* 1本だけ変えたものを元に戻せるようにしておく */}
              {ductPick.target !== 'all' &&
                (typeof ductPick.target === 'number'
                  ? profile.duct.ductGaps?.[ductPick.target]?.ductId
                  : profile.duct.vertGaps?.[ductPick.target.vert]?.ductId) && (
                  <li>
                    <button
                      onClick={() => {
                        setDuctSpecAt(ductPick.target, '');
                        setDuctPick(null);
                      }}
                    >
                      <strong>盤ぜんたいと同じに戻す</strong>
                    </button>
                  </li>
                )}
              {ductMaster.length === 0 && (
                <li className="note">設定画面のダクトマスタに型式を登録してください。</li>
              )}
            </ul>
          </div>
        </>
      )}

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
        機器・ダクトを選んで <b>Delete</b> で削除 ／
        <b>ダブルクリック</b>で機器は90°回転・ダクトは型式を選ぶ
      </div>
    </div>
  );
}
