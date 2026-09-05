/**
 * 外形線の軽量化。
 *
 * CAD から出る DXF は、曲線を数百本の短い LINE に刻んだり、ブロックの重なりで
 * 同じ線を何本も持っていたりする。1部品で 26,000 本という例が実際にあり、
 * それを1本ずつ描くと図が重くなる（ドラッグ1コマ 40ms 超）。
 *
 * ここでやること（見た目は変えない）:
 *  1. 座標を 0.01mm に丸める（浮動小数のゴミで「つながらない」を防ぐ）
 *  2. 同じ線・長さゼロの線を捨てる
 *  3. 端点がつながる線を**1本の折れ線に連結**する（26,000 本 → 数百本）
 *  4. 折れ線を Douglas–Peucker（許容 0.05mm）で間引く（曲線の刻みを落とす）
 *
 * 0.05mm は、この図を最大まで拡大しても 1px に満たない差。寸法・加工には
 * 外形線を使わないので、精度が要る場所には影響しない。
 */
import type { DeviceShape, ShapeEntity } from '../types';

/** 間引きの許容差(mm) */
export const LITE_TOL = 0.05;
/** 座標の丸め(mm)。端点の一致判定にも使う */
const GRID = 0.01;

type Pt = { x: number; y: number };

const snap = (v: number) => Math.round(v / GRID) * GRID;
const r2 = (v: number) => Math.round(v * 100) / 100;
const key = (p: Pt) => `${Math.round(p.x / GRID)},${Math.round(p.y / GRID)}`;

/** Douglas–Peucker。両端は必ず残す */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a]!.x;
    const ay = pts[a]!.y;
    const dx = pts[b]!.x - ax;
    const dy = pts[b]!.y - ay;
    const l2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      /*
       * 距離は**線分**に対して測る（無限に伸ばした直線ではなく）。
       * 直線への距離で見ると、行って戻る形（突起）の先端が「直線上にある」と
       * 判定されて落ち、4mm の突起が消える。線分なら端からの距離になって残る。
       * 両端が同じ点（閉じた輪）のときも、自然に端からの距離になる
       */
      const px = pts[i]!.x - ax;
      const py = pts[i]!.y - ay;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 折れ線の点列を作る（連続する同じ点は1つに） */
function toPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const p = { x: snap(flat[i]!), y: snap(flat[i + 1]!) };
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/**
 * 線分・折れ線を端点でつなぐ。
 *
 * 各折れ線の両端をキーにした帳簿を作り、端がちょうど1本だけとつながるところを
 * たどって延ばす。分岐（3本以上が集まる点）ではつながない — どちらへ延ばしても
 * 同じ図になるが、無理につなぐと1本が異様に長くなり、間引きの効きが悪くなる。
 */
function chain(polys: Pt[][]): Pt[][] {
  const ends = new Map<string, number[]>(); // 端点キー → その端を持つ折れ線の番号
  const add = (k: string, i: number) => ends.set(k, [...(ends.get(k) ?? []), i]);
  polys.forEach((p, i) => {
    add(key(p[0]!), i);
    if (p.length > 1) add(key(p[p.length - 1]!), i);
  });
  const used = new Uint8Array(polys.length);
  const out: Pt[][] = [];

  const other = (k: string, self: number) => {
    const list = (ends.get(k) ?? []).filter((i) => i !== self && !used[i]);
    // ちょうど1本だけがつながるときだけ延ばす（分岐は切る）
    return list.length === 1 ? list[0]! : -1;
  };

  for (let i = 0; i < polys.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let cur = [...polys[i]!];
    // 末尾側へ延ばす
    for (;;) {
      const tail = cur[cur.length - 1]!;
      const j = other(key(tail), -1);
      if (j < 0) break;
      const p = polys[j]!;
      used[j] = 1;
      const seg = key(p[0]!) === key(tail) ? p : [...p].reverse();
      cur = [...cur, ...seg.slice(1)];
      if (key(cur[0]!) === key(cur[cur.length - 1]!)) break; // 輪が閉じた
    }
    // 先頭側へ延ばす
    for (;;) {
      if (key(cur[0]!) === key(cur[cur.length - 1]!)) break;
      const head = cur[0]!;
      const j = other(key(head), -1);
      if (j < 0) break;
      const p = polys[j]!;
      used[j] = 1;
      const seg = key(p[p.length - 1]!) === key(head) ? p : [...p].reverse();
      cur = [...seg.slice(0, -1), ...cur];
    }
    out.push(cur);
  }
  return out;
}

