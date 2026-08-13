import { DIN_RAIL_HEIGHT, DIN_RAIL_WIDTH } from '../data/enclosures';
import { rotatedSize } from '../types';
import { FACE_BY_ID, faceSize } from '../data/faces';
import type {
  ClearanceSettings,
  DeviceRow,
  DeviceSpec,
  Duct,
  DuctLayoutId,
  FaceId,
  LayoutResult,
  MountType,
  PanelSpec,
  PlacedDevice,
  Profile,
  Rotation,
  Sides,
  Violation,
} from '../types';

/** 型式ID から機器仕様を引く。共通の部品表と My部品をまとめたもの。 */
export type DeviceLookup = Map<string, DeviceSpec>;

/** 発熱機器とみなすしきい値(W)。これを超えると上下に追加離隔を取る。 */
const HEAT_THRESHOLD_W = 10;

/**
 * ダクト1本ぶんの調整値。指定がなければ共通の設定。
 * 位置は「上から数えたダクトの通し番号」で引く。
 */
export function ductGap(
  profile: Profile,
  ductIndex: number,
): { above: number; below: number; left: number; right: number } {
  const o = profile.duct.ductGaps?.[ductIndex];
  return {
    above: o?.above ?? profile.clearance.deviceToDuct.bottom,
    below: o?.below ?? profile.clearance.deviceToDuct.top,
    left: o?.left ?? profile.duct.margin.left,
    right: o?.right ?? profile.duct.margin.right,
  };
}

/**
 * そのダクト1本の幅。1本だけ別の型式にしているならそちらを使う。
 *
 * 縦ダクトは横ダクトの本数が決まらないと通し番号が定まらないので、
 * 共通の幅のまま。1本ずつの切り替えは横ダクトが単位になる。
 */
export function ductWidth(profile: Profile, ductIndex: number): number {
  return profile.duct.ductGaps?.[ductIndex]?.width ?? profile.duct.width;
}

/**
 * その段の余白。段 r は「ダクト r の下」と「ダクト r+1 の上」に挟まれている。
 * 調整はダクト単位で持っているので、ここで段の見方に直す。
 */
export function rowGap(
  profile: Profile,
  rowIndex: number,
): { top: number; bottom: number; left: number; right: number } {
  const above = ductGap(profile, rowIndex);
  const below = ductGap(profile, rowIndex + 1);
  return {
    top: above.below,
    bottom: below.above,
    // 機器を置ける幅は、その段の上のダクトに合わせる
    left: above.left,
    right: above.right,
  };
}

/**
 * 実効クリアランス = max(段の余白設定, 機器個別のメーカー指定値)。
 * メーカー指定を下回らせないのが狙い。
 *
 * 上下はダクトが相手なので段の余白を下限にする。
 * 左右は隣の機器が相手なので、ここではメーカー指定値だけを返し、
 * 機器同士の間隔は呼び出し側で deviceToDevice.sameRow と突き合わせる。
 * （端子台のように横に密着させる機器で、ダクト用の余白を挟んでしまうのを防ぐ）
 */
export function effectiveClearance(
  spec: DeviceSpec,
  c: ClearanceSettings,
  gap: { top: number; bottom: number },
): Sides {
  const s = spec.clearance ?? {};
  const heat = (spec.heatW ?? 0) >= HEAT_THRESHOLD_W ? c.heatExtra : 0;
  // heat は「下限」として効かせる。メーカー指定値に足し込むと、
  // 既に発熱を見込んだ指定値に二重で上乗せしてしまうため。
  return {
    top: Math.max(gap.top, s.top ?? 0, heat),
    bottom: Math.max(gap.bottom, s.bottom ?? 0, heat),
    left: s.left ?? 0,
    right: s.right ?? 0,
  };
}

/** 中板上面から扉内面までの有効奥行き。ここに収まらない機器は扉に当たる。 */
export function effectiveDepth(panel: PanelSpec): number {
  return panel.outer.d - panel.depth.backToPlate - panel.depth.doorProjection;
}

/** 取付方式込みの機器の突出量。 */
export function deviceProjection(spec: DeviceSpec, mount: MountType): number {
  return spec.size.d + (mount === 'din' ? DIN_RAIL_HEIGHT : 0);
}

