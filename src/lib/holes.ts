import type { MachiningDraft, Pilots } from '../types';

type Pt = { x: number; y: number };

/**
 * キャビスタ相当の穴種の幾何。
 *
 * ここで「形」を一度だけ定義して、画面（SVG）・DXF・重なり判定・加工有効範囲の
 * 判定がぜんぶ同じ答えを見る。描く形と検査する形が別々だと、図では収まって
 * いるのに検査が鳴る（またはその逆）が必ず起きる。
 *
 * 座標系はすべて**主穴の中心が原点・Y 上向き**。角度はラジアンで反時計回り。
 */

/** 輪郭のひとかけら。DXF には ARC/LINE のまま出し、SVG では折れ線に刻む。 */
export type OutlinePart =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number };

/** 当たり判定・範囲判定に使う近似形。中心基準。 */
export type CutPart =
  | { t: 'c'; x: number; y: number; r: number }
  | { t: 'r'; x: number; y: number; w: number; h: number };

const TAU = Math.PI * 2;

/** ねじ下穴の中心位置（主穴中心からの相対）。 */
export function pilotPoints(m: MachiningDraft): Pt[] {
  if (m.kind !== 'hole' && m.kind !== 'slot' && m.kind !== 'notch') return [];
  const p = m.pilots;
  if (!p || p.n <= 0 || p.dia <= 0) return [];
  const n = Math.max(1, Math.round(p.n));

  // 丸穴系: PCD の円周に等配
  if (p.arrange === 'pcd' || m.kind === 'hole') {
    const r = (p.pcd ?? 0) / 2;
    const a0 = (((p.angle ?? 90) * Math.PI) / 180);
    return Array.from({ length: n }, (_, i) => {
      const a = a0 + (TAU * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }

  // 長丸穴: 両端の延長線上
  if (m.kind === 'slot') {
    const half = m.len / 2 + (p.offset ?? 5);
    const pts = n === 1 ? [{ x: half, y: 0 }] : [{ x: -half, y: 0 }, { x: half, y: 0 }];
    return (m.vert ? pts.map((q) => ({ x: q.y, y: q.x })) : pts).slice(0, n);
  }

  // 角穴系: 開口の縁から offset だけ外
  const w = m.w / 2 + (p.offset ?? 5);
  const h = m.h / 2 + (p.offset ?? 5);
  switch (p.arrange) {
    case 'lr':
      return [{ x: -w, y: 0 }, { x: w, y: 0 }].slice(0, n);
    case 'diag-tl':
      return [{ x: -w, y: h }, { x: w, y: -h }].slice(0, n);
    case 'diag-tr':
      return [{ x: w, y: h }, { x: -w, y: -h }].slice(0, n);
    case 'tb': {
      // 上下の辺に半分ずつ、辺に沿って等配（上下8個付）
      const half = Math.max(1, Math.floor(n / 2));
      const xs = Array.from({ length: half }, (_, i) =>
        half === 1 ? 0 : -m.w / 2 + (m.w * i) / (half - 1),
      );
      return [...xs.map((x) => ({ x, y: h })), ...xs.slice(0, n - half).map((x) => ({ x, y: -h }))];
    }
    case 'corners':
      return [
        { x: -w, y: h },
        { x: w, y: h },
        { x: -w, y: -h },
        { x: w, y: -h },
      ].slice(0, n);
    case 'even': {
      // 四隅を先に埋め、残りは対で「長い辺 → 短い辺 → 長い辺 …」の順に振り分ける。
      // 6個付=長い辺に1つずつ、8個付=各辺の中央、10個付=長い辺2つずつ＋短い辺1つずつ。
      const out: Pt[] = [
        { x: -w, y: h },
        { x: w, y: h },
        { x: -w, y: -h },
        { x: w, y: -h },
      ];
      const rest = n - 4;
      if (rest <= 0) return out.slice(0, Math.max(0, n));
      const wide = m.w >= m.h;
      let long = 0;
      let short = 0;
      for (let i = 0; i < Math.floor(rest / 2); i++) (i % 2 === 0 ? long++ : short++);
      const spread = (count: number, len: number) =>
        Array.from({ length: count }, (_, i) => -len / 2 + (len * (i + 1)) / (count + 1));
      // 余りの1つは長い辺の上側へ
      const topN = long + (rest % 2);
      if (wide) {
        for (const x of spread(topN, m.w)) out.push({ x, y: h });
        for (const x of spread(long, m.w)) out.push({ x, y: -h });
        for (const y of spread(short, m.h)) out.push({ x: -w, y });
        for (const y of spread(short, m.h)) out.push({ x: w, y });
      } else {
        for (const y of spread(topN, m.h)) out.push({ x: -w, y });
        for (const y of spread(long, m.h)) out.push({ x: w, y });
        for (const x of spread(short, m.w)) out.push({ x, y: h });
        for (const x of spread(short, m.w)) out.push({ x, y: -h });
      }
      return out.slice(0, n);
    }
    default:
      return [];
  }
}

/** ねじ下穴の径。無ければ 0。 */
export function pilotDia(m: MachiningDraft): number {
  const p = m.kind === 'hole' || m.kind === 'slot' || m.kind === 'notch' ? m.pilots : undefined;
  return p && p.n > 0 ? p.dia : 0;
}

/**
 * 主穴の輪郭（中心基準）。丸穴は circles として返し、それ以外は線と弧の並び。
 * タップの二重丸はここでは扱わない（表示側の記法なので）。
 */
export function cutOutline(m: MachiningDraft): { parts: OutlinePart[]; circles: { x: number; y: number; r: number }[] } {
  const parts: OutlinePart[] = [];
  const circles: { x: number; y: number; r: number }[] = [];

  if (m.kind === 'hole') {
    if (m.dia > 0) circles.push({ x: 0, y: 0, r: m.dia / 2 });
  } else if (m.kind === 'slot') {
    const r = m.dia / 2;
    const half = Math.max(0, m.len / 2 - r);
    if (half === 0) {
      circles.push({ x: 0, y: 0, r });
    } else {
      // 横向きで組んでから、縦なら 90° 回す
      const raw: OutlinePart[] = [
        { t: 'line', x1: -half, y1: r, x2: half, y2: r },
        { t: 'arc', cx: half, cy: 0, r, a0: -Math.PI / 2, a1: Math.PI / 2 },
        { t: 'line', x1: half, y1: -r, x2: -half, y2: -r },
        { t: 'arc', cx: -half, cy: 0, r, a0: Math.PI / 2, a1: (Math.PI * 3) / 2 },
      ];
      parts.push(...(m.vert ? raw.map(rot90) : raw));
    }
  } else if (m.kind === 'notch') {
    const w = m.w / 2;
    const h = m.h / 2;
    const r = Math.min(m.r ?? 0, w, h);
    const c = Math.min(m.c ?? 0, w, h);
    if (r > 0) {
      // R付角穴
      parts.push(
        { t: 'line', x1: -w + r, y1: h, x2: w - r, y2: h },
        { t: 'arc', cx: w - r, cy: h - r, r, a0: 0, a1: Math.PI / 2 },
        { t: 'line', x1: w, y1: h - r, x2: w, y2: -h + r },
        { t: 'arc', cx: w - r, cy: -h + r, r, a0: -Math.PI / 2, a1: 0 },
        { t: 'line', x1: w - r, y1: -h, x2: -w + r, y2: -h },
        { t: 'arc', cx: -w + r, cy: -h + r, r, a0: Math.PI, a1: (Math.PI * 3) / 2 },
        { t: 'line', x1: -w, y1: -h + r, x2: -w, y2: h - r },
        { t: 'arc', cx: -w + r, cy: h - r, r, a0: Math.PI / 2, a1: Math.PI },
      );
    } else if (c > 0) {
      // 変形角穴（角を 45° で落とした八角形）
      const pts: Pt[] = [
        { x: -w + c, y: h },
        { x: w - c, y: h },
        { x: w, y: h - c },
        { x: w, y: -h + c },
        { x: w - c, y: -h },
        { x: -w + c, y: -h },
        { x: -w, y: -h + c },
        { x: -w, y: h - c },
      ];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        parts.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    } else {
      parts.push(
        { t: 'line', x1: -w, y1: h, x2: w, y2: h },
        { t: 'line', x1: w, y1: h, x2: w, y2: -h },
        { t: 'line', x1: w, y1: -h, x2: -w, y2: -h },
        { t: 'line', x1: -w, y1: -h, x2: -w, y2: h },
      );
    }
  } else if (m.kind === 'dcut') {
    const r = m.dia / 2;
    if (m.flats === 1) {
      // 右側を落とす。across = 左の円の縁から平らな面まで
      const xf = Math.min(r - 0.1, Math.max(-r + 0.1, m.across - r));
      const th = Math.acos(xf / r);
      parts.push(
        { t: 'arc', cx: 0, cy: 0, r, a0: th, a1: TAU - th },
        { t: 'line', x1: xf, y1: -r * Math.sin(th), x2: xf, y2: r * Math.sin(th) },
      );
    } else {
      // 左右対称に2面。across = 二面幅
      const xf = Math.min(r - 0.1, Math.max(0.1, m.across / 2));
      const th = Math.acos(xf / r);
      parts.push(
        { t: 'arc', cx: 0, cy: 0, r, a0: th, a1: Math.PI - th },
        { t: 'line', x1: -xf, y1: r * Math.sin(th), x2: -xf, y2: -r * Math.sin(th) },
        { t: 'arc', cx: 0, cy: 0, r, a0: Math.PI + th, a1: TAU - th },
        { t: 'line', x1: xf, y1: -r * Math.sin(th), x2: xf, y2: r * Math.sin(th) },
      );
    }
  } else if (m.kind === 'keyhole') {
    const r1 = m.dia / 2;
    const r2 = m.dia2 / 2;
    const d = m.pitch;
    if (d >= r1 + r2 || d <= Math.abs(r1 - r2)) {
      // 重なっていない（または片方が中）なら、そのまま2つの円
      circles.push({ x: 0, y: 0, r: r1 }, { x: 0, y: d, r: r2 });
    } else {
      // 交わる2円の外側だけを残す（だるまの輪郭）
      const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
      const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
      parts.push(
        { t: 'arc', cx: 0, cy: 0, r: r1, a0: Math.PI / 2 + a1, a1: Math.PI / 2 - a1 + TAU },
        { t: 'arc', cx: 0, cy: d, r: r2, a0: -Math.PI / 2 + a2 - TAU, a1: -Math.PI / 2 - a2 },
      );
    }
  } else if (m.kind === 'keyway') {
    const r = m.dia / 2;
    const x0 = Math.min(r - 0.1, m.kw / 2);
    const yc = Math.sqrt(Math.max(0, r * r - x0 * x0));
    const yt = r + m.kh;
    const th = Math.atan2(yc, x0);
    const raw: OutlinePart[] = [
      { t: 'arc', cx: 0, cy: 0, r, a0: Math.PI - th, a1: th + TAU },
      { t: 'line', x1: x0, y1: yc, x2: x0, y2: yt },
      { t: 'line', x1: x0, y1: yt, x2: -x0, y2: yt },
      { t: 'line', x1: -x0, y1: yt, x2: -x0, y2: yc },
    ];
    parts.push(...(m.at === 'bottom' ? raw.map(flipY) : raw));
  }

  return { parts, circles };
}

const rot90 = (p: OutlinePart): OutlinePart =>
  p.t === 'line'
    ? { t: 'line', x1: -p.y1, y1: p.x1, x2: -p.y2, y2: p.x2 }
    : { t: 'arc', cx: -p.cy, cy: p.cx, r: p.r, a0: p.a0 + Math.PI / 2, a1: p.a1 + Math.PI / 2 };

const flipY = (p: OutlinePart): OutlinePart =>
  p.t === 'line'
    ? { t: 'line', x1: p.x1, y1: -p.y1, x2: p.x2, y2: -p.y2 }
    : { t: 'arc', cx: p.cx, cy: -p.cy, r: p.r, a0: -p.a1, a1: -p.a0 };

/** 弧を折れ線に刻むときの1歩（ラジアン）。表示用なのでこの粗さで足りる。 */
const ARC_STEP = Math.PI / 24;

/** 輪郭を折れ線に刻む（SVG 用）。中心基準の座標のまま返す。 */
export function outlinePolys(parts: OutlinePart[]): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
  const emit = (pts: Pt[]) => {
    if (cur.length > 0 && near(cur[cur.length - 1]!, pts[0]!)) cur.push(...pts.slice(1));
    else {
      if (cur.length >= 2) polys.push(cur);
      cur = pts;
    }
  };
  for (const p of parts) {
    if (p.t === 'line') emit([{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }]);
    else {
      const sweep = p.a1 - p.a0;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
      const pts: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = p.a0 + (sweep * i) / steps;
        pts.push({ x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a) });
      }
      emit(pts);
    }
  }
  if (cur.length >= 2) polys.push(cur);
  return polys;
}

