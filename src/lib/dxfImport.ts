import Encoding from 'encoding-japanese';
import DxfParser from 'dxf-parser';
import { FACE_LABEL } from '../data/faces';
import type { DeviceShape, FaceId, ShapeEntity } from '../types';

/**
 * DXF の読み込み。
 *
 * 実際のメーカー図面を読ませて分かったこと:
 *  - 外形の四角は「閉じたポリライン」ではなく **4本の LINE** で描かれていることが多い
 *  - 三面図が1ファイルに同居していて、レイヤでは分かれていない
 *  - 部品の形はブロックの中にあり、INSERT で置かれている
 *  - 文字（TEXT/MTEXT）が図の外にあり、そのまま外接を取ると寸法が狂う
 *
 * そこで、
 *  1. ブロックを展開し、文字や寸法線を落として図形だけにする
 *  2. 線から矩形を組み立てる
 *  3. 離れて描かれている図（三面図の各面）をかたまりに分ける
 * という順で候補を出す。どれを使うかは人が選ぶ。
 */

export type Pt = { x: number; y: number };

export type Prim =
  | { k: 'seg'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'circle'; x: number; y: number; r: number }
  | { k: 'arc'; x: number; y: number; r: number; a0: number; a1: number };

export type RectCandidate = {
  key: string;
  w: number;
  h: number;
  x: number;
  y: number;
  layer: string;
  from: '線で囲まれた四角' | '閉じた四角' | '図のかたまり' | '図面全体';
};

/** 寸法線・文字など、形と関係のないものを落とすためのレイヤ名。 */
const NOISE_LAYER = /dim|寸法|text|文字|hatch|ハッチ|注記|note/i;
const NOISE_TYPE = new Set([
  'DIMENSION',
  'TEXT',
  'MTEXT',
  'HATCH',
  'LEADER',
  'ATTDEF',
  'ATTRIB',
  'SOLID',
  'POINT',
]);
/** 文字そのもの。下敷きに敷くときも、これだけは必ず落とす。 */
const TEXT_TYPE = new Set(['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB']);

/**
 * 読み込み方。
 * - 'shape' : 寸法線・注記レイヤまで落として、形だけにする（面の割り出しに使う）
 * - 'all'   : **文字以外はすべて**拾う（下敷きに敷くときに使う）
 */
export type ReadMode = 'shape' | 'all';

/** 国内の DXF は Shift-JIS のことが多い。文字コードを見て変換する。 */
export async function readDxfText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const detected = Encoding.detect(buf);
  if (detected === 'UTF8' || detected === 'ASCII' || detected === false) {
    return new TextDecoder('utf-8').decode(buf);
  }
  return Encoding.convert(buf, { to: 'UNICODE', from: detected, type: 'string' }) as string;
}

type RawEntity = {
  type: string;
  layer?: string;
  vertices?: Pt[];
  center?: Pt;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  shape?: boolean;
  closed?: boolean;
  name?: string;
  position?: Pt;
  xScale?: number;
  yScale?: number;
  rotation?: number;
};

type Parsed = { entities?: RawEntity[]; blocks?: Record<string, { entities?: RawEntity[] }> };

