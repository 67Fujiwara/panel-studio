/**
 * 段への流し込み（auto モード）と、段の高さが固定の equal モード。
 *
 * auto モードは 3 つの手順に分けてある。順に呼ぶのが packAuto。
 *  1. rowSlots      — 段の枠を作る（縦ダクトで区切られた区画ごとのカーソル）
 *  2. findSlot      — 1 台の置き場所を探す（区画の順・座標置きの回避・幅の確認）
 *  3. resolveRows   — 段の高さと基準線を決め、横ダクト・縦ダクトを引き、機器の座標を出す
 * 上へ詰める（pushRowsUp）は autoLayout 側で、消したダクトを反映したあとに呼ぶ。
 *
 * どの手順も**数値の答えを変えない**ことを tests/unit/layout.golden.test.ts で確かめている。
 */
import { FACE_BY_ID, faceSize } from '../../data/faces';
import { rotatedSize } from '../../types';
import type {
  ClearanceSettings,
  DeviceRow,
  Duct,
  FaceId,
  PanelSpec,
  PlacedDevice,
  Profile,
  Sides,
  Violation,
} from '../../types';
import { SOLO_RAIL_MARGIN } from './constants';
import {
  ductGap,
  ductWidth,
  effectiveClearance,
  horizontalGap,
  isStopper,
  placeY,
  rowGap,
  sizeOf,
  soloMark,
  stopperGap,
  vertNeed,
  vertSpan,
} from './clearance';
import { LAYOUT_RULES, POWER_CATEGORIES, computeRows, rowSegments, splitByBands, usableX, verticalBands } from './ducts';
import type { LayoutRule } from './ducts';
import type { DeviceLookup, Entry, LayoutItem, Obstacle, Segment, VertBand } from './types';

/** 段に置いた 1 台（座標を出す前） */
export type Placed = { e: Entry; x: number; eff: Sides };

/** 段の中の区画。縦ダクトで分断されたそれぞれを別に詰める */
export type Slot = Segment & {
  cursor: number;
  prevRight: number;
  /** 直前に置いた1台が独立レールなら、そのレール高さ。違えば null */
  prevSolo: number | null;
  /** 直前に置いたのが止め金具か。止め金具の隣は離隔なしで密着させる */
  prevStopper: boolean;
  used: boolean;
};

/**
 * 段。up/down は基準線（レール中心）の上下に要る高さ（全部の機器）。
 * downDuct は**下のダクトが避けるべき高さ**で、下のダクトが実際に通る機器だけで決める。
 * 段の基準線（axis）は up/down で決めるので、機器を座標置きにしても基準線が動かず、
 * レールがばらけない。ダクトの位置だけが downDuct で決まる
 */
export type Bucket = {
  entries: Placed[];
  pinnedCount: number;
  up: number;
  down: number;
  downDuct: number;
  slots: Slot[];
};

/** 1 台ぶんの、段によらない性質。段を変えて置き直すときも同じ */
export type Candidate = {
  e: Entry;
  w: number;
  /** 独立レールの高さ（独立レール取付でなければ null） */
  mySolo: number | null;
  /** 独立レールの機器は、機器の幅のほかに左右のエンドストッパの場所も要る */
  myEnds: number;
  /** 止め金具は隣に密着。自分が止め金具でも、直前が止め金具でも、間隔は 0 */
  iAmStopper: boolean;
};

/** 流し込みの決めごと。面と設定から決まり、置く間は変わらない */
export type PackContext = {
  panel: PanelSpec;
  face: FaceId;
  profile: Profile;
  rule: LayoutRule;
  c: ClearanceSettings;
  bands: VertBand[];
  obstacles: Obstacle[];
};

export function packContext(panel: PanelSpec, face: FaceId, profile: Profile, obstacles: Obstacle[]): PackContext {
  return {
    panel,
    face,
    profile,
    rule: LAYOUT_RULES[profile.duct.layout],
    c: profile.clearance,
    bands: verticalBands(panel, face, profile),
    obstacles,
  };
}

// ---------------------------------------------------------------------------
// 1. 段の枠を作る
// ---------------------------------------------------------------------------

/** その段の区画（縦ダクトで切られた残り）に、置くためのカーソルを付けたもの */
export function rowSlots(ctx: PackContext, rowIndex: number): Slot[] {
  return rowSegments(ctx.panel, ctx.face, ctx.profile, rowIndex, ctx.bands).map((s) => ({
    ...s,
    cursor: s.x0,
    prevRight: 0,
    prevSolo: null,
    prevStopper: false,
    used: false,
  }));
}

