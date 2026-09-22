/**
 * 風船番号と部品表。
 *
 * 取引先から「図面を見ても、付いている機器が何か分からない」と言われた。
 * 型式の文字は縮尺 1:5 で 1.6mm になって読めないし、そもそも型式だけでは何の機器か伝わらない。
 * 図面の決まりごとどおり、**機器に丸囲みの番号を付け、同じ紙の部品表で 型式・品名・メーカー・数量 を引ける**
 * ようにする。3D も STEP も要らず、いまある寸法と BOM だけで済む。
 *
 * - 番号は**型式ごとに 1 つ**（盤全体で共通）。同じ型式が並ぶ端子台などは 1 つの風船にまとめる
 * - 風船の大きさは図の大きさに合わせる。用紙に縮めたときに読める大きさを保つため
 * - 風船どうしが重なるときは上へずらす
 * - 部品表は図の右の余白に置く。表のぶんだけ図の範囲（extent）が広がるので、PDF はそれごと用紙に収める
 */
import { LAYER, type Drawer } from './drawing';
import type { DeviceSpec } from '../types';

export type BalloonRow = {
  no: number;
  model: string;
  name: string;
  maker: string;
  qty: number;
  /** 面の内側に付けたものが含まれる（表の品名に「内側取付」と添える） */
  inside?: boolean;
};

/** 盤全体の番号表。型式 → 番号と、部品表の行 */
export type Balloons = {
  no: Map<string, number>;
  rows: BalloonRow[];
};

/** 型式に番号を振る。呼ぶ順（面・上から下・左から右）が番号の順になる */
export function balloonIndex(): Balloons & { add: (spec: DeviceSpec, inside?: boolean) => number } {
  const no = new Map<string, number>();
  const rows: BalloonRow[] = [];
  return {
    no,
    rows,
    add(spec, inside = false) {
      let n = no.get(spec.model);
      if (!n) {
        n = rows.length + 1;
        no.set(spec.model, n);
        rows.push({ no: n, model: spec.model, name: spec.name, maker: spec.maker, qty: 0 });
      }
      rows[n - 1]!.qty++;
      if (inside) rows[n - 1]!.inside = true;
      return n;
    },
  };
}

/**
 * 風船の半径(mm)。図の高さに比例させる（中板 720mm で 12mm）。
 * 用紙に収めるとき図全体が縮むので、風船も同じ比で大きくしておかないと読めない
 * （キャビネットの三面図は 2000mm 超なので、そのままだと 1:10 で 2mm の丸になる）
 */
export function balloonRadius(extentH: number): number {
  return Math.max(6, extentH / 60);
}

/** 文字の幅の見積もり(mm)。英数字は高さの 0.6 倍、日本語は 1 倍 */
export function textWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of s) w += (/[\x20-\x7e]/.test(ch) ? 0.6 : 1.0) * h;
  return w;
}

/** 風船を付ける相手（機器の外接四角）。同じ型式が隣り合って並ぶものは 1 つにまとめてから渡す */
export type Anchor = { no: number; x: number; y: number; w: number; h: number };

/**
 * 同じ型式（同じ番号）の機器を 1 つの風船にまとめ、**風船から全部の機器へ引き出し線を引く**。
 * 風船が 1 つなら読めるし、線が機器の数だけあれば「どれがそれか」も分かる。
 * 風船は最初の 1 台（いちばん上・左）の近くに置く
 */
export function groupByNo(anchors: Anchor[]): { no: number; anchors: Anchor[] }[] {
  const sorted = [...anchors].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = new Map<number, Anchor[]>();
  for (const a of sorted) {
    const g = groups.get(a.no);
    if (g) g.push(a);
    else groups.set(a.no, [a]);
  }
  return [...groups].map(([no, anchors]) => ({ no, anchors }));
}

/**
 * 風船を描く。最初の機器の右上（右端に近ければ左上）に置き、先に置いた風船と重なる・面からはみ出す
 * ときは周りの空きを探す。引き出し線は同じ番号の全部の機器へ、機器の近いほうの上の角まで引く
 * @param bounds 面の大きさ。風船はこの中に収める
 */