/** INSERT を展開し、文字などを落として、図形の並びにする。 */
export function flatten(
  text: string,
  mode: ReadMode = 'shape',
): { prims: Prim[]; layerOf: string[]; entityCount: number } {
  const parsed = (new DxfParser().parseSync(text) ?? {}) as Parsed;
  const blocks = parsed.blocks ?? {};
  const prims: Prim[] = [];
  const layerOf: string[] = [];

  const push = (p: Prim, layer: string) => {
    prims.push(p);
    layerOf.push(layer);
  };

  const walk = (entities: RawEntity[], tx: number, ty: number, sx: number, sy: number, rot: number, depth: number) => {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const map = (p: Pt): Pt => {
      const x = p.x * sx;
      const y = p.y * sy;
      return { x: tx + x * cos - y * sin, y: ty + x * sin + y * cos };
    };

    for (const e of entities) {
      const layer = e.layer ?? '0';
      if (mode === 'all') {
        if (TEXT_TYPE.has(e.type)) continue;
      } else {
        if (NOISE_TYPE.has(e.type)) continue;
        if (NOISE_LAYER.test(layer)) continue;
      }

      if (e.type === 'INSERT' && e.name && depth < 4) {
        const block = blocks[e.name];
        if (block?.entities) {
          const at = map(e.position ?? { x: 0, y: 0 });
          walk(
            block.entities,
            at.x,
            at.y,
            sx * (e.xScale ?? 1),
            sy * (e.yScale ?? 1),
            rot + ((e.rotation ?? 0) * Math.PI) / 180,
            depth + 1,
          );
        }
        continue;
      }

      if (e.type === 'CIRCLE' && e.center && typeof e.radius === 'number') {
        const c = map(e.center);
        push({ k: 'circle', x: c.x, y: c.y, r: e.radius * Math.abs(sx) }, layer);
        continue;
      }
      if (
        e.type === 'ARC' &&
        e.center &&
        typeof e.radius === 'number' &&
        typeof e.startAngle === 'number' &&
        typeof e.endAngle === 'number'
      ) {
        const c = map(e.center);
        push(
          {
            k: 'arc',
            x: c.x,
            y: c.y,
            r: e.radius * Math.abs(sx),
            a0: e.startAngle + rot,
            a1: e.endAngle + rot,
          },
          layer,
        );
        continue;
      }
      if (e.vertices && e.vertices.length >= 2) {
        const pts = e.vertices.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y)).map(map);
        for (let i = 0; i + 1 < pts.length; i++) {
          push({ k: 'seg', x1: pts[i]!.x, y1: pts[i]!.y, x2: pts[i + 1]!.x, y2: pts[i + 1]!.y }, layer);
        }
        // 閉じたポリラインは最後の頂点から先頭へ戻る辺も持つ
        const isClosed = e.shape === true || e.closed === true;
        if (isClosed && pts.length >= 3) {
          const a = pts[pts.length - 1]!;
          const b = pts[0]!;
          push({ k: 'seg', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, layer);
        }
      }
    }
  };

  walk(parsed.entities ?? [], 0, 0, 1, 1, 0, 0);
  return { prims, layerOf, entityCount: (parsed.entities ?? []).length };
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function primBox(p: Prim): Box {
  if (p.k === 'seg') {
    return {
      minX: Math.min(p.x1, p.x2),
      maxX: Math.max(p.x1, p.x2),
      minY: Math.min(p.y1, p.y2),
      maxY: Math.max(p.y1, p.y2),
    };
  }
  if (p.k === 'circle') {
    return { minX: p.x - p.r, maxX: p.x + p.r, minY: p.y - p.r, maxY: p.y + p.r };
  }

  // 円弧は「円まるごと」ではなく実際に描かれる範囲で見る。
  // 円で見ると外接が実物より大きくなり、取り込んだ部品の外形に
  // 描かれていない余白が付いてしまうため。
  const sweep = p.a1 >= p.a0 ? p.a1 - p.a0 : p.a1 - p.a0 + Math.PI * 2;
  const at = (a: number) => ({ x: p.x + p.r * Math.cos(a), y: p.y + p.r * Math.sin(a) });
  const pts = [at(p.a0), at(p.a0 + sweep)];
  // 弧が上下左右の頂点をまたぐときだけ、そこも端になる
  const first = Math.ceil(p.a0 / (Math.PI / 2)) * (Math.PI / 2);
  for (let a = first; a <= p.a0 + sweep; a += Math.PI / 2) pts.push(at(a));

  return {
    minX: Math.min(...pts.map((q) => q.x)),
    maxX: Math.max(...pts.map((q) => q.x)),
    minY: Math.min(...pts.map((q) => q.y)),
    maxY: Math.max(...pts.map((q) => q.y)),
  };
}

const r1 = (v: number) => Number(v.toFixed(1));
const EPS = 0.6;

/**
 * 線から四角を組み立てる。
 *
 * 上下の辺は同じ左右位置で引かれているはずなので、まず水平線を「左端・右端」で
 * まとめ、その中の2本を上下の辺と仮定して、両端に縦線があるかを確かめる。
 */
