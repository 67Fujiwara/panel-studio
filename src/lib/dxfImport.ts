import Encoding from 'encoding-japanese';
import DxfParser from 'dxf-parser';

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