/**
 * equal モードのダクト・機器行の割り付け。rows は上から順（index 0 が最上段）。
 * 段数から機器行の高さを均等に割り出す。
 */
export function computeRows(
  panel: PanelSpec,
  face: FaceId,
  profile: Profile,
): { rows: DeviceRow[]; ducts: Duct[]; error?: string } {
  const { w, h } = faceSize(panel, face);
  const { margin, rowCount: n } = profile.duct;
  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;
  const rule = LAYOUT_RULES[profile.duct.layout];
  const dw = hasDucts ? profile.duct.width : 0;

  const usableH = h - margin.top - margin.bottom;
  // 横ダクトは1本ずつ幅が違うことがあるので、合計を先に出す
  const bandW = (i: number) => (hasDucts ? ductWidth(profile, i) : 0);
  const totalBands = rule.horizontals
    ? Array.from({ length: n + 1 }, (_, i) => bandW(i)).reduce((a, b) => a + b, 0)
    : // 段間に横ダクトを入れないレイアウトでは、代わりに段間クリアランスを取る
      Math.max(0, n - 1) * (hasDucts ? profile.clearance.deviceToDevice.betweenRows : 0);
  const rowSpacing = rule.horizontals ? 0 : hasDucts ? profile.clearance.deviceToDevice.betweenRows : 0;
  const rowH = (usableH - totalBands) / n;

  if (n < 1 || rowH <= 0 || w - margin.left - margin.right <= 0) {
    return {
      rows: [],
      ducts: [],
      error: '面に対してダクト幅・段数・余白が大きすぎます。設定を見直してください。',
    };
  }

  const bands = verticalBands(panel, face, profile);
  // 左右はダクト1本ごとに指定できる。縦ダクトのところで切る
  const span = (ductIndex: number) => {
    const g = ductGap(profile, ductIndex);
    return { x: g.left, w: w - g.left - g.right };
  };

  const rows: DeviceRow[] = [];
  const ducts: Duct[] = [];
  let id = 0;
  const pushHorizontal = (y: number) => {
    const s = span(id);
    for (const p of splitByBands(bands, s.x, s.w)) {
      ducts.push({ id, x: p.x0, y, w: p.x1 - p.x0, h: bandW(id) });
    }
    id++;
  };

  let cursor = h - margin.top;
  for (let i = 0; i < n; i++) {
    if (rule.horizontals && dw > 0) {
      cursor -= bandW(i);
      pushHorizontal(cursor);
    } else if (i > 0) {
      cursor -= rowSpacing;
    }
    cursor -= rowH;
    rows.push({ index: i, y: cursor, h: rowH });
  }
  if (rule.horizontals && dw > 0) {
    // 全周囲いは外周を閉じるので、最下段のダクトは面の下端（座標 0）に置く
    pushHorizontal(profile.duct.layout === 'perimeter' ? 0 : margin.bottom);
  }

  // 縦ダクトは全段そろえるときも同じように立てる
  const bottom = profile.duct.layout === 'perimeter' ? 0 : margin.bottom;
  for (const b of bands) {
    ducts.push({ id: id++, x: b.x0, y: bottom, w: b.x1 - b.x0, h: h - margin.top - bottom });
  }

  return { rows, ducts };
}

export type LayoutItem = {
  uid: string;
  specId: string;
  face: FaceId;
  mount: MountType;
  /** 何段目に置くかの指定。未指定なら順番に流し込む */
  row?: number;
  /** 向き(0/90/180/270)。図の上でダブルクリックすると回る */
  rot?: Rotation;
};

type Entry = { item: LayoutItem; spec: DeviceSpec };

/** その1台の見かけの寸法。向きが 90/270 なら幅と高さが入れ替わる。 */
const sizeOf = (e: Entry) => rotatedSize(e.spec.size, e.item.rot);

/**
 * その段の使える X 範囲（余白と端クリアランスの大きいほうを採る）。
 * 段ごとに左右の余白を変えられるので、段番号で変わる。
 */
function usableX(panel: PanelSpec, face: FaceId, profile: Profile, rowIndex: number) {
  const c = profile.clearance;
  const g = rowGap(profile, rowIndex);
  return {
    xMin: Math.max(g.left, c.deviceToPlateEdge),
    xMax: faceSize(panel, face).w - Math.max(g.right, c.deviceToPlateEdge),
  };
}

