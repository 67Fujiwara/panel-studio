import { DIN_RAIL_HEIGHT } from '../data/enclosures';
import { DEVICE_BY_ID } from '../data/devices';
import type {
  ClearanceSettings,
  DeviceRow,
  DeviceSpec,
  DuctSettings,
  LayoutResult,
  PanelSpec,
  PlacedDevice,
  Profile,
  Rect,
  Sides,
  Violation,
} from '../types';

/** 発熱機器とみなすしきい値(W)。これを超えると上下に追加離隔を取る。 */
const HEAT_THRESHOLD_W = 10;

/**
 * 実効クリアランス = max(グローバル設定, 機器個別のメーカー指定値)。
 * メーカー指定を下回らせないのが狙い。
 *
 * 上下はダクトが相手なので deviceToDuct を下限にする。
 * 左右は隣の機器が相手なので、ここではメーカー指定値だけを返し、
 * 機器同士の間隔は呼び出し側で deviceToDevice.sameRow と突き合わせる。
 * （端子台のように横に密着させる機器で、ダクト用の余白を挟んでしまうのを防ぐ）
 */
export function effectiveClearance(spec: DeviceSpec, c: ClearanceSettings): Sides {
  const s = spec.clearance ?? {};
  const heat = (spec.heatW ?? 0) >= HEAT_THRESHOLD_W ? c.heatExtra : 0;
  // heat は「下限」として効かせる。メーカー指定値に足し込むと、
  // 既に発熱を見込んだ指定値に二重で上乗せしてしまうため。
  return {
    top: Math.max(c.deviceToDuct.top, s.top ?? 0, heat),
    bottom: Math.max(c.deviceToDuct.bottom, s.bottom ?? 0, heat),
    left: s.left ?? 0,
    right: s.right ?? 0,
  };
}

/** 中板上面から扉内面までの有効奥行き。ここに収まらない機器は扉に当たる。 */
export function effectiveDepth(panel: PanelSpec): number {
  return panel.depth.outer - panel.depth.backToPlate - panel.depth.doorProjection;
}

/** 取付方式込みの機器の突出量。 */
export function deviceProjection(spec: DeviceSpec, mount: PlacedDevice['mount']): number {
  return spec.size.d + (mount === 'din' ? DIN_RAIL_HEIGHT : 0);
}

/**
 * equal モードのダクト・機器行の割り付け。rows は上から順（index 0 が最上段）。
 * 段数から機器行の高さを均等に割り出す。
 */
export function computeRows(
  panel: PanelSpec,
  duct: DuctSettings,
): { rows: DeviceRow[]; ducts: Rect[]; error?: string } {
  const { w, h } = panel.plate;
  const { margin, width: dw, rowCount: n } = duct;

  const usableH = h - margin.top - margin.bottom;
  const rowH = (usableH - (n + 1) * dw) / n;

  const x = margin.left;
  const ductW = w - margin.left - margin.right;

  if (n < 1 || rowH <= 0 || ductW <= 0) {
    return {
      rows: [],
      ducts: [],
      error: '中板に対してダクト幅・段数・余白が大きすぎます。設定を見直してください。',
    };
  }

  const rows: DeviceRow[] = [];
  const ducts: Rect[] = [];

  for (let i = 0; i < n; i++) {
    const y = h - margin.top - (i + 1) * (dw + rowH);
    rows.push({ index: i, y, h: rowH });
    // 各機器行の上に1本
    ducts.push({ x, y: y + rowH, w: ductW, h: dw });
  }
  // 最下段の下にもう1本
  ducts.push({ x, y: margin.bottom, w: ductW, h: dw });

  return { rows, ducts };
}

/** 上段から順に埋めるためのカテゴリ優先度。端子台を最後にして下段に落とす。 */
const CATEGORY_ORDER: DeviceSpec['category'][] = [
  'breaker',
  'contactor',
  'relay',
  'plc',
  'psu',
  'other',
  'terminal',
];

export type LayoutItem = { uid: string; specId: string; mount: PlacedDevice['mount'] };

