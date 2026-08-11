import Encoding from 'encoding-japanese';
import DxfParser from 'dxf-parser';
import type { DeviceShape, ShapeEntity } from '../types';

/**
 * DXF から盤の寸法を拾うための読み込み。
 *
 * メーカー図面は三面図・寸法線・表題欄が1ファイルに同居しているので、
 * 「どの矩形が外形でどれが中板か」を機械的に当てるのは安定しない。
 * ここでは候補となる矩形を並べるところまでをやり、どれを使うかは人が選ぶ。
 * 一度選べば型式ごとに盤マスタへ残せるので、次回から入力は要らなくなる。
 */

export type RectCandidate = {
  key: string;
  w: number;
  h: number;
  x: number;
  y: number;
  layer: string;
  /** どうやって拾ったか */
  from: '閉じた矩形' | 'レイヤの外接' | '図面全体';
};

type Pt = { x: number; y: number };

/** 国内の DXF は Shift-JIS のことが多い。BOM や文字コードを見て変換する。 */
export async function readDxfText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const detected = Encoding.detect(buf);
  if (detected === 'UTF8' || detected === 'ASCII' || detected === false) {
    return new TextDecoder('utf-8').decode(buf);
  }
  return Encoding.convert(buf, { to: 'UNICODE', from: detected, type: 'string' }) as string;
}

const r1 = (v: number) => Number(v.toFixed(1));

/** 軸に平行な矩形かどうか。回転している枠は対象外にする。 */
function axisAlignedRect(pts: Pt[]): { w: number; h: number; x: number; y: number } | null {
  const p = pts.length >= 2 && same(pts[0]!, pts[pts.length - 1]!) ? pts.slice(0, -1) : pts;
  if (p.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % 4]!;
    const horizontal = Math.abs(a.y - b.y) < 0.01;
    const vertical = Math.abs(a.x - b.x) < 0.01;
    if (!horizontal && !vertical) return null;
  }
  const xs = p.map((v) => v.x);
  const ys = p.map((v) => v.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 1 || h < 1) return null;
  return { w: r1(w), h: r1(h), x: r1(Math.min(...xs)), y: r1(Math.min(...ys)) };
}

const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** DXF を解析して、盤寸法の候補になりそうな矩形を大きい順に返す。 */
export function findRectangles(text: string): { candidates: RectCandidate[]; entityCount: number } {
  const parsed = new DxfParser().parseSync(text);
  const entities = (parsed?.entities ?? []) as {
    type: string;
    layer?: string;
    vertices?: Pt[];
    center?: Pt;
    radius?: number;
  }[];

  const found = new Map<string, RectCandidate>();
  const push = (c: Omit<RectCandidate, 'key'>) => {
    // 同じ寸法・同じ位置のものは1つにまとめる
    const key = `${c.w}x${c.h}@${c.x},${c.y}`;
    if (!found.has(key)) found.set(key, { ...c, key });
  };

  // レイヤごと・図面全体の外接矩形も候補にする
  const byLayer = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>();
  const all = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

  for (const e of entities) {
    const layer = e.layer ?? '0';
    const pts: Pt[] = [...(e.vertices ?? [])];
    if (e.center && typeof e.radius === 'number') {
      pts.push(
        { x: e.center.x - e.radius, y: e.center.y - e.radius },
        { x: e.center.x + e.radius, y: e.center.y + e.radius },
      );
    }
    if (pts.length === 0) continue;

    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
      const rect = axisAlignedRect(e.vertices);
      if (rect) push({ ...rect, layer, from: '閉じた矩形' });
    }

    const box = byLayer.get(layer) ?? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      box.minX = Math.min(box.minX, p.x);
      box.maxX = Math.max(box.maxX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxY = Math.max(box.maxY, p.y);
      all.minX = Math.min(all.minX, p.x);
      all.maxX = Math.max(all.maxX, p.x);
      all.minY = Math.min(all.minY, p.y);
      all.maxY = Math.max(all.maxY, p.y);
    }
    byLayer.set(layer, box);
  }

  for (const [layer, b] of byLayer) {
    if (!Number.isFinite(b.minX)) continue;
    const w = r1(b.maxX - b.minX);
    const h = r1(b.maxY - b.minY);
    if (w >= 1 && h >= 1) {
      push({ w, h, x: r1(b.minX), y: r1(b.minY), layer, from: 'レイヤの外接' });
    }
  }
  if (Number.isFinite(all.minX)) {
    push({
      w: r1(all.maxX - all.minX),
      h: r1(all.maxY - all.minY),
      x: r1(all.minX),
      y: r1(all.minY),
      layer: '—',
      from: '図面全体',
    });
  }

  // 実際に描かれている矩形を優先する。図面全体の外接は最後（表題欄まで含むので
  // たいてい盤の寸法ではない）。同じ種類のなかでは大きい順。
  const priority = { 閉じた矩形: 0, 'レイヤの外接': 1, 図面全体: 2 } as const;
  const candidates = [...found.values()].sort(
    (a, b) => priority[a.from] - priority[b.from] || b.w * b.h - a.w * a.h,
  );
  return { candidates, entityCount: entities.length };
}