// ---------------------------------------------------------------------------
// ダクトレイアウト
// ---------------------------------------------------------------------------

/**
 * レイアウトごとの決まりごと。
 *
 * ダクトの引き方の違いは、結局のところ
 *  - 縦ダクトをどこに立てるか
 *  - 段と段の間に横ダクトを入れるか
 *  - 機器をどの区画に流し込むか
 * の3つに落ちる。ここで表にしておき、詰め込みの処理は共通にする。
 */
type LayoutRule = {
  /** 縦ダクトの位置。面の幅に対する比で持つ（0=左端, 0.5=中央, 1=右端） */
  verticals: number[];
  /** 段と段の間に横ダクトを入れるか */
  horizontals: boolean;
  /** 区画を機能で分ける（動力＝左／制御＝右） */
  zoned?: boolean;
  /** 端子台を必ず最下段に置く */
  terminalLast?: boolean;
};

const LAYOUT_RULES: Record<DuctLayoutId, LayoutRule> = {
  // 横ダクトだけ。いちばん一般的で、段の増減がそのまま見える
  'horizontal-rows': { verticals: [], horizontals: true },
  // 横ダクト段組みに、左端の縦ダクトを1列足したもの。
  // 主幹からの幹線を左で縦に落とし、各段へ横に振り分ける組み方
  'horizontal-left': { verticals: [0], horizontals: true },
  // 同じく右端に1列。盤の右から線を入れる現場向け
  'horizontal-right': { verticals: [1], horizontals: true },
  // 全周囲い。左右の縦ダクトと上下端の横ダクトで外周を囲む
  'perimeter': { verticals: [0, 1], horizontals: true },
  // 両サイドに縦ダクト。段間に横ダクトを入れず、配線は左右へ逃がす
  'vertical-sides': { verticals: [0, 1], horizontals: false },
  // 外周＋十字。両サイドと中央に縦ダクト、段間にも横ダクト
  cross: { verticals: [0, 0.5, 1], horizontals: true },
  // 中央の縦ダクトで動力（左）と制御（右）を分ける
  zoned: { verticals: [0.5], horizontals: true, zoned: true },
  // 横ダクト段組みのまま、端子台だけ最下段にまとめる
  'terminal-bottom': { verticals: [], horizontals: true, terminalLast: true },
};

/** 動力側に置く分類。ゾーン分割で左の区画に入れる。 */
const POWER_CATEGORIES = new Set(['breaker', 'contactor']);

export type Segment = { x0: number; x1: number };

/**
 * 縦ダクトの帯。面の幅に対する比から実際の位置に直す。
 * 端に立てる縦ダクトは面からはみ出さないよう内側に寄せる。
 */
function verticalBands(panel: PanelSpec, face: FaceId, profile: Profile): Segment[] {
  const rule = LAYOUT_RULES[profile.duct.layout];
  if (!FACE_BY_ID.get(face)?.ducts) return [];
  const { w } = faceSize(panel, face);
  const dw = profile.duct.width;
  const m = profile.duct.margin;
  return rule.verticals.map((t) => {
    const center = t === 0 ? m.left + dw / 2 : t === 1 ? w - m.right - dw / 2 : w * t;
    return { x0: center - dw / 2, x1: center + dw / 2 };
  });
}

/** その段で機器を置ける X 区画。縦ダクトで分断された残りを左から順に返す。 */
function rowSegments(
  panel: PanelSpec,
  face: FaceId,
  profile: Profile,
  rowIndex: number,
  bands: Segment[],
): Segment[] {
  const { xMin, xMax } = usableX(panel, face, profile, rowIndex);
  const gapToDuct = Math.max(
    profile.clearance.deviceToDuct.left,
    profile.clearance.deviceToDuct.right,
  );
  let out: Segment[] = [{ x0: xMin, x1: xMax }];
  for (const b of bands) {
    const next: Segment[] = [];
    for (const s of out) {
      // 帯の左側
      if (b.x0 - gapToDuct > s.x0) next.push({ x0: s.x0, x1: Math.min(s.x1, b.x0 - gapToDuct) });
      // 帯の右側
      if (b.x1 + gapToDuct < s.x1) next.push({ x0: Math.max(s.x0, b.x1 + gapToDuct), x1: s.x1 });
      // 帯に完全に隠れる区画は捨てる
      if (b.x0 - gapToDuct <= s.x0 && b.x1 + gapToDuct >= s.x1) continue;
    }
    out = next;
  }
  return out.filter((s) => s.x1 - s.x0 > 0);
}

