import { DIN_RAIL_HEIGHT, DIN_RAIL_WIDTH } from '../data/enclosures';
import { ductWidthOf, hasTapCuts, isRailMount, rotatedSize, rowAxisY, vertWidthOf } from '../types';
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
 * その横ダクト1本の幅。1本だけ別の型式にしているならそちらを使う。
 *
 * 縦ダクトは通し番号が横ダクトの本数で動いてしまうので、
 * 別の帳簿（vertGaps・左から何本目か）で持つ。→ vertWidth
 */
export function ductWidth(profile: Profile, ductIndex: number): number {
  return ductWidthOf(profile, ductIndex);
}

/** その縦ダクト1本の幅。vertIndex は左から何本目か。 */
export function vertWidth(profile: Profile, vertIndex: number): number {
  return vertWidthOf(profile, vertIndex);
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

/**
 * 中板上面から扉内面までの有効奥行き。ここに収まらない機器は扉に当たる。
 * 内訳が未入力なら null。数字を仮置きすると「収まっている」と読める図が出てしまう。
 */
export function effectiveDepth(panel: PanelSpec): number | null {
  const { backToPlate, doorProjection } = panel.depth;
  if (backToPlate === null || doorProjection === null) return null;
  return panel.outer.d - backToPlate - doorProjection;
}

/** 取付方式込みの機器の突出量。 */
export function deviceProjection(spec: DeviceSpec, mount: MountType): number {
  return spec.size.d + (isRailMount(mount) ? DIN_RAIL_HEIGHT : 0);
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
    ducts.push({
      id: id++,
      vert: b.v,
      x: b.x0,
      y: bottom,
      w: b.x1 - b.x0,
      h: h - margin.top - bottom,
    });
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
  /** この1台に重ねて付ける OP（DINレール取付アタッチメントなど）の specId */
  opts?: string[];
  /** DIN アタッチメントで取付方式を切り替える前の方式。OP を外したらここへ戻す */
  mountBeforeOp?: MountType;
  /**
   * ゾーン分割のときにどの区画へ置くか（0=左）。未指定なら分類で決める
   * （動力系は左・制御系は右）。図の上でドラッグして区画をまたぐと入る。
   */
  zone?: number;
};

type Entry = { item: LayoutItem; spec: DeviceSpec };

/** その1台の見かけの寸法。向きが 90/270 なら幅と高さが入れ替わる。 */
const sizeOf = (e: Entry) => rotatedSize(e.spec.size, e.item.rot);

/**
 * その1台が段の中で縦に占める高さ。**段の高さが固定のとき（equal モード）専用。**
 *
 * equal では基準線が段の中心に固定されるので、dinOffset でずらしても段からはみ出さない
 * には、オフセットの絶対値の2倍ぶん段が高くなければ成り立たない（中央基準のずらしのため
 * 両側に要る）。auto モードは基準線を動かせるので vertSpan を使う。
 */
function vertNeed(spec: DeviceSpec, mount: MountType, rot?: Rotation): number {
  const h = rotatedSize(spec.size, rot).h;
  const off = Math.abs(spec.dinOffset ?? 0);
  // 独立レールは機器と一緒に動くので段の高さを押し上げない。ただしレール帯そのものは段に入る
  if (mount === 'din-solo') return Math.max(h, (off + DIN_RAIL_WIDTH / 2) * 2);
  return h + (mount === 'din' ? off * 2 : 0);
}

/**
 * その1台が**基準線（レール中心）の上下それぞれに**要求する高さ。
 *
 * 段の高さを中身から決める auto モードで使う。基準線を段の中心に固定すると、
 * dinOffset でずらした逆側に同じだけの余りが出てしまう（オフセット19mm の機器で
 * 38mm の空きになる）ので、**上下を別々に積んで必要な側だけ確保する**。
 * 離隔も同じ考え方で、指定された側にだけ積む。
 */
function vertSpan(spec: DeviceSpec, mount: MountType, rot: Rotation | undefined, eff: Sides) {
  const half = rotatedSize(spec.size, rot).h / 2;
  if (mount === 'din-solo') {
    /*
     * 独立レールは機器の下に一緒に付いてくるので、機器は基準線に中心を合わせる。
     * レール帯（35mm）はオフセットのぶん機器の中心からずれた位置に来るので、
     * その帯が段に収まるところまでを要求する。
     */
    const off = spec.dinOffset ?? 0;
    const railHalf = DIN_RAIL_WIDTH / 2;
    return {
      up: Math.max(half + eff.top, railHalf - off),
      down: Math.max(half + eff.bottom, railHalf + off),
    };
  }
  const off = mount === 'din' ? (spec.dinOffset ?? 0) : 0;
  /*
   * ずらした逆側は詰めるが、**レール自身は段の中に収まっていないといけない**。
   * レールは幅 35mm の帯として基準線に跨って乗っているので、オフセットで
   * 詰めきると帯がダクト側へ出てしまう。詰める側だけ帯の半分を下限にする
   * （オフセット 0 の機器は今までどおり。段の高さは変わらない）。
   */
  const railHalf = DIN_RAIL_WIDTH / 2;
  const up = Math.max(0, half + off + eff.top, off < 0 ? railHalf : 0);
  const down = Math.max(0, half - off + eff.bottom, off > 0 ? railHalf : 0);
  return { up, down };
}

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

/** 縦ダクトの帯。左から何本目か（v）を持たせて、1本ずつ型式を切り替えられるようにする。 */
export type VertBand = Segment & { v: number };

/**
 * 縦ダクトの帯。面の幅に対する比から実際の位置に直す。
 * 端に立てる縦ダクトは面からはみ出さないよう内側に寄せる。
 * 太さは1本ずつ違うことがあるので、帯ごとに引く。
 */
function verticalBands(panel: PanelSpec, face: FaceId, profile: Profile): VertBand[] {
  const rule = LAYOUT_RULES[profile.duct.layout];
  if (!FACE_BY_ID.get(face)?.ducts) return [];
  const { w } = faceSize(panel, face);
  const m = profile.duct.margin;
  return rule.verticals.map((t, v) => {
    const dw = vertWidth(profile, v);
    const center = t === 0 ? m.left + dw / 2 : t === 1 ? w - m.right - dw / 2 : w * t;
    return { x0: center - dw / 2, x1: center + dw / 2, v };
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
 * 段の中での上下位置。**段の基準線（レール中心）に中心を合わせ**、
 * DINレール取付なら部品ごとのオフセットぶんだけずらす。
 * 基準線の指定が無い段（equal モード）では段の中心が基準線になる。
 */
function placeY(row: DeviceRow, spec: DeviceSpec, mount: MountType, rot?: Rotation) {
  const offset = mount === 'din' ? (spec.dinOffset ?? 0) : 0;
  return rowAxisY(row) - rotatedSize(spec.size, rot).h / 2 + offset;
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
  /** up/down は基準線（レール中心）から上下それぞれに要る高さ。段の高さはその和 */
  type Bucket = { entries: Placed[]; up: number; down: number; slots: Slot[] };

  const newBucket = (i: number): Bucket => ({
    entries: [],
    up: 0,
    down: 0,
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

  /**
   * ゾーン分割のとき、その機器が入るべき区画。既定は動力が左・制御が右だが、
   * 図の上でドラッグして区画をまたいだ機器は、その指定（item.zone）を優先する。
   */
  const zoneOf = (e: Entry, slots: Slot[]) => {
    if (!rule.zoned || slots.length < 2) return 0;
    if (e.item.zone !== undefined) return Math.max(0, Math.min(slots.length - 1, e.item.zone));
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
    const { w } = sizeOf(e);
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
    // 基準線の上下を別々に積む。オフセットも離隔も、要る側にだけ効かせる
    const need = vertSpan(e.spec, e.item.mount, e.item.rot, eff);
    b.up = Math.max(b.up, need.up);
    b.down = Math.max(b.down, need.down);
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
  /** 段の高さ＝基準線の上下に積んだ高さの和 */
  const bucketH = (b: { up: number; down: number }) => b.up + b.down;
  const requiredH =
    used.reduce((s, b) => s + bucketH(b), 0) +
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
    y -= bucketH(b);
    // 基準線は段の中心ではなく「下に要る高さ」の位置。オフセットした逆側を詰める
    const row: DeviceRow = { index, y, h: bucketH(b), axis: b.down };
    rows.push(row);
    for (const { e, x } of b.entries) {
      placed.push({
        uid: e.item.uid,
        specId: e.item.specId,
        face,
        mount: e.item.mount,
        opts: e.item.opts,
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
      vert: band.v,
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
      if (vertNeed(spec, item.mount, item.rot) + eff.top + eff.bottom > rr.h && candidates.length > 1) {
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
          opts: item.opts,
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

/**
 * 独立DINレール（din-solo）の左右の余長(mm)。
 *
 * 共通レールの余長（あとから機器を足せるよう長めに切る習慣）とは意味が違い、
 * こちらは**その1台をエンドストッパで挟むぶん**。長く出しても使い道がないので、
 * 段の設定とは分けて固定値にしてある。
 */
export const SOLO_RAIL_MARGIN = 5;

export type RailRun = {
  row: number;
  x: number;
  y: number;
  length: number;
  /** 独立レール（段の共通レールではない1本）か */
  solo?: boolean;
};

/**
 * 独立レール（段の共通レールではない1本）。
 *
 * 対象は **独立DINレール取付の機器**と、**段から外して座標で置いた機器**。
 * どちらも段の流れから外れていて、レールは機器と一緒に動く。
 * レールの中心は「機器の中心 − dinOffset」。オフセットは機器がレールからどれだけ
 * ずれて掛かるかなので、独立レールでは機器ではなくレールの側がずれる。
 *
 * 長さは機器幅＋左右 5mm（エンドストッパのぶん）。並べて接したものは1本につなげる。
 *
 * `exceptUid` を渡すと、その1台を無かったことにして計算する。ドラッグ中に
 * 「吸い付く先」を出すのに使う（自分のレールに吸い付こうとして暴れるのを防ぐ）。
 */
export function independentRails(
  layout: LayoutResult,
  devices: DeviceLookup,
  exceptUid?: string,
): RailRun[] {
  const runs: RailRun[] = [];
  for (const p of layout.placed) {
    if (p.uid === exceptUid) continue;
    if (!isRailMount(p.mount)) continue;
    if (p.mount !== 'din-solo' && !p.pinned) continue;
    const spec = devices.get(p.specId);
    if (!spec) continue;
    const s = rotatedSize(spec.size, p.rot);
    const y = p.y + s.h / 2 - (spec.dinOffset ?? 0);
    const band = { y0: y - DIN_RAIL_WIDTH / 2, y1: y + DIN_RAIL_WIDTH / 2 };
    const blocks = layout.ducts
      .filter((d) => !d.removed && d.y < band.y1 && band.y0 < d.y + d.h)
      .map((d) => ({ x0: d.x, x1: d.x + d.w }));
    const limitLeft = Math.max(0, ...blocks.filter((c) => c.x1 <= p.x + 0.01).map((c) => c.x1));
    const limitRight = Math.min(
      Infinity,
      ...blocks.filter((c) => c.x0 >= p.x + s.w - 0.01).map((c) => c.x0),
    );
    const left = Math.max(limitLeft, p.x - SOLO_RAIL_MARGIN);
    const right = Math.min(limitRight, p.x + s.w + SOLO_RAIL_MARGIN);
    runs.push({ row: p.row, x: left, y, length: Math.max(0, right - left), solo: true });
  }
  /*
   * 同じ高さで接している独立レールは1本につなげる。並べた機器はどう見ても
   * 1本のレールに乗っているので、レールが2本・エンドストッパが4個と数えられては困る。
   */
  mergeTouching(runs);
  return runs;
}

/**
 * DINレール。BOM と作図の両方がここを使う。
 * 正面視ではレールは高さ 35mm の帯として見えるので、機器の下端に合わせて描く。
 *
 * レールは2種類ある。
 * - **段の共通レール**: 段に流し込まれた DIN 機器が分け合う1本。両端の余長は設定で変えられる
 * - **独立レール**: 独立DINレール取付の機器と、**段から外して座標で置いた機器**の1本。
 *   機器と一緒に動き、両端 5mm（エンドストッパのぶん）で切る
 *
 * 座標で置いた機器を共通レールに数えないのが要点。数えると、段から遠くへ置くたびに
 * 共通レールがそこまで引き伸ばされる（実物では1本のレールがそんな形で伸びることはない）。
 */
export function computeRails(
  layout: LayoutResult,
  devices: DeviceLookup,
  endMargin: number = RAIL_END_MARGIN,
): RailRun[] {
  const out: RailRun[] = [];

  const railDevices = layout.placed
    .map((p) => ({ p, spec: devices.get(p.specId) }))
    .filter((e): e is { p: PlacedDevice; spec: DeviceSpec } => Boolean(e.spec) && isRailMount(e.p.mount));

  /** 帯（35mm）が重なる高さか。重なるレールどうしは同じ場所に置けない */
  const sameBand = (y1: number, y2: number) => Math.abs(y1 - y2) < DIN_RAIL_WIDTH;

  /*
   * 独立レールを先に決める。段の共通レールには乗らないので、機器と一緒に動く。
   * レールの中心は「機器の中心 − dinOffset」。オフセットは機器がレールからどれだけ
   * ずれて掛かるかなので、独立レールでは機器ではなくレールの側がずれる。
   *
   * 長さは機器幅＋左右 5mm（エンドストッパのぶん）。この 5mm は削れない場所なので、
   * 共通レールより先に取ってしまう。
   */
  const solo = independentRails(layout, devices);

  for (const row of layout.rows) {
    // 座標で置いた機器は段の流れから外れているので、共通レールにも数えない
    const inRow = railDevices.filter(
      (e) => e.p.row === row.index && e.p.mount === 'din' && !e.p.pinned,
    );
    if (inRow.length === 0) continue;

    // レールの中心は段の基準線。機器はここから dinOffset ぶんだけずれて掛かる
    // （基準線はオフセットのぶん段の中心からずれていることがある）
    const y = rowAxisY(row);

    /*
      レールをダクトに食い込ませない。
      実物はダクトが先に付いていてレールはその間に入るので、
      図の上で重なっていると切断長を間違える。
      レールが通る高さ（帯 35mm）にかかるダクトだけを見る。

      ゾーン分割や田の字では**縦ダクトが段の真ん中を横切る**。その場合は
      1本で貫かず、切れ目（縦ダクト）の間ごとに機器をまとめて**別々のレール**を引く。
    */
    const band = { y0: y - DIN_RAIL_WIDTH / 2, y1: y + DIN_RAIL_WIDTH / 2 };
    const cuts = [
      ...layout.ducts
        .filter((d) => !d.removed && d.y < band.y1 && band.y0 < d.y + d.h)
        .map((d) => ({ x0: d.x, x1: d.x + d.w })),
      /*
        独立レールも切れ目にする。同じ高さに共通レールが通ると、レールの上にレールが
        乗ることになって実物では組めない。共通レールの側が譲る（独立レールは1台ぶんしか
        無いので、動かせるのは共通レールのほう）。
      */
      ...solo.filter((r) => sameBand(r.y, y)).map((r) => ({ x0: r.x, x1: r.x + r.length })),
    ].sort((a, b) => a.x0 - b.x0);

    const sorted = [...inRow].sort((a, b) => a.p.x - b.p.x);
    const groups: (typeof inRow)[] = [];
    for (const e of sorted) {
      const g = groups[groups.length - 1];
      const gRight = g
        ? Math.max(...g.map((q) => q.p.x + rotatedSize(q.spec.size, q.p.rot).w))
        : 0;
      const split = g && cuts.some((c) => c.x0 >= gRight - 0.01 && c.x1 <= e.p.x + 0.01);
      if (!g || split) groups.push([e]);
      else g.push(e);
    }

    for (const g of groups) {
      const devLeft = Math.min(...g.map((e) => e.p.x));
      const devRight = Math.max(...g.map((e) => e.p.x + rotatedSize(e.spec.size, e.p.rot).w));
      const limitLeft = Math.max(0, ...cuts.filter((c) => c.x1 <= devLeft + 0.01).map((c) => c.x1));
      const limitRight = Math.min(
        Infinity,
        ...cuts.filter((c) => c.x0 >= devRight - 0.01).map((c) => c.x0),
      );
      const left = Math.max(limitLeft, devLeft - endMargin);
      const right = Math.min(limitRight, devRight + endMargin);
      /*
        機器のあいだに独立レールが挟まっているときは、切れ目で分けきれないことがある
        （余長どうしが噛み合って「間に収まる」と読めない場合）。最後に差し引いて、
        レールの上にレールが乗った図が残らないようにする。
      */
      const pieces = subtractSpans(
        { x0: left, x1: right },
        solo.filter((r) => sameBand(r.y, y)).map((r) => ({ x0: r.x, x1: r.x + r.length })),
      );
      for (const q of pieces) out.push({ row: row.index, x: q.x0, y, length: q.x1 - q.x0 });
    }
  }

  return [...out, ...solo];
}

/**
 * 同じ高さで接している・重なっているレールを1本にまとめる（配列をその場で書き換える）。
 * 並べて置いた機器は1本のレールに乗るので、切断長も固定穴もエンドストッパも1本ぶん。
 */
function mergeTouching(runs: RailRun[]): void {
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < runs.length - 1; ) {
    const a = runs[i]!;
    const b = runs[i + 1]!;
    // 接している（端どうしがぴったり）ぶんまで含めたいので、わずかな隙間は許す
    if (Math.abs(a.y - b.y) < 0.01 && b.x <= a.x + a.length + 0.01) {
      const right = Math.max(a.x + a.length, b.x + b.length);
      a.length = right - a.x;
      runs.splice(i + 1, 1);
      continue;
    }
    i++;
  }
}

/** 区間から区間を差し引く。残った断片を左から返す。 */
function subtractSpans(
  span: { x0: number; x1: number },
  cut: { x0: number; x1: number }[],
): { x0: number; x1: number }[] {
  let pieces = [span];
  for (const c of cut) {
    const next: { x0: number; x1: number }[] = [];
    for (const p of pieces) {
      if (c.x1 <= p.x0 || c.x0 >= p.x1) {
        next.push(p);
        continue;
      }
      if (c.x0 > p.x0) next.push({ x0: p.x0, x1: c.x0 });
      if (c.x1 < p.x1) next.push({ x0: c.x1, x1: p.x1 });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.x1 - p.x0 > 0.01);
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

/**
 * 機器とダクトの干渉。
 *
 * 段割りに乗っている機器は構造上ダクトに重ならないが、
 * - 段の高さ equal モードで段を名指しされた背の高い機器（AI の段指定を含む）
 * - Shift ドラッグで手動固定した機器
 * はダクトへ食い込める。物理的にダクトの上に機器は付かないので、必ず知らせる。
 */
function ductOverlaps(placed: PlacedDevice[], ducts: Duct[], devices: DeviceLookup): Violation[] {
  const out: Violation[] = [];
  const pen = 0.5; // 接している程度は見逃す
  for (const p of placed) {
    const spec = devices.get(p.specId);
    if (!spec) continue;
    const s = rotatedSize(spec.size, p.rot);
    for (const d of ducts) {
      if (d.removed) continue;
      const hit =
        p.x < d.x + d.w - pen &&
        d.x < p.x + s.w - pen &&
        p.y < d.y + d.h - pen &&
        d.y < p.y + s.h - pen;
      if (!hit) continue;
      const vert = d.h > d.w;
      const off = p.mount === 'din' ? (spec.dinOffset ?? 0) : 0;
      out.push({
        uid: p.uid,
        kind: 'overlap',
        message:
          `${spec.model}: ${vert ? '縦' : '横'}ダクトに重なっています（${vert ? '左右' : '上下'}方向の干渉）` +
          (p.pinned
            ? '。手で置いた位置がダクトに掛かっています'
            : `。高さ ${s.h}mm${off !== 0 ? `＋DINオフセット ${Math.abs(off)}mm（${off > 0 ? '上' : '下'}へ）` : ''} が段に入っていません` +
              '（段の高さを「自動」にするか、段数・盤サイズを見直してください）'),
      });
      break; // 1台につき1件で十分
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
      // 中板の機器は扉内面に当たらないか。内訳が未入力なら判定しない（当たり判定の根拠が無い）
      const limit = effectiveDepth(panel);
      // OP（アタッチメント等）は機器の下に挟まるので、その厚みぶん突出が増える
      const optD = (p.opts ?? []).reduce((sum, id) => sum + (devices.get(id)?.size.d ?? 0), 0);
      const projection = deviceProjection(spec, p.mount) + optD;
      if (limit !== null && projection > limit) {
        out.push({
          uid: p.uid,
          kind: 'depth',
          message:
            `${spec.model}: 突出 ${projection}mm` +
            (optD > 0 ? `（OP ${optD}mm 込み）` : '') +
            ` が有効奥行き ${limit}mm を超えています`,
        });
      }
    } else if (face === 'door') {
      // 扉の機器は「扉裏の突出量」の設定に収まっているか
      const limit = panel.depth.doorProjection;
      if (limit !== null && spec.size.d > limit) {
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
  // 干渉判定は removed の印が付いたあとの並びで行う。消した場所は機器が使ってよい
  const ducts = result.ducts.map((d) => (gone.has(d.id) ? { ...d, removed: true } : d));
  return {
    rows: result.rows,
    ducts,
    placed,
    violations: [
      ...result.violations,
      ...depthViolations(panel, face, placed, devices),
      ...detectOverlaps(placed, devices),
      ...ductOverlaps(placed, ducts, devices),
      // タップ穴加工付きの部品は中板専用。足す口は塞いであるが、
      // AI の配置や古いデータで紛れ込んだときにここで知らせる
      ...(face === 'plate'
        ? []
        : placed
            .filter((p) => hasTapCuts(devices.get(p.specId)))
            .map((p) => ({
              uid: p.uid,
              kind: 'tap-face' as const,
              message: `${devices.get(p.specId)?.model ?? p.specId}: タップ穴加工付きの部品は中板にだけ取り付けられます`,
            }))),
    ],
  };
}
