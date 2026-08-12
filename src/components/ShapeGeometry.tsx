import type { DeviceShape } from '../types';

/** 円弧を折れ線に置き換えるときの分割角度(rad)。約5度。 */
const ARC_STEP = Math.PI / 36;

/**
 * 部品の外形線を描く。
 *
 * 座標は「部品の左下が原点、Y 上向き」。呼び出し側で拡縮と Y 反転をかける前提。
 * 円弧は折れ線に置き換えている。Y を反転した座標系では SVG の円弧フラグの
 * 向きが逆になり、取り違えると弧が裏返るため。
 */
export function ShapeGeometry({ shape, color }: { shape: DeviceShape; color: string }) {
  return (
    <g stroke={color} fill="none" vectorEffect="non-scaling-stroke">
      {shape.entities.map((e, i) => {
        if (e.t === 'c') {
          return <circle key={i} cx={e.x} cy={e.y} r={e.r} />;
        }
        if (e.t === 'a') {
          const sweep = e.a1 >= e.a0 ? e.a1 - e.a0 : e.a1 - e.a0 + Math.PI * 2;
          const steps = Math.max(2, Math.ceil(sweep / ARC_STEP));
          const pts: string[] = [];
          for (let s = 0; s <= steps; s++) {
            const a = e.a0 + (sweep * s) / steps;
            pts.push(`${e.x + e.r * Math.cos(a)},${e.y + e.r * Math.sin(a)}`);
          }
          return <polyline key={i} points={pts.join(' ')} />;
        }
        const pts: string[] = [];
        for (let p = 0; p < e.pts.length; p += 2) pts.push(`${e.pts[p]},${e.pts[p + 1]}`);
        return e.c ? (
          <polygon key={i} points={pts.join(' ')} />
        ) : (
          <polyline key={i} points={pts.join(' ')} />
        );
      })}
    </g>
  );
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