/** 寸法線・文字など、部品の形とは関係のないものを落とすためのレイヤ名。 */
const NOISE_LAYER = /dim|寸法|text|文字|hatch|ハッチ|center|中心線/i;
const NOISE_TYPE = new Set(['DIMENSION', 'TEXT', 'MTEXT', 'HATCH', 'LEADER', 'ATTDEF', 'SOLID']);

/**
 * 部品1点の外形線を DXF から取り込む。
 *
 * 部品の DXF は盤の図面と違って1点ぶんだけが描かれているので、寸法線や文字を
 * 落としたうえで全部を拾い、左下が原点になるよう平行移動する。
 * ポリラインの膨らみ（bulge）は直線で近似する。
 */
export function extractShape(text: string): DeviceShape | null {
  const parsed = new DxfParser().parseSync(text);
  const entities = (parsed?.entities ?? []) as {
    type: string;
    layer?: string;
    vertices?: Pt[];
    center?: Pt;
    radius?: number;
    startAngle?: number;
    endAngle?: number;
    shape?: boolean;
  }[];

  const out: ShapeEntity[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const e of entities) {
    if (NOISE_TYPE.has(e.type)) continue;
    if (NOISE_LAYER.test(e.layer ?? '')) continue;

    if (e.type === 'CIRCLE' && e.center && typeof e.radius === 'number') {
      out.push({ t: 'c', x: e.center.x, y: e.center.y, r: e.radius });
      see(e.center.x - e.radius, e.center.y - e.radius);
      see(e.center.x + e.radius, e.center.y + e.radius);
      continue;
    }
    if (
      e.type === 'ARC' &&
      e.center &&
      typeof e.radius === 'number' &&
      typeof e.startAngle === 'number' &&
      typeof e.endAngle === 'number'
    ) {
      out.push({
        t: 'a',
        x: e.center.x,
        y: e.center.y,
        r: e.radius,
        a0: e.startAngle,
        a1: e.endAngle,
      });
      // 端点だけでは外接を取り違えるので、円としての範囲を見る（安全側）
      see(e.center.x - e.radius, e.center.y - e.radius);
      see(e.center.x + e.radius, e.center.y + e.radius);
      continue;
    }
    if (e.vertices && e.vertices.length >= 2) {
      const pts: number[] = [];
      for (const v of e.vertices) {
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
        pts.push(v.x, v.y);
        see(v.x, v.y);
      }
      if (pts.length >= 4) {
        const closed = e.vertices.length > 2 && (e.shape === true || same(e.vertices[0]!, e.vertices[e.vertices.length - 1]!));
        out.push({ t: 'p', pts, ...(closed ? { c: true } : {}) });
      }
    }
  }

  if (out.length === 0 || !Number.isFinite(minX)) return null;

  // 左下を原点に寄せて、小数を丸める
  const shift = (x: number, y: number): [number, number] => [r2(x - minX), r2(y - minY)];
  const entitiesOut: ShapeEntity[] = out.map((s) => {
    if (s.t === 'c') {
      const [x, y] = shift(s.x, s.y);
      return { t: 'c', x, y, r: r2(s.r) };
    }
    if (s.t === 'a') {
      const [x, y] = shift(s.x, s.y);
      return { t: 'a', x, y, r: r2(s.r), a0: s.a0, a1: s.a1 };
    }
    const pts: number[] = [];
    for (let i = 0; i < s.pts.length; i += 2) {
      const [x, y] = shift(s.pts[i]!, s.pts[i + 1]!);
      pts.push(x, y);
    }
    return { t: 'p', pts, ...(s.c ? { c: true } : {}) };
  });

  return { w: r2(maxX - minX), h: r2(maxY - minY), entities: entitiesOut };
}

const r2 = (v: number) => Number(v.toFixed(2));