/**
 * 横ダクトを縦ダクトで切り分ける。
 *
 * 実物は同じ場所に2本置けないので、**縦ダクトを通し**にして横ダクトを
 * その幅ぶん短くする。切られて2本以上になることもあるので、切れ端ごとに1本として返す。
 */
function splitByBands(bands: Segment[], x: number, w: number): Segment[] {
  let parts: Segment[] = [{ x0: x, x1: x + w }];
  for (const b of bands) {
    const next: Segment[] = [];
    for (const s of parts) {
      if (b.x0 > s.x0) next.push({ x0: s.x0, x1: Math.min(s.x1, b.x0) });
      if (b.x1 < s.x1) next.push({ x0: Math.max(s.x0, b.x1), x1: s.x1 });
      if (b.x0 <= s.x0 && b.x1 >= s.x1) continue;
    }
    parts = next;
  }
  // 切れ端が細すぎるものは実物として成り立たないので落とす
  return parts.filter((s) => s.x1 - s.x0 >= 1);
}

/** 機器同士の水平方向の間隔。 */
function horizontalGap(prevRight: number, eff: Sides, c: ClearanceSettings) {
  return Math.max(prevRight, eff.left, c.deviceToDevice.sameRow);
}

/**
 * 段の中での上下位置。中央合わせを基準に、DINレール取付なら
 * 部品ごとのオフセットぶんだけずらす。
 */
function placeY(row: DeviceRow, spec: DeviceSpec, mount: MountType, rot?: Rotation) {
  const offset = mount === 'din' ? (spec.dinOffset ?? 0) : 0;
  return row.y + (row.h - rotatedSize(spec.size, rot).h) / 2 + offset;
}

/**
 * 配置する順番のキュー。
 *
 * 並べ替えはしない。「＋ で増やした順」がそのまま並び順になる。
 * 図の上で機器をドラッグすると、この順番が入れ替わって配置に反映される。
 */
function buildQueue(items: LayoutItem[], skip: Set<string>, devices: DeviceLookup): Entry[] {
  return items
    .filter((i) => !skip.has(i.uid))
    .map((i) => {
      const spec = devices.get(i.specId);
      return spec ? { item: i, spec } : null;
    })
    .filter((e): e is Entry => e !== null);
}

/**
 * auto モード：段の高さを中身から決める。
 *
 * まず幅だけを見て機器を段に振り分け、段ごとに「一番背の高い機器＋クリアランス」を
 * その段の高さにする。実際の盤は段ごとに高さが違うので、こちらが実物に近い。
 * 段を指定された機器は、幅が空いていなくてもその段に入れる。
 */