export function newBucket(ctx: PackContext, rowIndex: number): Bucket {
  return { entries: [], pinnedCount: 0, up: 0, down: 0, downDuct: 0, slots: rowSlots(ctx, rowIndex) };
}

/** index 番目の段。無ければそこまで段を増やす */
export function bucketAt(ctx: PackContext, buckets: Bucket[], index: number): Bucket {
  while (buckets.length <= index) buckets.push(newBucket(ctx, buckets.length));
  return buckets[index]!;
}

// ---------------------------------------------------------------------------
// 2. 1 台の置き場所を探す
// ---------------------------------------------------------------------------

export function candidateOf(e: Entry): Candidate {
  const mySolo = soloMark(e.spec, e.item.mount);
  return {
    e,
    w: sizeOf(e).w,
    mySolo,
    myEnds: mySolo === null ? 0 : SOLO_RAIL_MARGIN,
    iAmStopper: isStopper(e.spec),
  };
}

/**
 * ゾーン分割のとき、その機器が入るべき区画。既定は動力が左・制御が右だが、
 * 図の上でドラッグして区画をまたいだ機器は、その指定（item.zone）を優先する。
 */
export function zoneOf(rule: LayoutRule, e: Entry, slots: Slot[]): number {
  if (!rule.zoned || slots.length < 2) return 0;
  if (e.item.zone !== undefined) return Math.max(0, Math.min(slots.length - 1, e.item.zone));
  return POWER_CATEGORIES.has(e.spec.category) ? 0 : slots.length - 1;
}

/** 区画の直前の機器との間隔 */
export function gapAfter(s: Slot, cand: Candidate, eff: Sides, c: ClearanceSettings): number {
  return cand.iAmStopper || s.prevStopper ? 0 : horizontalGap(s.prevRight, eff, c, stopperGap(s.prevSolo, cand.mySolo));
}

/**
 * その段の中で置ける場所を探す。ゾーン指定があればそこから見る。
 * 座標で置いた機器（obstacles）は左から順に避ける。置けなければ null
 */
export function findSlot(
  ctx: PackContext,
  bucket: Bucket,
  rowIndex: number,
  cand: Candidate,
  eff: Sides,
): { slot: Slot; x: number } | null {
  const from = zoneOf(ctx.rule, cand.e, bucket.slots);
  const order = ctx.rule.zoned ? [from] : bucket.slots.map((_, i) => i).filter((i) => i >= from);
  const blocks = ctx.obstacles.filter((o) => o.row === rowIndex).sort((a, b) => a.x0 - b.x0);
  const gapO = Math.max(eff.left, ctx.c.deviceToDevice.sameRow);
  for (const i of order) {
    const s = bucket.slots[i];
    if (!s) continue;
    const gap = gapAfter(s, cand, eff, ctx.c);
    let x = s.used ? s.cursor + gap : s.x0 + cand.myEnds;
    for (const o of blocks) {
      // 座標で置いた止め金具の隣（または自分が止め金具）は離隔なしで密着させる
      const g = cand.iAmStopper || o.stopper ? 0 : gapO;
      if (x - g < o.x1 && o.x0 < x + cand.w + cand.myEnds + g) x = o.x1 + g + cand.myEnds;
    }
    if (x + cand.w + cand.myEnds <= s.x1) return { slot: s, x };
  }
  return null;
}

/** 置き場所が無いときに、それでもその段に押し込む位置（はみ出しは知らせる） */
function forcedSpot(ctx: PackContext, bucket: Bucket, cand: Candidate, eff: Sides): { slot: Slot; x: number } | null {
  const s = bucket.slots[zoneOf(ctx.rule, cand.e, bucket.slots)] ?? bucket.slots[0];
  if (!s) return null;
  return { slot: s, x: s.used ? s.cursor + gapAfter(s, cand, eff, ctx.c) : s.x0 + cand.myEnds };
}

