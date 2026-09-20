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

export type BalloonRow = { no: number; model: string; name: string; maker: string; qty: number };

/** 盤全体の番号表。型式 → 番号と、部品表の行 */
export type Balloons = {
  no: Map<string, number>;
  rows: BalloonRow[];
};

/** 型式に番号を振る。呼ぶ順（面・上から下・左から右）が番号の順になる */
export function balloonIndex(): Balloons & { add: (spec: DeviceSpec) => number } {
  const no = new Map<string, number>();
  const rows: BalloonRow[] = [];
  return {
    no,
    rows,
    add(spec) {
      let n = no.get(spec.model);
      if (!n) {
        n = rows.length + 1;
        no.set(spec.model, n);
        rows.push({ no: n, model: spec.model, name: spec.name, maker: spec.maker, qty: 0 });
      }
      rows[n - 1]!.qty++;
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
 * 同じ型式が同じ段（同じ高さ）にあるものは、1 つの風船にまとめる。
 * 隙間なく並ぶ端子台の列は左端に 1 つ、段の両端にあるエンドストッパも段に 1 つ。
 * 1 台ずつ付けると風船だけで図が埋まり、かえって読めない。台数は部品表で分かる
 */
export function mergeRuns(anchors: Anchor[]): Anchor[] {
  const sorted = [...anchors].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Anchor[] = [];
  for (const a of sorted) {
    const same = out.find((o) => o.no === a.no && Math.abs(o.y - a.y) < 1);
    if (same) {
      // 隣接していれば右へ伸ばす（風船は左端に付くので、幅だけ広げておく）。離れていれば省く
      if (a.x - (same.x + same.w) < 5) same.w = a.x + a.w - same.x;
      continue;
    }
    out.push({ ...a });
  }
  return out;
}

/**
 * 風船を描く。図の右上へ斜めに出し、重なるものは上へずらす。
 * @param bounds 面の大きさ。右端に近い機器は左上へ出す
 */
export function drawBalloons(
  w: Drawer,
  anchors: Anchor[],
  r: number,
  ox: number,
  oy: number,
  bounds: { w: number; h: number },
  taken: { x: number; y: number }[] = [],
) {
  const th = r * 1.1;
  for (const a of anchors) {
    // 右上へ。右端に近ければ左上へ。ただし左端も近い（面が狭い）なら右へ出して図の外にはみ出させない
    const right = a.x + a.w + 2.4 * r <= bounds.w || a.x - 2.4 * r < 0;
    // 引き出しの起点は機器の上の角
    const ax = right ? a.x + a.w : a.x;
    const ay = a.y + a.h;
    let cx = right ? ax + r * 1.1 : ax - r * 1.1;
    let cy = ay + r * 1.1;
    // 先に置いた風船と重なるなら上へ
    for (let i = 0; i < 20; i++) {
      const hit = taken.some((t) => Math.hypot(t.x - cx, t.y - cy) < 2.1 * r);
      if (!hit) break;
      cy += 2.2 * r;
    }
    if (cy + r > bounds.h + 4 * r) cx += right ? 2.2 * r : -2.2 * r; // 上に逃げ場がなければ横へ
    taken.push({ x: cx, y: cy });

    // 引き出し線は円の縁まで
    const dx = ax - cx;
    const dy = ay - cy;
    const d = Math.hypot(dx, dy) || 1;
    w.line(LAYER.balloon, ox + cx + (dx / d) * r, oy + cy + (dy / d) * r, ox + ax, oy + ay);
    w.circle(LAYER.balloon, ox + cx, oy + cy, r);
    const s = String(a.no);
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
    name: chunk(r.name || '—', 24),
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