function packAuto(panel: PanelSpec, face: FaceId, profile: Profile, queue: Entry[]) {
  const c = profile.clearance;
  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;
  const rule = LAYOUT_RULES[profile.duct.layout];
  const dw = hasDucts ? profile.duct.width : 0;
  // 段と段の間に横ダクトを入れないレイアウトでは、代わりに段間クリアランスを取る
  const rowSpacing = rule.horizontals ? dw : hasDucts ? c.deviceToDevice.betweenRows : 0;
  const size = faceSize(panel, face);
  const bands = verticalBands(panel, face, profile);
  const violations: Violation[] = [];

  type Placed = { e: Entry; x: number; eff: Sides };
  /** 段の中の区画。縦ダクトで分断されたそれぞれを別に詰める */
  type Slot = Segment & { cursor: number; prevRight: number; used: boolean };
  type Bucket = { entries: Placed[]; h: number; slots: Slot[] };

  const newBucket = (i: number): Bucket => ({
    entries: [],
    h: 0,
    slots: rowSegments(panel, face, profile, i, bands).map((s) => ({
      ...s,
      cursor: s.x0,
      prevRight: 0,
      used: false,
    })),
  });
  const buckets: Bucket[] = [newBucket(0)];
  const bucketAt = (i: number) => {
    while (buckets.length <= i) buckets.push(newBucket(buckets.length));
    return buckets[i]!;
  };
  let flow = 0;

  /** ゾーン分割のとき、その機器が入るべき区画。動力は左、制御は右 */
  const zoneOf = (e: Entry, slots: Slot[]) => {
    if (!rule.zoned || slots.length < 2) return 0;
    return POWER_CATEGORIES.has(e.spec.category) ? 0 : slots.length - 1;
  };

  // 端子台最下段: 端子台は他をすべて置いてから最後の段にまとめる
  const main = rule.terminalLast ? queue.filter((e) => e.spec.category !== 'terminal') : queue;
  const tail = rule.terminalLast ? queue.filter((e) => e.spec.category === 'terminal') : [];

  /** 何か入っている段のうち、いちばん下（＝いちばん大きい番号）。 */
  const lastUsed = () => {
    for (let i = buckets.length - 1; i >= 0; i--) if (buckets[i]!.entries.length > 0) return i;
    return 0;
  };

  const place = (e: Entry, forceLast: boolean) => {
    const { w, h } = sizeOf(e);
    const forced = e.item.row;
    // 段の指定がない機器は「いま使っている一番下の段」から探す。
    // あとから足した機器が1段目の空きに入ってしまうと、増やすたびに上へ潜り込んで見える
    let index =
      forced !== undefined && forced >= 0
        ? forced
        : forceLast
          ? buckets.length - 1
          : Math.max(flow, lastUsed());
    let b = bucketAt(index);
    let eff = effectiveClearance(e.spec, c, rowGap(profile, index));

    const widest = (bk: Bucket) => Math.max(0, ...bk.slots.map((s) => s.x1 - s.x0));
    if (w > widest(b)) {
      violations.push({
        uid: e.item.uid,
        kind: 'overflow',
        message: `${e.spec.model}: 幅 ${w}mm が ${index + 1} 段目の使える幅 ${Math.round(widest(b))}mm を超えています`,
      });
      return;
    }

    /** その段の中で置ける場所を探す。ゾーン指定があればそこから見る */
    const findSlot = (bk: Bucket) => {
      const from = zoneOf(e, bk.slots);
      const order = rule.zoned ? [from] : bk.slots.map((_, i) => i).filter((i) => i >= from);
      for (const i of order) {
        const s = bk.slots[i];
        if (!s) continue;
        const gap = horizontalGap(s.prevRight, eff, c);
        const x = s.used ? s.cursor + gap : s.x0;
        if (x + w <= s.x1) return { slot: s, x };
      }
      return null;
    };

    let hit = findSlot(b);
    if (!hit) {
      if (forced !== undefined && forced >= 0) {
        // 段を指定されているので、はみ出しても指定どおりの段に置いて知らせる
        const s = b.slots[zoneOf(e, b.slots)] ?? b.slots[0];
        if (!s) return;
        violations.push({
          uid: e.item.uid,
          kind: 'overflow',
          message: `${e.spec.model}: 指定された ${forced + 1} 段目に横幅が足りません`,
        });
        hit = { slot: s, x: s.used ? s.cursor + horizontalGap(s.prevRight, eff, c) : s.x0 };
      } else {
        flow = buckets.length;
        index = flow;
        b = bucketAt(index);
        eff = effectiveClearance(e.spec, c, rowGap(profile, index));
        hit = findSlot(b);
        if (!hit) return;
      }
    }

    b.entries.push({ e, x: hit.x, eff });
    hit.slot.cursor = hit.x + w;
    hit.slot.prevRight = eff.right;
    hit.slot.used = true;
    b.h = Math.max(b.h, h + eff.top + eff.bottom);
  };

  for (const e of main) place(e, false);
  if (tail.length > 0) {
    // 端子台は必ず新しい最下段から始める
    bucketAt(buckets.length);
    for (const e of tail) place(e, true);
  }

  const used = buckets.filter((b) => b.entries.length > 0);
  const rows: DeviceRow[] = [];
  const ducts: Duct[] = [];
  const placed: PlacedDevice[] = [];

  const availableH = size.h - profile.duct.margin.top - profile.duct.margin.bottom;
  const bandW = (i: number) => (dw > 0 ? ductWidth(profile, i) : 0);
  const requiredH =
    used.reduce((s, b) => s + b.h, 0) +
    (rule.horizontals && dw > 0
      ? Array.from({ length: used.length + 1 }, (_, i) => bandW(i)).reduce((a, b) => a + b, 0)
      : rowSpacing * Math.max(0, used.length - 1));

  // ダクトはその段に指定した左右の余白に合わせる。段ごとに余白を変えたとき、
  // ダクトだけ元の位置に残ると図が食い違うため。
  // 機器⇔端のクリアランスは機器に効かせるもので、ダクトは端まで伸ばしてよい。
  const ductSpan = (ductIndex: number) => {
    const g = ductGap(profile, ductIndex);
    return { x: g.left, w: size.w - g.left - g.right };
  };

  const pushHorizontal = (yAt: number) => {
    const span = ductSpan(id);
    for (const s of splitByBands(bands, span.x, span.w)) {
      ducts.push({ id, x: s.x0, y: yAt, w: s.x1 - s.x0, h: bandW(id) });
    }
    id++;
  };

  let y = size.h - profile.duct.margin.top;
  const top = y;
  let id = 0;
  used.forEach((b, index) => {
    if (rule.horizontals && dw > 0) {
      y -= bandW(index);
      pushHorizontal(y);
    } else if (index > 0) {
      y -= rowSpacing;
    }
    y -= b.h;
    const row: DeviceRow = { index, y, h: b.h };
    rows.push(row);
    for (const { e, x } of b.entries) {
      placed.push({
        uid: e.item.uid,
        specId: e.item.specId,
        face,
        mount: e.item.mount,
        x,
        y: placeY(row, e.spec, e.item.mount, e.item.rot),
        rot: e.item.rot ?? 0,
        row: index,
        pinned: false,
      });
    }
  });
  // 全周囲いは外周を閉じるのが目的なので、最下段のダクトを面の下端（座標 0）に置く。
  // 段の中身で長さが決まる auto モードでも、外周だけは面に合わせる。
  const closed = profile.duct.layout === 'perimeter';
  const bottom = closed ? 0 : profile.duct.margin.bottom;
  if (rule.horizontals && dw > 0 && used.length > 0) {
    // 最下段のダクトは、その上の段の余白に合わせる
    y = closed ? bottom : y - bandW(used.length);
    pushHorizontal(y);
  }

  // 縦ダクトは中板の余白いっぱいに通す。実際の盤でも上下いっぱいに立てるので、
  // 機器の量で長さが変わると必要本数が読みにくくなる。
  for (const band of bands) {
    ducts.push({
      id: id++,
      x: band.x0,
      y: bottom,
      w: band.x1 - band.x0,
      h: Math.max(0, top - bottom),
    });
  }

  if (requiredH > availableH) {
    violations.push({
      uid: '',
      kind: 'overflow',
      message:
        `必要高さ ${Math.round(requiredH)}mm が面の使える高さ ${Math.round(availableH)}mm を超えています` +
        `（${used.length}段必要）。盤を大きくするか、機器を減らしてください`,
    });
  }

  return { rows, ducts, placed, violations };
}