/** 置いた 1 台を段の帳簿に載せる（カーソル・直前の性質・基準線の上下） */
export function commitPlacement(bucket: Bucket, hit: { slot: Slot; x: number }, cand: Candidate, eff: Sides): void {
  bucket.entries.push({ e: cand.e, x: hit.x, eff });
  hit.slot.cursor = hit.x + cand.w;
  hit.slot.prevRight = eff.right;
  hit.slot.prevSolo = cand.mySolo;
  hit.slot.prevStopper = cand.iAmStopper;
  hit.slot.used = true;
  // 基準線の上下を別々に積む。オフセットも離隔も、要る側にだけ効かせる
  const need = vertSpan(cand.e.spec, cand.e.item.mount, cand.e.item.rot, eff);
  bucket.up = Math.max(bucket.up, need.up);
  bucket.down = Math.max(bucket.down, need.down);
  bucket.downDuct = Math.max(bucket.downDuct, need.down);
}

/**
 * キューの機器を順に段へ入れる。
 *
 * - 段の指定がない機器は「いま使っている一番下の段」から探す。
 *   あとから足した機器が 1 段目の空きに入ってしまうと、増やすたびに上へ潜り込んで見える
 * - 入らなければ次の段へ。以前は 1 段だけ試して駄目なら黙って捨てていたが、
 *   座標置きの機器が次の段の幅も塞いでいると機器が消えたので、置ける段が見つかるまで下へ探す
 * - 段を指定された機器は、幅が空いていなくてもその段に入れて知らせる
 * - 端子台最下段のレイアウトでは、端子台を他をすべて置いたあと新しい最下段から始める
 */
export function fillBuckets(ctx: PackContext, queue: Entry[]): { buckets: Bucket[]; violations: Violation[] } {
  const buckets: Bucket[] = [newBucket(ctx, 0)];
  const violations: Violation[] = [];
  let flow = 0;

  // 端子台最下段: 端子台は他をすべて置いてから最後の段にまとめる
  const main = ctx.rule.terminalLast ? queue.filter((e) => e.spec.category !== 'terminal') : queue;
  const tail = ctx.rule.terminalLast ? queue.filter((e) => e.spec.category === 'terminal') : [];

  /** 何か入っている段のうち、いちばん下（＝いちばん大きい番号）。 */
  const lastUsed = () => {
    for (let i = buckets.length - 1; i >= 0; i--) if (buckets[i]!.entries.length > 0) return i;
    return 0;
  };

  const widest = (bk: Bucket) => Math.max(0, ...bk.slots.map((s) => s.x1 - s.x0));

  const place = (e: Entry, forceLast: boolean) => {
    const cand = candidateOf(e);
    const forced = e.item.row;
    let index =
      forced !== undefined && forced >= 0 ? forced : forceLast ? buckets.length - 1 : Math.max(flow, lastUsed());
    let b = bucketAt(ctx, buckets, index);
    let eff = effectiveClearance(e.spec, ctx.c, rowGap(ctx.profile, index));

    if (cand.w + cand.myEnds * 2 > widest(b)) {
      violations.push({
        uid: e.item.uid,
        kind: 'overflow',
        message: `${e.spec.model}: 幅 ${cand.w}mm が ${index + 1} 段目の使える幅 ${Math.round(widest(b))}mm を超えています`,
      });
      return;
    }

    let hit = findSlot(ctx, b, index, cand, eff);
    if (!hit) {
      if (forced !== undefined && forced >= 0) {
        // 段を指定されているので、はみ出しても指定どおりの段に置いて知らせる
        hit = forcedSpot(ctx, b, cand, eff);
        if (!hit) return;
        violations.push({
          uid: e.item.uid,
          kind: 'overflow',
          message: `${e.spec.model}: 指定された ${forced + 1} 段目に横幅が足りません`,
        });
      } else {
        // 座標置きの機器が塞いでいない段まで行けば必ず置ける（幅は上で確かめてある）
        const lastBlocked = ctx.obstacles.reduce((m, o) => Math.max(m, o.row), -1);
        let next = buckets.length;
        while (!hit && next <= Math.max(lastBlocked, buckets.length) + 1) {
          index = next;
          b = bucketAt(ctx, buckets, index);
          eff = effectiveClearance(e.spec, ctx.c, rowGap(ctx.profile, index));
          hit = findSlot(ctx, b, index, cand, eff);
          next++;
        }
        flow = index;
        if (!hit) {
          // ここへは来ないはずだが、来ても黙って消さずに知らせて置く
          hit = forcedSpot(ctx, b, cand, eff);
          if (!hit) return;
          violations.push({
            uid: e.item.uid,
            kind: 'overflow',
            message: `${e.spec.model}: 置ける段が見つかりません（座標で置いた機器で塞がっています）`,
          });
        }
      }
    }
    commitPlacement(b, hit, cand, eff);
  };

  for (const e of main) place(e, false);
  if (tail.length > 0) {
    // 端子台は必ず新しい最下段から始める
    bucketAt(ctx, buckets, buckets.length);
    for (const e of tail) place(e, true);
  }
  return { buckets, violations };
}