export function drawBalloons(
  w: Drawer,
  groups: { no: number; anchors: Anchor[] }[],
  r: number,
  ox: number,
  oy: number,
  bounds: { w: number; h: number },
  taken: { x: number; y: number }[] = [],
) {
  const th = r * 1.1;
  const inside = (cx: number, cy: number) => cx - r >= 0 && cx + r <= bounds.w && cy - r >= 0 && cy + r <= bounds.h;
  const free = (cx: number, cy: number) => !taken.some((t) => Math.hypot(t.x - cx, t.y - cy) < 2.1 * r);
  for (const g of groups) {
    const a = g.anchors[0]!;
    const right = a.x + a.w + 2.4 * r <= bounds.w || a.x - 2.4 * r < 0;
    const ax = right ? a.x + a.w : a.x;
    const ay = a.y + a.h;
    // 候補: 斜め上 → 上へ順に → 横へ → 斜め下。面の中で空いている最初の場所
    const dirs: [number, number][] = right
      ? [[1, 1], [-1, 1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [0, -1]]
      : [[-1, 1], [1, 1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, -1]];
    let cx = ax + (right ? 1 : -1) * r * 1.1;
    let cy = ay + r * 1.1;
    let found = false;
    for (let k = 1.1; k <= 12 && !found; k += 2.2) {
      for (const [dx, dy] of dirs) {
        const px = ax + dx * r * k;
        const py = ay + dy * r * k;
        if (inside(px, py) && free(px, py)) {
          cx = px;
          cy = py;
          found = true;
          break;
        }
      }
    }
    taken.push({ x: cx, y: cy });

    for (const t of g.anchors) {
      // 機器の上の角のうち、風船に近いほう
      const tx = Math.abs(t.x - cx) < Math.abs(t.x + t.w - cx) ? t.x : t.x + t.w;
      const ty = cy >= t.y + t.h / 2 ? t.y + t.h : t.y;
      const dx = tx - cx;
      const dy = ty - cy;
      const d = Math.hypot(dx, dy) || 1;
      if (d <= r) continue; // 風船の中にある角には引かない
      w.line(LAYER.balloon, ox + cx + (dx / d) * r, oy + cy + (dy / d) * r, ox + tx, oy + ty);
    }
    w.circle(LAYER.balloon, ox + cx, oy + cy, r);
    const s = String(g.no);
    w.text(LAYER.balloon, ox + cx - textWidth(s, th) / 2, oy + cy - th * 0.36, th, s);
  }
}

/**
 * 部品表を描く。左上 (x0, yTop) から下へ。
 * @param u 大きさの係数（1 で行高 10mm・文字 6mm）。図の大きさに合わせて風船と同じ比で拡大する
 * @returns 表の幅と高さ(mm)
 */
export function drawPartsTable(
  w: Drawer,
  rows: BalloonRow[],
  x0: number,
  yTop: number,
  u: number,
): { w: number; h: number } {
  const th = 6 * u;
  const rowH = 10 * u;
  const pad = 2 * u;
  const wrapAt = 36;
  const chunk = (s: string, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out.length ? out : [''];
  };
  const cells = rows.map((r) => ({
    no: [String(r.no)],
    model: chunk(r.model, wrapAt),
    name: chunk((r.name || '—') + (r.inside ? '（内側取付）' : ''), 24),
    maker: chunk(r.maker || '—', 16),
    qty: [String(r.qty)],
  }));
  const colW = (key: 'model' | 'name' | 'maker', min: number) =>
    Math.max(min * u, ...cells.map((c) => Math.max(...c[key].map((s) => textWidth(s, th))) + pad * 2));
  const cols = [
    { key: 'no' as const, label: 'No.', w: 14 * u, right: true },
    { key: 'model' as const, label: '型式', w: colW('model', 60), right: false },
    { key: 'name' as const, label: '品名', w: colW('name', 50), right: false },
    { key: 'maker' as const, label: 'メーカー', w: colW('maker', 30), right: false },
    { key: 'qty' as const, label: '数量', w: 16 * u, right: true },
  ];
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const lineH = th * 1.35;

  let y = yTop;
  const hline = (yy: number) => w.line(LAYER.table, x0, yy, x0 + totalW, yy);
  const put = (col: (typeof cols)[number], cx: number, yy: number, s: string) => {
    const tw = textWidth(s, th);
    w.text(LAYER.table, col.right ? cx + col.w - pad - tw : cx + pad, yy, th, s);
  };
  // 見出し
  hline(y);
  {
    let cx = x0;
    for (const c of cols) {
      put(c, cx, y - rowH + (rowH - th) / 2, c.label);
      cx += c.w;
    }
  }
  y -= rowH;
  hline(y);
  const yHeaderTop = yTop;
  for (const c of cells) {
    const lines = Math.max(c.no.length, c.model.length, c.name.length, c.maker.length, c.qty.length);
    const h = Math.max(rowH, lines * lineH + (rowH - th));
    let cx = x0;
    for (const col of cols) {
      const arr = c[col.key];
      arr.forEach((s, i) => put(col, cx, y - (rowH - th) / 2 - th - i * lineH, s));
      cx += col.w;
    }
    y -= h;
    hline(y);
  }
  // 縦線
  let cx = x0;
  for (const c of cols) {
    w.line(LAYER.table, cx, yHeaderTop, cx, y);
    cx += c.w;
  }
  w.line(LAYER.table, cx, yHeaderTop, cx, y);
  return { w: totalW, h: yTop - y };
}