/** equal モード：段数と高さは固定で、そこへ機器を詰める。 */
function packEqual(
  panel: PanelSpec,
  face: FaceId,
  profile: Profile,
  queue: Entry[],
  pinned: PlacedDevice[],
  devices: DeviceLookup,
) {
  const { rows, ducts, error } = computeRows(panel, face, profile);
  const violations: Violation[] = [];
  if (error) {
    return { rows, ducts, placed: [], violations: [{ uid: '', kind: 'overflow' as const, message: error }] };
  }

  const c = profile.clearance;
  const span = rows.map((r) => usableX(panel, face, profile, r.index));
  const placed: PlacedDevice[] = [];
  const cursor = rows.map((_, i) => span[i]!.xMin);
  const prevRight = rows.map(() => 0);

  for (const p of pinned) {
    const spec = devices.get(p.specId);
    if (!spec) continue;
    placed.push(p);
    if (cursor[p.row] !== undefined) {
      cursor[p.row] = Math.max(cursor[p.row]!, p.x + rotatedSize(spec.size, p.rot).w);
      prevRight[p.row] = effectiveClearance(spec, c, rowGap(profile, p.row)).right;
    }
  }

  // row は「使い切った行」の先頭を指す共有カーソルで、幅を使い切ったときだけ前進させる。
  // 行の高さが足りないだけの場合はその行を他の機器がまだ使えるので、row は動かさない。
  let flow = 0;
  for (const { item, spec } of queue) {
    const size = rotatedSize(spec.size, item.rot);
    let done = false;
    let tooShort = false;
    const forced = item.row;
    const candidates =
      forced !== undefined && forced >= 0 && forced < rows.length
        ? [forced]
        : rows.map((r) => r.index).filter((i) => i >= flow);

    for (const r of candidates) {
      const rr = rows[r]!;
      const { xMin, xMax } = span[r] ?? usableX(panel, face, profile, r);
      const eff = effectiveClearance(spec, c, rowGap(profile, r));
      if (size.h + eff.top + eff.bottom > rr.h && candidates.length > 1) {
        tooShort = true;
        continue;
      }
      const gap = horizontalGap(prevRight[r] ?? 0, eff, c);
      const startX = cursor[r] === xMin ? xMin : (cursor[r] ?? xMin) + gap;
      const fits = startX + size.w <= xMax;
      if (fits || candidates.length === 1) {
        placed.push({
          uid: item.uid,
          specId: item.specId,
          face,
          mount: item.mount,
          x: startX,
          y: placeY(rr, spec, item.mount, item.rot),
          rot: item.rot ?? 0,
          row: r,
          pinned: false,
        });
        cursor[r] = startX + size.w;
        prevRight[r] = eff.right;
        done = true;
        if (!fits) {
          violations.push({
            uid: item.uid,
            kind: 'overflow',
            message: `${spec.model}: 指定された ${r + 1} 段目に横幅が足りません`,
          });
        }
        break;
      }
      if (r === flow) flow++;
    }
    if (!done) {
      violations.push({
        uid: item.uid,
        kind: tooShort ? 'clearance' : 'overflow',
        message: tooShort
          ? `${spec.model}: 高さ ${size.h}mm ＋ クリアランスが段の高さに収まりません（段数を減らすか盤を大きく）`
          : `${spec.model}: 横幅が足りません（盤を大きくするか段数を増やしてください）`,
      });
    }
  }

  return { rows, ducts, placed, violations };
}