type Entry = { item: LayoutItem; spec: DeviceSpec; eff: Sides };

/** 中板の使える X 範囲（余白と中板端クリアランスの大きいほうを採る）。 */
function usableX(panel: PanelSpec, profile: Profile) {
  const c = profile.clearance;
  return {
    xMin: Math.max(profile.duct.margin.left, c.deviceToPlateEdge),
    xMax: panel.plate.w - Math.max(profile.duct.margin.right, c.deviceToPlateEdge),
  };
}

/** 機器同士の水平方向の間隔。 */
function horizontalGap(prevRight: number, eff: Sides, c: ClearanceSettings) {
  return Math.max(prevRight, eff.left, c.deviceToDevice.sameRow);
}

/** 未配置の機器をカテゴリ順に並べたキュー。 */
function buildQueue(items: LayoutItem[], skip: Set<string>, c: ClearanceSettings): Entry[] {
  return items
    .filter((i) => !skip.has(i.uid))
    .map((i) => {
      const spec = DEVICE_BY_ID.get(i.specId);
      return spec ? { item: i, spec, eff: effectiveClearance(spec, c) } : null;
    })
    .filter((e): e is Entry => e !== null)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.spec.category) - CATEGORY_ORDER.indexOf(b.spec.category));
}

/**
 * auto モード：段の高さを中身から決める。
 *
 * まず幅だけを見て機器を段に振り分け、段ごとに「一番背の高い機器＋クリアランス」を
 * その段の高さにする。実際の盤は段ごとに高さが違うので、こちらが実物に近い。
 */
function packAuto(
  panel: PanelSpec,
  profile: Profile,
  queue: Entry[],
): { rows: DeviceRow[]; ducts: Rect[]; placed: PlacedDevice[]; violations: Violation[] } {
  const c = profile.clearance;
  const { xMin, xMax } = usableX(panel, profile);
  const dw = profile.duct.width;
  const violations: Violation[] = [];

  type Bucket = { entries: { e: Entry; x: number }[]; h: number; cursor: number; prevRight: number };
  const buckets: Bucket[] = [];
  const newBucket = (): Bucket => ({ entries: [], h: 0, cursor: xMin, prevRight: 0 });

  let cur = newBucket();
  buckets.push(cur);

  for (const e of queue) {
    const w = e.spec.size.w;
    if (w > xMax - xMin) {
      violations.push({
        uid: e.item.uid,
        kind: 'overflow',
        message: `${e.spec.model}: 幅 ${w}mm が中板の使える幅 ${Math.round(xMax - xMin)}mm を超えています`,
      });
      continue;
    }
    const gap = horizontalGap(cur.prevRight, e.eff, c);
    let x = cur.entries.length === 0 ? xMin : cur.cursor + gap;
    if (x + w > xMax) {
      // この段は幅を使い切ったので次の段へ
      cur = newBucket();
      buckets.push(cur);
      x = xMin;
    }
    cur.entries.push({ e, x });
    cur.cursor = x + w;
    cur.prevRight = e.eff.right;
    cur.h = Math.max(cur.h, e.spec.size.h + e.eff.top + e.eff.bottom);
  }

  const used = buckets.filter((b) => b.entries.length > 0);
  const rows: DeviceRow[] = [];
  const ducts: Rect[] = [];
  const placed: PlacedDevice[] = [];

  const x0 = profile.duct.margin.left;
  const ductW = panel.plate.w - profile.duct.margin.left - profile.duct.margin.right;
  const availableH = panel.plate.h - profile.duct.margin.top - profile.duct.margin.bottom;
  const requiredH = used.reduce((s, b) => s + b.h, 0) + (used.length + 1) * dw;

  // 上から順に「ダクト → 機器行」を積んでいく
  let y = panel.plate.h - profile.duct.margin.top;
  used.forEach((b, index) => {
    y -= dw;
    ducts.push({ x: x0, y, w: ductW, h: dw });
    y -= b.h;
    rows.push({ index, y, h: b.h });
    for (const { e, x } of b.entries) {
      placed.push({
        uid: e.item.uid,
        specId: e.item.specId,
        mount: e.item.mount,
        x,
        y: y + e.eff.bottom,
        row: index,
        pinned: false,
      });
    }
  });
  if (used.length > 0) {
    y -= dw;
    ducts.push({ x: x0, y, w: ductW, h: dw });
  }

  if (requiredH > availableH) {
    violations.push({
      uid: '',
      kind: 'overflow',
      message:
        `必要高さ ${Math.round(requiredH)}mm が中板の使える高さ ${Math.round(availableH)}mm を超えています` +
        `（${used.length}段必要）。盤を大きくするか、機器を減らしてください`,
    });
  }

  return { rows, ducts, placed, violations };
}