/** 軽量化の結果。件数は画面で見せる */
export type LiteResult = { shape: DeviceShape; before: number; after: number };

/**
 * 1つの外形線を軽くする。円・円弧はそのまま（もともと1つで済んでいる）。
 *
 * 1回では取り切れないことがある（重複を落として初めてつながる端点、
 * 間引いて初めて一致する端点があるため）。変わらなくなるまで繰り返す。
 * すでに軽いものは1回目で変わらず、そのまま返る。
 */
export function liteShape(shape: DeviceShape, tol = LITE_TOL): LiteResult {
  const before = shape.entities.length;
  // 済みの印があれば何もしない（起動のたびに 0.5 秒かけて同じ結果を出さない）
  if (shape.lite) return { shape, before, after: before };
  let cur = shape;
  let prevPts = -1;
  for (let pass = 0; pass < 6; pass++) {
    const next = litePass(cur, tol).shape;
    const pts = shapePoints(next);
    if (next.entities.length === cur.entities.length && pts === prevPts) break;
    prevPts = pts;
    cur = next;
  }
  return { shape: { ...cur, lite: true }, before, after: cur.entities.length };
}

function litePass(shape: DeviceShape, tol: number): LiteResult {
  const before = shape.entities.length;
  const others: ShapeEntity[] = [];
  const polys: Pt[][] = [];
  const closed: Pt[][] = [];
  const seen = new Set<string>();

  for (const e of shape.entities) {
    if (e.t !== 'p') {
      // 同じ円・円弧の重複だけ落とす
      const k = JSON.stringify(e);
      if (!seen.has(k)) {
        seen.add(k);
        others.push(e);
      }
      continue;
    }
    const pts = toPts(e.pts);
    if (pts.length < 2) continue;
    if (e.c) {
      closed.push(pts);
      continue;
    }
    // 2点の線分は向きを揃えて重複を落とす
    if (pts.length === 2) {
      const a = key(pts[0]!);
      const b = key(pts[1]!);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    polys.push(pts);
  }

  const entities: ShapeEntity[] = [...others];
  for (const p of chain(polys)) {
    const isLoop = p.length > 3 && key(p[0]!) === key(p[p.length - 1]!);
    const s = simplify(isLoop ? p.slice(0, -1).concat([p[0]!]) : p, tol);
    if (isLoop) {
      const ring = s.slice(0, -1);
      if (ring.length >= 3) entities.push({ t: 'p', c: true, pts: ring.flatMap((q) => [r2(q.x), r2(q.y)]) });
      // 細長い輪（幅が許容差以下のすき間）は2点に潰れる。捨てずに1本の線として残す
      else if (ring.length === 2) entities.push({ t: 'p', pts: ring.flatMap((q) => [r2(q.x), r2(q.y)]) });
    } else if (s.length >= 2) {
      entities.push({ t: 'p', pts: s.flatMap((q) => [r2(q.x), r2(q.y)]) });
    }
  }
  for (const p of closed) {
    const s = simplify([...p, p[0]!], tol).slice(0, -1);
    if (s.length >= 3) entities.push({ t: 'p', c: true, pts: s.flatMap((q) => [r2(q.x), r2(q.y)]) });
    else if (s.length === 2) entities.push({ t: 'p', pts: s.flatMap((q) => [r2(q.x), r2(q.y)]) });
  }
  return { shape: { ...shape, entities }, before, after: entities.length };
}

/** 点の総数（重さの目安）。 */
export function shapePoints(shape: DeviceShape): number {
  let n = 0;
  for (const e of shape.entities) n += e.t === 'p' ? e.pts.length / 2 : 1;
  return n;
}