/**
 * 当たり判定・加工有効範囲の判定に使う形の一覧（中心基準）。
 * 主穴とねじ下穴の全部を返す。R や面取りは無視して外形で見る（安全側）。
 */
export function cutParts(m: MachiningDraft): CutPart[] {
  const out: CutPart[] = [];
  if (m.kind === 'hole') {
    if (m.dia > 0) out.push({ t: 'c', x: 0, y: 0, r: m.dia / 2 });
  } else if (m.kind === 'slot') {
    out.push(
      m.vert
        ? { t: 'r', x: 0, y: 0, w: m.dia, h: m.len }
        : { t: 'r', x: 0, y: 0, w: m.len, h: m.dia },
    );
  } else if (m.kind === 'notch') {
    out.push({ t: 'r', x: 0, y: 0, w: m.w, h: m.h });
  } else if (m.kind === 'dcut') {
    out.push({ t: 'c', x: 0, y: 0, r: m.dia / 2 });
  } else if (m.kind === 'keyhole') {
    out.push({ t: 'c', x: 0, y: 0, r: m.dia / 2 }, { t: 'c', x: 0, y: m.pitch, r: m.dia2 / 2 });
  } else if (m.kind === 'keyway') {
    const dir = m.at === 'bottom' ? -1 : 1;
    out.push(
      { t: 'c', x: 0, y: 0, r: m.dia / 2 },
      { t: 'r', x: 0, y: dir * (m.dia / 2 + m.kh / 2), w: m.kw, h: m.kh },
    );
  }
  const pd = pilotDia(m);
  for (const p of pilotPoints(m)) out.push({ t: 'c', x: p.x, y: p.y, r: pd / 2 });
  return out;
}