/** equal モード：段数と高さは固定で、そこへ機器を詰める。 */
function packEqual(
  panel: PanelSpec,
  profile: Profile,
  queue: Entry[],
  pinned: PlacedDevice[],
): { rows: DeviceRow[]; ducts: Rect[]; placed: PlacedDevice[]; violations: Violation[] } {
  const { rows, ducts, error } = computeRows(panel, profile.duct);
  const violations: Violation[] = [];
  if (error) {
    return { rows, ducts, placed: [], violations: [{ uid: '', kind: 'overflow', message: error }] };
  }

  const c = profile.clearance;
  const { xMin, xMax } = usableX(panel, profile);
  const placed: PlacedDevice[] = [];
  const cursor = rows.map(() => xMin);
  const prevRight = rows.map(() => 0);

  // pinned は先に確定させ、その行のカーソルを進めておく
  for (const p of pinned) {
    const spec = DEVICE_BY_ID.get(p.specId);
    if (!spec) continue;
    placed.push(p);
    if (cursor[p.row] !== undefined) {
      cursor[p.row] = Math.max(cursor[p.row]!, p.x + spec.size.w);
      prevRight[p.row] = effectiveClearance(spec, c).right;
    }
  }

  // row は「使い切った行」の先頭を指す共有カーソルで、幅を使い切ったときだけ前進させる。
  // 行の高さが足りないだけの場合はその行を他の機器がまだ使えるので、row は動かさない。
  let row = 0;
  for (const { item, spec, eff } of queue) {
    let done = false;
    let tooShort = false;
    for (let r = row; r < rows.length; r++) {
      const rr = rows[r]!;
      if (spec.size.h + eff.top + eff.bottom > rr.h) {
        tooShort = true;
        continue;
      }
      const gap = horizontalGap(prevRight[r] ?? 0, eff, c);
      const startX = cursor[r] === xMin ? xMin : (cursor[r] ?? xMin) + gap;
      if (startX + spec.size.w <= xMax) {
        placed.push({
          uid: item.uid,
          specId: item.specId,
          mount: item.mount,
          x: startX,
          y: rr.y + eff.bottom,
          row: r,
          pinned: false,
        });
        cursor[r] = startX + spec.size.w;
        prevRight[r] = eff.right;
        done = true;
        break;
      }
      if (r === row) row++;
    }
    if (!done) {
      violations.push({
        uid: item.uid,
        kind: tooShort ? 'clearance' : 'overflow',
        message: tooShort
          ? `${spec.model}: 高さ ${spec.size.h}mm ＋ クリアランスが機器行の高さに収まりません（段数を減らすか盤を大きく）`
          : `${spec.model}: 横幅が足りません（盤を大きくするか段数を増やしてください）`,
      });
    }
  }

  return { rows, ducts, placed, violations };
}

/** DINレールの両端に確保する余長(mm)。エンドストッパの分。 */
export const RAIL_END_MARGIN = 20;

export type RailRun = { row: number; x: number; y: number; length: number };

/**
 * 段ごとの DINレール。BOM の切断長と DXF の作図の両方がここを使う。
 * 正面視ではレールは高さ 35mm の帯として見えるので、機器の下端に合わせて描く。
 */
