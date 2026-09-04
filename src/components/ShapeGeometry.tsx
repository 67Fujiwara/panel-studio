import type { DeviceShape } from '../types';

/** 円弧を折れ線に置き換えるときの分割角度(rad)。約5度。 */
const ARC_STEP = Math.PI / 36;

/**
 * 外形線1つぶんの SVG パス文字列。**図形データごとに1回だけ作って覚える。**
 *
 * 以前は線1本ごとに <polyline> を出していた。26,000 本の部品が1台あるだけで
 * DOM が 26,000 個増え、ドラッグのたびに React がそれを全部作り直していた。
 * 1つの <path d> にまとめれば DOM は1個、d の文字列は最初の1回しか作らない
 * （同じ図形オブジェクトが来る限り、WeakMap から取り出すだけ）。
 */
const pathCache = new WeakMap<DeviceShape, string>();

function arcPoints(x: number, y: number, r: number, a0: number, a1: number): string {
  const sweep = a1 >= a0 ? a1 - a0 : a1 - a0 + Math.PI * 2;
  const steps = Math.max(2, Math.ceil(sweep / ARC_STEP));
  let d = '';
  for (let s = 0; s <= steps; s++) {
    const a = a0 + (sweep * s) / steps;
    d += `${s === 0 ? 'M' : 'L'}${x + r * Math.cos(a)} ${y + r * Math.sin(a)}`;
  }
  return d;
}

export function shapePath(shape: DeviceShape): string {
  const hit = pathCache.get(shape);
  if (hit !== undefined) return hit;
  const parts: string[] = [];
  for (const e of shape.entities) {
    if (e.t === 'c') {
      // 円は2つの半円弧で描く（1つの弧では同じ点に戻れないため）
      parts.push(
        `M${e.x - e.r} ${e.y}A${e.r} ${e.r} 0 1 0 ${e.x + e.r} ${e.y}A${e.r} ${e.r} 0 1 0 ${e.x - e.r} ${e.y}`,
      );
    } else if (e.t === 'a') {
      // 円弧は折れ線に。Y を反転した座標系では SVG の弧フラグの向きが逆になり、
      // 取り違えると弧が裏返るため
      parts.push(arcPoints(e.x, e.y, e.r, e.a0, e.a1));
    } else {
      let d = '';
      for (let p = 0; p + 1 < e.pts.length; p += 2) d += `${p === 0 ? 'M' : 'L'}${e.pts[p]} ${e.pts[p + 1]}`;
      if (e.c) d += 'Z';
      parts.push(d);
    }
  }
  const d = parts.join('');
  pathCache.set(shape, d);
  return d;
}

/**
 * 部品の外形線を描く。
 *
 * 座標は「部品の左下が原点、Y 上向き」。呼び出し側で拡縮と Y 反転をかける前提。
 */
export function ShapeGeometry({ shape, color }: { shape: DeviceShape; color: string }) {
  return <path d={shapePath(shape)} stroke={color} fill="none" vectorEffect="non-scaling-stroke" />;
}

/**
 * 部品ひとつぶんの外形線を、指定サイズの枠に収めて表示する（編集画面のプレビュー用）。
 *
 * 外形線のまわりに余白は作らない。余白があると「部品自体に隙間がある」と
 * 読めてしまい、実物の大きさを取り違えるため。枠は外形線にぴったり合わせ、
 * 線の太さのはみ出しだけ切らないようにしている。
 */
export function ShapePreview({
  shape,
  color,
  size = 120,
}: {
  shape: DeviceShape;
  color: string;
  size?: number;
}) {
  const scale = Math.min(size / (shape.w || 1), size / (shape.h || 1));
  const w = shape.w * scale;
  const h = shape.h * scale;
  return (
    <svg className="shapepreview" width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
      <g transform={`translate(0 ${h}) scale(${scale} ${-scale})`}>
        <ShapeGeometry shape={shape} color={color} />
      </g>
    </svg>
  );
}