function rectsFromSegments(prims: Prim[], layerOf: string[]): Omit<RectCandidate, 'key'>[] {
  type H = { y: number; xa: number; xb: number; layer: string };
  type V = { x: number; ya: number; yb: number };
  const hs: H[] = [];
  const vs: V[] = [];

  prims.forEach((p, i) => {
    if (p.k !== 'seg') return;
    const layer = layerOf[i] ?? '0';
    if (Math.abs(p.y1 - p.y2) < EPS && Math.abs(p.x1 - p.x2) >= EPS) {
      hs.push({ y: (p.y1 + p.y2) / 2, xa: Math.min(p.x1, p.x2), xb: Math.max(p.x1, p.x2), layer });
    } else if (Math.abs(p.x1 - p.x2) < EPS && Math.abs(p.y1 - p.y2) >= EPS) {
      vs.push({ x: (p.x1 + p.x2) / 2, ya: Math.min(p.y1, p.y2), yb: Math.max(p.y1, p.y2) });
    }
  });

  const spansV = (x: number, y1: number, y2: number) =>
    vs.some((v) => Math.abs(v.x - x) < EPS && v.ya <= y1 + EPS && v.yb >= y2 - EPS);

  const groups = new Map<string, H[]>();
  for (const h of hs) {
    const key = `${r1(h.xa)}:${r1(h.xb)}`;
    const g = groups.get(key) ?? [];
    g.push(h);
    groups.set(key, g);
  }

  const out: Omit<RectCandidate, 'key'>[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.y - b.y);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const lo = g[i]!;
        const hi = g[j]!;
        const h = hi.y - lo.y;
        if (h < 1) continue;
        if (!spansV(lo.xa, lo.y, hi.y) || !spansV(lo.xb, lo.y, hi.y)) continue;
        out.push({
          w: r1(lo.xb - lo.xa),
          h: r1(h),
          x: r1(lo.xa),
          y: r1(lo.y),
          layer: lo.layer,
          from: '線で囲まれた四角',
        });
      }
    }
  }
  return out;
}

/**
 * 離れて描かれている図をかたまりに分ける。三面図の各面を切り出すのに使う。
 * 図面全体の大きさに対して十分離れているものを別のかたまりとみなす。
 */