export function computeRails(layout: LayoutResult): RailRun[] {
  const out: RailRun[] = [];
  for (const row of layout.rows) {
    const inRow = layout.placed
      .filter((p) => p.row === row.index && p.mount === 'din')
      .map((p) => ({ p, spec: DEVICE_BY_ID.get(p.specId) }))
      .filter((e): e is { p: PlacedDevice; spec: DeviceSpec } => Boolean(e.spec));
    if (inRow.length === 0) continue;

    const left = Math.max(0, Math.min(...inRow.map((e) => e.p.x)) - RAIL_END_MARGIN);
    const right = Math.max(...inRow.map((e) => e.p.x + e.spec.size.w)) + RAIL_END_MARGIN;
    const y = Math.min(...inRow.map((e) => e.p.y));
    out.push({ row: row.index, x: left, y, length: right - left });
  }
  return out;
}

/** 機器同士が実際に重なっていないか。手動配置で干渉させたときに気づけるようにする。 */
function detectOverlaps(placed: PlacedDevice[]): Violation[] {
  const out: Violation[] = [];
  const rects = placed
    .map((p) => {
      const spec = DEVICE_BY_ID.get(p.specId);
      return spec ? { p, spec } : null;
    })
    .filter((r): r is { p: PlacedDevice; spec: DeviceSpec } => r !== null);

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const hit =
        a.p.x < b.p.x + b.spec.size.w &&
        b.p.x < a.p.x + a.spec.size.w &&
        a.p.y < b.p.y + b.spec.size.h &&
        b.p.y < a.p.y + a.spec.size.h;
      if (hit) {
        out.push({
          uid: a.p.uid,
          kind: 'overlap',
          message: `${a.spec.model} と ${b.spec.model} が重なっています`,
        });
        out.push({ uid: b.p.uid, kind: 'overlap', message: '' });
      }
    }
  }
  // uid だけ立てた重複メッセージは表示しない
  return out.filter((v, i) => v.message !== '' || out.findIndex((o) => o.uid === v.uid) === i);
}

/**
 * 自動配置。
 *
 * 最適化（2Dビンパッキング）はあえて行わない。実務で求められているのは
 * 「隙間なく詰める」ことではなく「主幹は上段、端子台は下段」といった
 * 人間のルールどおりに並ぶことで、最適解は見た目が常識から外れて使われなくなる。
 *
 * pinned（人が手で動かした機器）は座標を保持する。これにより機器を1台足しても
 * 既存の配置が組み替わらない。
 */
export function autoLayout(
  panel: PanelSpec,
  profile: Profile,
  items: LayoutItem[],
  previous: PlacedDevice[] = [],
): LayoutResult {
  const c = profile.clearance;
  const uids = new Set(items.map((i) => i.uid));
  const pinned = previous.filter((p) => p.pinned && uids.has(p.uid));
  const pinnedUids = new Set(pinned.map((p) => p.uid));
  const queue = buildQueue(items, pinnedUids, c);

  const auto = profile.duct.rowHeightMode === 'auto';
  const result = auto
    ? packAuto(panel, profile, queue)
    : packEqual(panel, profile, queue, pinned);

  // auto モードでは段の高さを中身から決めるため、手動配置した機器は
  // 段の割り付けに参加させず、置かれた座標のまま残す。
  // 干渉は下の重なり検出で拾う。
  const placed = auto ? [...pinned, ...result.placed] : result.placed;

  const violations = [...result.violations];

  // 奥行き方向の干渉チェック（扉裏に当たらないか）
  const depthLimit = effectiveDepth(panel);
  for (const p of placed) {
    const spec = DEVICE_BY_ID.get(p.specId);
    if (!spec) continue;
    const projection = deviceProjection(spec, p.mount);
    if (projection > depthLimit) {
      violations.push({
        uid: p.uid,
        kind: 'depth',
        message: `${spec.model}: 突出 ${projection}mm が有効奥行き ${depthLimit}mm を超えています`,
      });
    }
  }

  violations.push(...detectOverlaps(placed));

  return { rows: result.rows, ducts: result.ducts, placed, violations };
}