/** DINレールの両端に確保する余長(mm)の既定値。エンドストッパの分。 */
export const RAIL_END_MARGIN = 20;

export type RailRun = { row: number; x: number; y: number; length: number };

/**
 * 段ごとの DINレール。BOM と作図の両方がここを使う。
 * 正面視ではレールは高さ 35mm の帯として見えるので、機器の下端に合わせて描く。
 *
 * 両端の余長は設定で変えられる。エンドストッパの厚みや、あとから機器を足せるよう
 * 長めに切る現場の習慣に合わせるため。
 */
export function computeRails(
  layout: LayoutResult,
  devices: DeviceLookup,
  endMargin: number = RAIL_END_MARGIN,
): RailRun[] {
  const out: RailRun[] = [];
  for (const row of layout.rows) {
    const inRow = layout.placed
      .filter((p) => p.row === row.index && p.mount === 'din')
      .map((p) => ({ p, spec: devices.get(p.specId) }))
      .filter((e): e is { p: PlacedDevice; spec: DeviceSpec } => Boolean(e.spec));
    if (inRow.length === 0) continue;

    const devLeft = Math.min(...inRow.map((e) => e.p.x));
    const devRight = Math.max(...inRow.map((e) => e.p.x + rotatedSize(e.spec.size, e.p.rot).w));
    // レールの中心は段の中心。機器はここから dinOffset ぶんだけずれて掛かる
    const y = row.y + row.h / 2;

    /*
      余長を伸ばすとき、ダクトに食い込ませない。
      実物はダクトが先に付いていてレールはその間に入るので、
      図の上で重なっていると切断長を間違える。
      レールが通る高さ（帯 35mm）にかかるダクトだけを見て、そこで止める。
    */
    const band = { y0: y - DIN_RAIL_WIDTH / 2, y1: y + DIN_RAIL_WIDTH / 2 };
    const blockers = layout.ducts.filter(
      (d) => !d.removed && d.y < band.y1 && band.y0 < d.y + d.h,
    );
    const limitLeft = Math.max(
      0,
      ...blockers.filter((d) => d.x + d.w <= devLeft + 0.01).map((d) => d.x + d.w),
    );
    const limitRight = Math.min(
      Infinity,
      ...blockers.filter((d) => d.x >= devRight - 0.01).map((d) => d.x),
    );

    const left = Math.max(limitLeft, devLeft - endMargin);
    const right = Math.min(limitRight, devRight + endMargin);
    out.push({ row: row.index, x: left, y, length: Math.max(0, right - left) });
  }
  return out;
}