/** カタログの1項目。メーカーのキャビスタの並びに合わせてある。 */
export type HolePreset = {
  id: string;
  label: string;
  make: (x: number, y: number) => MachiningDraft;
};

const pcd = (n: number, dia: number, pcdDia: number, angle = 90): Pilots => ({
  n,
  dia,
  arrange: 'pcd',
  pcd: pcdDia,
  angle,
});
const around = (n: number, arrange: Pilots['arrange'], dia = 4.5, offset = 6): Pilots => ({
  n,
  dia,
  arrange,
  offset,
});

/**
 * 穴カタログ。名前と並びはメーカーのキャビスタに合わせ、寸法は編集前提の初期値。
 * （インバータ操作パネルと Dサブの寸法は代表例。機種の取説と突き合わせて直すこと）
 */
export const HOLE_CATALOG: { group: string; items: HolePreset[] }[] = [
  {
    group: '丸穴',
    items: [
      { id: 'hole', label: '丸穴', make: (x, y) => ({ kind: 'hole', x, y, dia: 22 }) },
      { id: 'slot', label: '長丸穴', make: (x, y) => ({ kind: 'slot', x, y, len: 40, dia: 12 }) },
      { id: 'hole-p2', label: '丸穴 ねじ下穴2個付', make: (x, y) => ({ kind: 'hole', x, y, dia: 22, pilots: pcd(2, 4.5, 36, 0) }) },
      { id: 'hole-p3', label: '丸穴 ねじ下穴3個付（PCD）', make: (x, y) => ({ kind: 'hole', x, y, dia: 22, pilots: pcd(3, 4.5, 36) }) },
      { id: 'hole-p4', label: '丸穴 ねじ下穴4個付', make: (x, y) => ({ kind: 'hole', x, y, dia: 22, pilots: pcd(4, 4.5, 36, 45) }) },
      { id: 'slot-p2', label: '長丸穴 ねじ下穴2個付', make: (x, y) => ({ kind: 'slot', x, y, len: 40, dia: 12, pilots: { n: 2, dia: 4.5, arrange: 'lr', offset: 8 } }) },
      { id: 'hole-ud', label: '丸穴上下', make: (x, y) => ({ kind: 'hole', x, y, dia: 12, pilots: pcd(2, 12, 40) }) },
      { id: 'ring3', label: '丸穴3個（PCD）', make: (x, y) => ({ kind: 'hole', x, y, dia: 0, pilots: pcd(3, 6.5, 60) }) },
      { id: 'ring4', label: '丸穴4個（PCD）', make: (x, y) => ({ kind: 'hole', x, y, dia: 0, pilots: pcd(4, 6.5, 60, 45) }) },
      { id: 'beacon', label: '回転灯等 取付穴', make: (x, y) => ({ kind: 'hole', x, y, dia: 25, pilots: pcd(3, 4.5, 50) }) },
    ],
  },
  {
    group: '角穴',
    items: [
      { id: 'notch', label: '角穴', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 100 }) },
      { id: 'notch-p2', label: '角穴 ねじ下穴2個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 100, pilots: around(2, 'lr') }) },
      { id: 'notch-dtl', label: '角穴 ねじ下穴2個付（対角左上）', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 50, pilots: around(2, 'diag-tl') }) },
      { id: 'notch-dtr', label: '角穴 ねじ下穴2個付（対角右上）', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 50, pilots: around(2, 'diag-tr') }) },
      { id: 'notch-p4', label: '角穴 ねじ下穴4個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 100, pilots: around(4, 'corners') }) },
      { id: 'notch-p6', label: '角穴 ねじ下穴6個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 100, pilots: around(6, 'even') }) },
      { id: 'notch-p8', label: '角穴 ねじ下穴8個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 100, pilots: around(8, 'even') }) },
      { id: 'notch-tb8', label: '角穴 ねじ下穴上下8個付', make: (x, y) => ({ kind: 'notch', x, y, w: 150, h: 60, pilots: around(8, 'tb') }) },
      { id: 'notch-p10', label: '角穴 ねじ下穴10個付', make: (x, y) => ({ kind: 'notch', x, y, w: 200, h: 80, pilots: around(10, 'even') }) },
      { id: 'notch-r', label: 'R付角穴', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 60, r: 8 }) },
      { id: 'notch-r2', label: 'R付角穴 ねじ下穴2個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 60, r: 8, pilots: around(2, 'lr') }) },
      { id: 'notch-r4', label: 'R付角穴 ねじ下穴4個付', make: (x, y) => ({ kind: 'notch', x, y, w: 100, h: 60, r: 8, pilots: around(4, 'corners') }) },
      { id: 'notch-c3', label: '変形角穴 ねじ下穴3個付', make: (x, y) => ({ kind: 'notch', x, y, w: 60, h: 60, c: 10, pilots: around(3, 'even') }) },
      { id: 'notch-c4', label: '変形角穴 ねじ下穴4個付', make: (x, y) => ({ kind: 'notch', x, y, w: 60, h: 60, c: 10, pilots: around(4, 'corners') }) },
      { id: 'inv1', label: 'インバータ操作パネル等取付穴', make: (x, y) => ({ kind: 'notch', x, y, w: 45, h: 32, r: 2, note: '寸法は機種の取説で確認' }) },
      { id: 'inv2', label: 'インバータ操作パネル等取付穴2', make: (x, y) => ({ kind: 'notch', x, y, w: 26, h: 20, r: 2, note: '寸法は機種の取説で確認' }) },
      { id: 'notch-c', label: '変形角穴', make: (x, y) => ({ kind: 'notch', x, y, w: 60, h: 60, c: 10 }) },
    ],
  },
  {
    group: '複合穴',
    items: [
      { id: 'keyhole', label: 'ダルマ穴', make: (x, y) => ({ kind: 'keyhole', x, y, dia: 12, dia2: 6.5, pitch: 9 }) },
      { id: 'keyway', label: '直角キー溝付丸穴', make: (x, y) => ({ kind: 'keyway', x, y, dia: 22, kw: 4, kh: 2, at: 'top' }) },
      { id: 'dcut', label: 'D穴', make: (x, y) => ({ kind: 'dcut', x, y, dia: 22, across: 20, flats: 1 }) },
      { id: 'ddcut', label: 'ダブルD穴', make: (x, y) => ({ kind: 'dcut', x, y, dia: 22, across: 19, flats: 2 }) },
      { id: 'dsub', label: 'Dサブ等取付穴', make: (x, y) => ({ kind: 'notch', x, y, w: 19.3, h: 11, r: 1.5, pilots: { n: 2, dia: 3.2, arrange: 'lr', offset: 2.9 }, note: 'Dサブ9pin相当。ピン数に合わせて直す' }) },
      { id: 'keyway2', label: '直角キー溝付丸穴2', make: (x, y) => ({ kind: 'keyway', x, y, dia: 22, kw: 4, kh: 2, at: 'bottom' }) },
    ],
  },
];