// ---------------------------------------------------------------------------
// 3. 段の高さと基準線を決め、ダクトを引き、機器の座標を出す
// ---------------------------------------------------------------------------

/**
 * 座標で置いた機器（obstacles）もその段の一員として数える。
 * 流し込みの機器が 1 台も無くなった段を空とみなして詰めてしまうと、下の段が繰り上がって、
 * 座標で置いた機器だけがその場に残り、図がばらばらになる。段の高さにも入れて、下のダクトが当たらないようにする。
 * 高さは**その機器の上／下をダクトが実際に通るときだけ**下のダクトの位置（downDuct）に入れる。
 * ダクトを短くしてあって機器の下を通らないなら、長さ的に当たらないのだから避けない
 */
export function foldObstacles(ctx: PackContext, buckets: Bucket[]): void {
  const hasDucts = FACE_BY_ID.get(ctx.face)?.ducts ?? false;
  const dw = hasDucts ? ctx.profile.duct.width : 0;
  const size = faceSize(ctx.panel, ctx.face);
  const ductSpan = (ductIndex: number) => {
    const g = ductGap(ctx.profile, ductIndex);
    return { x: g.left, w: size.w - g.left - g.right };
  };
  const ductCrosses = (ductIndex: number, x0: number, x1: number) => {
    if (!(ctx.rule.horizontals && dw > 0)) return true; // 横ダクトの無い組み方は段間クリアランスが相手なので常に数える
    const sp = ductSpan(ductIndex);
    return x0 < sp.x + sp.w && sp.x < x1;
  };
  for (const o of ctx.obstacles) {
    const b = bucketAt(ctx, buckets, o.row);
    b.pinnedCount++;
    // 基準線の位置（up/down）には常に入れる。座標置きにした瞬間に基準線が動くと、
    // その機器だけが元の高さに残って共通レールから外れ、レールがばらける
    b.up = Math.max(b.up, o.up);
    b.down = Math.max(b.down, o.down);
    // 下のダクトが避けるかどうかは、ダクトがその機器の下を実際に通るときだけ
    if (ductCrosses(o.row + 1, o.x0, o.x1)) b.downDuct = Math.max(b.downDuct, o.down);
  }
}

/**
 * 段（使っているものだけ）を上から積み、横ダクト・縦ダクトを引き、機器の座標を出す。
 * 段の高さ＝基準線の上下に積んだ高さの和。基準線は段の中心ではなく「下に要る高さ」の位置
 * （オフセットした逆側を詰める）。面に入り切らなければ知らせる
 */