/** 機器同士が実際に重なっていないか。手動配置で干渉させたときに気づけるようにする。 */
function detectOverlaps(placed: PlacedDevice[], devices: DeviceLookup): Violation[] {
  const out: Violation[] = [];
  const rects = placed
    .map((p) => ({ p, spec: devices.get(p.specId) }))
    .filter((r): r is { p: PlacedDevice; spec: DeviceSpec } => Boolean(r.spec));

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const sa = rotatedSize(a.spec.size, a.p.rot);
      const sb = rotatedSize(b.spec.size, b.p.rot);
      const hit =
        a.p.x < b.p.x + sb.w && b.p.x < a.p.x + sa.w && a.p.y < b.p.y + sb.h && b.p.y < a.p.y + sa.h;
      if (hit) {
        out.push({
          uid: a.p.uid,
          kind: 'overlap',
          message: `${a.spec.model} と ${b.spec.model} が重なっています`,
        });
      }
    }
  }
  return out;
}

/** 面ごとの奥行きチェック。面によって当たる相手が違う。 */
function depthViolations(
  panel: PanelSpec,
  face: FaceId,
  placed: PlacedDevice[],
  devices: DeviceLookup,
): Violation[] {
  const out: Violation[] = [];
  for (const p of placed) {
    const spec = devices.get(p.specId);
    if (!spec) continue;

    if (face === 'plate') {
      // 中板の機器は扉内面に当たらないか
      const limit = effectiveDepth(panel);
      const projection = deviceProjection(spec, p.mount);
      if (projection > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message: `${spec.model}: 突出 ${projection}mm が有効奥行き ${limit}mm を超えています`,
        });
      }
    } else if (face === 'door') {
      // 扉の機器は「扉裏の突出量」の設定に収まっているか
      const limit = panel.depth.doorProjection;
      if (spec.size.d > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message: `${spec.model}: 扉裏へ ${spec.size.d}mm 出ますが、設定は ${limit}mm です。奥行き設定を見直してください`,
        });
      }
    }
  }
  return out;
}

/**
 * 自動配置。
 *
 * 最適化（2Dビンパッキング）はあえて行わない。実務で求められているのは
 * 「隙間なく詰める」ことではなく「＋で足した順に並ぶ」ことで、
 * 最適解は見た目が常識から外れて使われなくなる。
 *
 * pinned（人が手で動かした機器）は座標を保持する。これにより機器を1台足しても
 * 既存の配置が組み替わらない。
 *
 * removedDucts に入れた通し番号のダクトは描かない。段の割り付けはそのままなので、
 * 下に余ったダクトを消しても上の配置は動かない。
 */
export function autoLayout(
  panel: PanelSpec,
  profile: Profile,
  face: FaceId,
  items: LayoutItem[],
  previous: PlacedDevice[],
  devices: DeviceLookup,
  removedDucts: number[] = [],
): LayoutResult {
  const faceItems = items.filter((i) => i.face === face);
  const uids = new Set(faceItems.map((i) => i.uid));
  const pinned = previous.filter((p) => p.pinned && p.face === face && uids.has(p.uid));
  const pinnedUids = new Set(pinned.map((p) => p.uid));
  const queue = buildQueue(faceItems, pinnedUids, devices);

  const auto = profile.duct.rowHeightMode === 'auto';
  const result = auto
    ? packAuto(panel, face, profile, queue)
    : packEqual(panel, face, profile, queue, pinned, devices);

  // auto モードでは段の高さを中身から決めるため、手動配置した機器は
  // 段の割り付けに参加させず、置かれた座標のまま残す。干渉は重なり検出で拾う。
  const placed = auto ? [...pinned, ...result.placed] : result.placed;

  // 消したダクトは配列から外さず印を付けて残す。図の上に薄く出して押し戻せるようにする
  const gone = new Set(removedDucts);
  return {
    rows: result.rows,
    ducts: result.ducts.map((d) => (gone.has(d.id) ? { ...d, removed: true } : d)),
    placed,
    violations: [
      ...result.violations,
      ...depthViolations(panel, face, placed, devices),
      ...detectOverlaps(placed, devices),
    ],
  };
}