function clusterBoxes(prims: Prim[]): Box[] {
  if (prims.length === 0 || prims.length > 4000) return [];
  const boxes = prims.map(primBox);
  const all = boxes.reduce(
    (a, b) => ({
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
      minY: Math.min(a.minY, b.minY),
      maxY: Math.max(a.maxY, b.maxY),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const diag = Math.hypot(all.maxX - all.minX, all.maxY - all.minY);
  const gap = Math.max(5, diag * 0.02);

  const near = (a: Box, b: Box) =>
    a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;

  const merged: Box[] = [];
  for (const box of boxes) {
    let cur = { ...box };
    for (let i = merged.length - 1; i >= 0; i--) {
      if (near(cur, merged[i]!)) {
        const m = merged[i]!;
        cur = {
          minX: Math.min(cur.minX, m.minX),
          maxX: Math.max(cur.maxX, m.maxX),
          minY: Math.min(cur.minY, m.minY),
          maxY: Math.max(cur.maxY, m.maxY),
        };
        merged.splice(i, 1);
      }
    }
    merged.push(cur);
  }
  // 1回のパスでは繋がりきらないことがあるので、変化がなくなるまで繰り返す
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = merged.length - 1; i >= 0; i--) {
      for (let j = i - 1; j >= 0; j--) {
        if (near(merged[i]!, merged[j]!)) {
          const a = merged[i]!;
          const b = merged[j]!;
          merged[j] = {
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minY: Math.min(a.minY, b.minY),
            maxY: Math.max(a.maxY, b.maxY),
          };
          merged.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  return merged;
}

/** DXF を解析して、盤寸法の候補になりそうな矩形を返す。 */
export function findRectangles(text: string): {
  candidates: RectCandidate[];
  entityCount: number;
  prims: Prim[];
} {
  const { prims, layerOf, entityCount } = flatten(text);

  const found = new Map<string, RectCandidate>();
  const push = (c: Omit<RectCandidate, 'key'>) => {
    if (c.w < 1 || c.h < 1) return;
    const key = `${c.w}x${c.h}@${c.x},${c.y}`;
    if (!found.has(key)) found.set(key, { ...c, key });
  };

  for (const r of rectsFromSegments(prims, layerOf)) push(r);

  const clusters = clusterBoxes(prims);
  for (const b of clusters) {
    push({
      w: r1(b.maxX - b.minX),
      h: r1(b.maxY - b.minY),
      x: r1(b.minX),
      y: r1(b.minY),
      layer: '—',
      from: '図のかたまり',
    });
  }

  if (clusters.length > 1) {
    const all = clusters.reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
      minY: Math.min(a.minY, b.minY),
      maxY: Math.max(a.maxY, b.maxY),
    }));
    push({
      w: r1(all.maxX - all.minX),
      h: r1(all.maxY - all.minY),
      x: r1(all.minX),
      y: r1(all.minY),
      layer: '—',
      from: '図面全体',
    });
  }

  const priority = {
    '線で囲まれた四角': 0,
    '閉じた四角': 0,
    '図のかたまり': 1,
    '図面全体': 2,
  } as const;
  const candidates = [...found.values()].sort(
    (a, b) => priority[a.from] - priority[b.from] || b.w * b.h - a.w * a.h,
  );
  return { candidates, entityCount, prims };
}

// ---------------------------------------------------------------------------
// 自動判定
// ---------------------------------------------------------------------------

/**
 * メーカーの盤図は第三角法の三面図で、面の並びが決まっている。
 *
 *            上面
 *   左側面   正面   右側面   背面
 *            底面
 *
 * この並びを手がかりに、どのかたまりがどの面かを機械で決める。
 * 人が27件の候補から選ぶのは現実的ではないため。
 */
export type FaceRegion = { face: FaceId; x: number; y: number; w: number; h: number };

export type CabinetAnalysis = {
  outer: { w: number; h: number; d: number };
  regions: FaceRegion[];
  /** 何をどう判定したかの説明。取り違えたときに人が気づけるようにする */
  note: string;
};

const boxW = (b: Box) => b.maxX - b.minX;
const boxH = (b: Box) => b.maxY - b.minY;

/** 2つの範囲がどれだけ重なっているか（狭いほうに対する割合）。 */
function overlapRatio(a0: number, a1: number, b0: number, b1: number): number {
  const over = Math.min(a1, b1) - Math.max(a0, b0);
  const min = Math.min(a1 - a0, b1 - b0);
  return min <= 0 ? 0 : over / min;
}

/**
 * 三面図から外形寸法と各面の位置を割り出す。
 *
 * いちばん大きなかたまりを正面とみなし、
 * 横に並ぶものを側面・背面、縦に並ぶものを上面・底面として拾う。
 */
export function analyzeCabinet(prims: Prim[]): CabinetAnalysis | null {
  const all = clusterBoxes(prims).filter((b) => boxW(b) >= 20 && boxH(b) >= 20);
  if (all.length === 0) return null;

  const area = (b: Box) => boxW(b) * boxH(b);
  const biggest = [...all].sort((a, b) => area(b) - area(a))[0]!;

  // 正面と横に並ぶもの（Y の範囲が重なる）
  const row = all.filter((b) => overlapRatio(b.minY, b.maxY, biggest.minY, biggest.maxY) > 0.6);
  const maxW = Math.max(...row.map(boxW));
  const wide = row.filter((b) => boxW(b) >= maxW * 0.8).sort((a, b) => a.minX - b.minX);
  const narrow = row.filter((b) => boxW(b) < maxW * 0.8).sort((a, b) => a.minX - b.minX);

  const front = wide[0] ?? biggest;
  const back = wide[1];
  // 第三角法では正面のすぐ左が左側面、すぐ右が右側面
  const left = [...narrow].reverse().find((b) => b.maxX <= front.minX + 1);
  const right = narrow.find(
    (b) => b.minX >= front.maxX - 1 && (!back || b.maxX <= back.minX + 1),
  );

  // 正面と縦に並ぶもの（X の範囲が重なる）
  const col = all.filter(
    (b) => b !== front && overlapRatio(b.minX, b.maxX, front.minX, front.maxX) > 0.6,
  );
  const top = col.filter((b) => b.minY >= front.maxY - 1).sort((a, b) => a.minY - b.minY)[0];
  const bottom = col.filter((b) => b.maxY <= front.minY + 1).sort((a, b) => b.maxY - a.maxY)[0];

  // 奥行きは側面の幅から。無ければ上下面の高さから
  const depths = [left, right].filter(Boolean).map((b) => boxW(b!));
  const heights = [top, bottom].filter(Boolean).map((b) => boxH(b!));
  const d = depths.length ? Math.min(...depths) : heights.length ? Math.min(...heights) : 0;

  const regions: FaceRegion[] = [];
  const add = (face: FaceId, b: Box | undefined) => {
    if (!b) return;
    regions.push({ face, x: r1(b.minX), y: r1(b.minY), w: r1(boxW(b)), h: r1(boxH(b)) });
  };
  add('door', front);
  add('back', back);
  add('left', left);
  add('right', right);
  add('top', top);
  add('bottom', bottom);

  const found = regions.map((r) => FACE_LABEL(r.face)).join('・');
  return {
    outer: { w: r1(boxW(front)), h: r1(boxH(front)), d: r1(d) },
    regions,
    note: `かたまり ${all.length} 個から ${regions.length} 面を判定（${found}）`,
  };
}

/**
 * 中板の DXF から寸法を割り出す。
 * 三面図と違って1枚しか描かれていないので、いちばん大きな四角を採る。
 */
export function analyzePlate(text: string): { w: number; h: number; x: number; y: number } | null {
  const { candidates } = findRectangles(text);
  const framed = candidates.filter((c) => c.from === '線で囲まれた四角');
  const best = (framed.length ? framed : candidates).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return best ? { w: best.w, h: best.h, x: best.x, y: best.y } : null;
}

const r2 = (v: number) => Number(v.toFixed(2));

/** 図形の並びを、指定した原点を左下とする図形データに変換する。 */
export function primsToShape(prims: Prim[], origin: Pt, w: number, h: number): DeviceShape {
  const entities: ShapeEntity[] = [];
  for (const p of prims) {
    if (p.k === 'seg') {
      entities.push({
        t: 'p',
        pts: [r2(p.x1 - origin.x), r2(p.y1 - origin.y), r2(p.x2 - origin.x), r2(p.y2 - origin.y)],
      });
    } else if (p.k === 'circle') {
      entities.push({ t: 'c', x: r2(p.x - origin.x), y: r2(p.y - origin.y), r: r2(p.r) });
    } else {
      entities.push({
        t: 'a',
        x: r2(p.x - origin.x),
        y: r2(p.y - origin.y),
        r: r2(p.r),
        a0: p.a0,
        a1: p.a1,
      });
    }
  }
  return { w: r1(w), h: r1(h), entities };
}

/** 指定した範囲の中にある図形だけを切り出す。三面図から1面だけ取り出すのに使う。 */
export function extractRegion(prims: Prim[], rect: { x: number; y: number; w: number; h: number }): DeviceShape {
  const m = 1; // 枠線そのものを取りこぼさないための余裕
  const inside = prims.filter((p) => {
    const b = primBox(p);
    return (
      b.minX >= rect.x - m &&
      b.maxX <= rect.x + rect.w + m &&
      b.minY >= rect.y - m &&
      b.maxY <= rect.y + rect.h + m
    );
  });
  return primsToShape(inside, { x: rect.x, y: rect.y }, rect.w, rect.h);
}

/**
 * 部品1点の外形線を DXF から取り込む。
 * ブロックを展開し、文字・寸法線を落としたうえで全部を拾い、左下を原点に寄せる。
 */
export function extractShape(text: string): DeviceShape | null {
  const { prims } = flatten(text);
  if (prims.length === 0) return null;
  const boxes = prims.map(primBox);
  const b = boxes.reduce((a, c) => ({
    minX: Math.min(a.minX, c.minX),
    maxX: Math.max(a.maxX, c.maxX),
    minY: Math.min(a.minY, c.minY),
    maxY: Math.max(a.maxY, c.maxY),
  }));
  if (!Number.isFinite(b.minX)) return null;
  return primsToShape(prims, { x: b.minX, y: b.minY }, b.maxX - b.minX, b.maxY - b.minY);
}