export function resolveRows(
  ctx: PackContext,
  buckets: Bucket[],
): { rows: DeviceRow[]; ducts: Duct[]; placed: PlacedDevice[]; violations: Violation[] } {
  const { profile, face, rule, bands } = ctx;
  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;
  const dw = hasDucts ? profile.duct.width : 0;
  // 段と段の間に横ダクトを入れないレイアウトでは、代わりに段間クリアランスを取る
  const rowSpacing = rule.horizontals ? dw : hasDucts ? ctx.c.deviceToDevice.betweenRows : 0;
  const size = faceSize(ctx.panel, face);
  const violations: Violation[] = [];

  const used = buckets.filter((b) => b.entries.length > 0 || b.pinnedCount > 0);
  const rows: DeviceRow[] = [];
  const ducts: Duct[] = [];
  const placed: PlacedDevice[] = [];

  const availableH = size.h - profile.duct.margin.top - profile.duct.margin.bottom;
  const bandW = (i: number) => (dw > 0 ? ductWidth(profile, i) : 0);
  const bucketH = (b: { up: number; down: number }) => b.up + b.down;
  const requiredH =
    used.reduce((s, b) => s + b.up + b.downDuct, 0) +
    (rule.horizontals && dw > 0
      ? Array.from({ length: used.length + 1 }, (_, i) => bandW(i)).reduce((a, b) => a + b, 0)
      : rowSpacing * Math.max(0, used.length - 1));

  /** 横ダクトの左右の範囲（段ごとの左右の余白で短くできる） */
  const ductSpan = (ductIndex: number) => {
    const g = ductGap(profile, ductIndex);
    return { x: g.left, w: size.w - g.left - g.right };
  };
  let id = 0;
  const pushHorizontal = (yAt: number) => {
    const span = ductSpan(id);
    for (const s of splitByBands(bands, span.x, span.w, bandW(id))) {
      ducts.push({ id, x: s.x0, y: yAt, w: s.x1 - s.x0, h: bandW(id) });
    }
    id++;
  };

  let y = size.h - profile.duct.margin.top;
  const top = y;
  used.forEach((b, index) => {
    if (rule.horizontals && dw > 0) {
      y -= bandW(index);
      pushHorizontal(y);
    } else if (index > 0) {
      y -= rowSpacing;
    }
    // 基準線は段の中心ではなく「下に要る高さ」の位置。オフセットした逆側を詰める
    const axisY = y - b.up;
    const row: DeviceRow = { index, y: axisY - b.down, h: bucketH(b), axis: b.down };
    rows.push(row);
    // 次のダクトの上端。下のダクトが通らない座標置きの機器は避けない（downDuct）
    y = axisY - b.downDuct;
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

/**
 * auto モード：段の高さを中身から決める。
 *
 * まず幅だけを見て機器を段に振り分け、段ごとに「一番背の高い機器＋クリアランス」を
 * その段の高さにする。実際の盤は段ごとに高さが違うので、こちらが実物に近い。
 * 段を指定された機器は、幅が空いていなくてもその段に入れる。
 */
export function packAuto(
  panel: PanelSpec,
  face: FaceId,
  profile: Profile,
  queue: Entry[],
  obstacles: Obstacle[] = [],
): { rows: DeviceRow[]; ducts: Duct[]; placed: PlacedDevice[]; violations: Violation[] } {
  const ctx = packContext(panel, face, profile, obstacles);
  const filled = fillBuckets(ctx, queue);
  foldObstacles(ctx, filled.buckets);
  const out = resolveRows(ctx, filled.buckets);
  return { ...out, violations: [...filled.violations, ...out.violations] };
}

// 以下は元の layout.ts から移したもの（buildQueue・packEqual）

/**
 * 配置する順番のキュー。
 *
 * 並べ替えはしない。「＋ で増やした順」がそのまま並び順になる。
 * 図の上で機器をドラッグすると、この順番が入れ替わって配置に反映される。
 */
export function buildQueue(items: LayoutItem[], skip: Set<string>, devices: DeviceLookup): Entry[] {
  return items
    .filter((i) => !skip.has(i.uid))
    .map((i) => {
      const spec = devices.get(i.specId);
      return spec ? { item: i, spec } : null;
    })
    .filter((e): e is Entry => e !== null);
}

/** equal モード：段数と高さは固定で、そこへ機器を詰める。 */
export function packEqual(
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
  const prevSolo = rows.map<number | null>(() => null);
  const prevStopper = rows.map(() => false);

  for (const p of pinned) {
    const spec = devices.get(p.specId);
    if (!spec) continue;
    placed.push(p);
    if (cursor[p.row] !== undefined) {
      cursor[p.row] = Math.max(cursor[p.row]!, p.x + rotatedSize(spec.size, p.rot).w);
      prevRight[p.row] = effectiveClearance(spec, c, rowGap(profile, p.row)).right;
      prevSolo[p.row] = soloMark(spec, p.mount);
      prevStopper[p.row] = isStopper(spec);
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
      // 独立レールの機器は、機器の幅のほかに左右のエンドストッパの場所も要る
      const mySolo = soloMark(spec, item.mount);
      const myEnds = mySolo === null ? 0 : SOLO_RAIL_MARGIN;
      // 止め金具は隣に密着。自分が止め金具でも、直前が止め金具でも、間隔は 0
      const iAmStopper = isStopper(spec);
      const gap =
        iAmStopper || prevStopper[r]
          ? 0
          : horizontalGap(prevRight[r] ?? 0, eff, c, stopperGap(prevSolo[r] ?? null, mySolo));
      const startX = cursor[r] === xMin ? xMin + myEnds : (cursor[r] ?? xMin) + gap;
      const fits = startX + size.w + myEnds <= xMax;
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
        prevSolo[r] = mySolo;
        prevStopper[r] = iAmStopper;
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
