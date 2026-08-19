import { cutOutline, cutParts, outlinePolys, pilotDia, pilotPoints } from '../lib/holes';
import { ShapeGeometry } from './ShapeGeometry';
import type { DeviceSpec, MachiningDraft } from '../types';

/**
 * 部品の加工プレビュー。
 *
 * 取付穴・パネル開口・追加加工は数字の欄だけだとイメージが付かないので、
 * 入力の右に**実寸比の図**で出す。数字を打てばその場で図が変わるので、
 * ピッチの向きを取り違えた・PCD が大きすぎた、に打った瞬間に気づける。
 *
 * 描き方はレイアウト画面と同じ（外形はグレー、加工は赤、ねじ下穴は小さい丸）。
 * 図が別の描き方をすると、レイアウトに置いたとき「プレビューと違う」が起きる。
 */
export function PartFigure({ part, color }: { part: DeviceSpec; color: string }) {
  const w = part.size.w;
  const h = part.size.h;
  const cx = w / 2;
  const cy = h / 2;

  // 図の範囲。外形だけでなく、外へはみ出す加工（PCD・持ち出しの下穴）も入るように取る
  let minX = 0;
  let minY = 0;
  let maxX = w;
  let maxY = h;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const c of part.extraCuts ?? []) {
    for (const q of cutParts(c)) {
      const px = cx + c.x + q.x;
      const py = cy + c.y + q.y;
      if (q.t === 'c') grow(px - q.r, py - q.r, px + q.r, py + q.r);
      else grow(px - q.w / 2, py - q.h / 2, px + q.w / 2, py + q.h / 2);
    }
  }
  const pad = Math.max(8, (maxX - minX) * 0.05);
  const vb = `${minX - pad} ${-(maxY + pad)} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  // 取付穴の中心。derivedMachining と同じ「中心からピッチで展開」
  const holes: { x: number; y: number }[] = [];
  const mh = part.mountHoles;
  if (mh) {
    const nx = Math.max(1, mh.countX);
    const ny = Math.max(1, mh.countY);
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        holes.push({
          x: cx + (nx === 1 ? 0 : (ix - (nx - 1) / 2) * mh.pitchX),
          y: cy + (ny === 1 ? 0 : (iy - (ny - 1) / 2) * mh.pitchY),
        });
      }
    }
  }

  return (
    <div className="cutfig">
      <h4>加工プレビュー</h4>
      {/* 面の座標は Y 上向きなので、まとめて反転して SVG に写す（文字は入れない） */}
      <svg viewBox={vb}>
        <g transform="scale(1 -1)">
          {/* 外形。取り込んだ外形線があればそれも薄く敷く */}
          <rect className="body" x={0} y={0} width={w} height={h} />
          {part.shape && (
            <g
              className="bodyshape"
              transform={`scale(${w / (part.shape.w || 1)} ${h / (part.shape.h || 1)})`}
            >
              <ShapeGeometry shape={part.shape} color="currentColor" />
            </g>
          )}
          {/* 中心の目印 */}
          <line className="axis" x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} />
          <line className="axis" x1={cx} y1={cy - 5} x2={cx} y2={cy + 5} />

          {/* 取付穴 */}
          {holes.map((p, i) => (
            <circle key={`m${i}`} className="cut" cx={p.x} cy={p.y} r={(mh?.dia ?? 0) / 2} />
          ))}

          {/* パネル開口 */}
          {part.panelCutout?.kind === 'hole' && (
            <circle className="cut" cx={cx} cy={cy} r={part.panelCutout.dia / 2} />
          )}
          {part.panelCutout?.kind === 'notch' && (
            <rect
              className="cut"
              x={cx - part.panelCutout.w / 2}
              y={cy - part.panelCutout.h / 2}
              width={part.panelCutout.w}
              height={part.panelCutout.h}
            />
          )}

          {/* 追加加工。描き方はレイアウト画面と同じ分解（holes.ts）を使う */}
          {(part.extraCuts ?? []).map((c, i) => (
            <ExtraCut key={`x${i}`} c={c} cx={cx} cy={cy} />
          ))}
        </g>
      </svg>
      <p className="note" style={{ color }}>
        グレーが外形、赤が加工（実寸比）。数値を直すと図もその場で変わります。
      </p>
    </div>
  );
}

function ExtraCut({ c, cx, cy }: { c: MachiningDraft; cx: number; cy: number }) {
  const ox = cx + c.x;
  const oy = cy + c.y;
  const { parts, circles } = cutOutline(c);
  const polys = outlinePolys(parts);
  const pd = pilotDia(c) / 2;
  return (
    <>
      {circles.map((q, i) => (
        <circle key={`c${i}`} className="cut" cx={ox + q.x} cy={oy + q.y} r={q.r} />
      ))}
      {polys.map((pts, i) => (
        <polyline
          key={`p${i}`}
          className="cut"
          points={pts.map((p) => `${ox + p.x},${oy + p.y}`).join(' ')}
        />
      ))}
      {pd > 0 &&
        pilotPoints(c).map((p, i) => (
          <circle key={`s${i}`} className="cut" cx={ox + p.x} cy={oy + p.y} r={pd} />
        ))}
    </>
  );
}
