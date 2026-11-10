/** 離隔・寸法・段の余白といった、配置の「決めごと」の計算。画面を持たない純粋な関数。 */
import { DIN_RAIL_HEIGHT, DIN_RAIL_WIDTH } from '../../data/enclosures';
import { ductWidthOf, isRailMount, rotatedSize, rowAxisY, vertWidthOf } from '../../types';
import type { ClearanceSettings, DeviceRow, DeviceSpec, MountType, PanelSpec, Profile, Rotation, Sides } from '../../types';
import { HEAT_THRESHOLD_W, SOLO_RAIL_MARGIN } from './constants';
import type { Entry } from './types';

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
    /*
     * 機器を置ける幅は**面の余白**で決める。ダクト 1 本ごとの左右は、そのダクトを短くするだけで
     * 段の幅には効かせない。以前は上のダクトの左右に合わせていたため、ダクトを短くすると
     * その先に並んだ機器が「横幅が足りません」（赤枠）になっていた。ダクトを短くするのは
     * 端に別のものを置く・配線が要らない、といった理由で、機器を置けなくしたいわけではない
     */
    left: profile.duct.margin.left,
    right: profile.duct.margin.right,
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
 * 止め金具（エンドストッパ）か。
 *
 * 止め金具は機器をレール上で止めるためのクリップで、機器の**すぐ隣に密着**して付く。
 * 離隔（メーカー指定・機器⇔機器のクリアランス）は機器どうしの空気なので、
 * 止め金具にはどちらも効かせない。部品の印（stopper）が無ければ名前で見分ける。
 */
export function isStopper(spec: DeviceSpec): boolean {
  if (spec.stopper !== undefined) return spec.stopper;
  return /ストッパ|止め金具|stopper|CLIPFIX/i.test(`${spec.name} ${spec.model}`);
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

/** その1台の見かけの寸法。向きが 90/270 なら幅と高さが入れ替わる。 */
export const sizeOf = (e: Entry) => rotatedSize(e.spec.size, e.item.rot);

/**
 * その1台が段の中で縦に占める高さ。**段の高さが固定のとき（equal モード）専用。**
 *
 * equal では基準線が段の中心に固定されるので、dinOffset でずらしても段からはみ出さない
 * には、オフセットの絶対値の2倍ぶん段が高くなければ成り立たない（中央基準のずらしのため
 * 両側に要る）。auto モードは基準線を動かせるので vertSpan を使う。
 */
export function vertNeed(spec: DeviceSpec, mount: MountType, rot?: Rotation): number {
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
export function vertSpan(spec: DeviceSpec, mount: MountType, rot: Rotation | undefined, eff: Sides) {
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

/** 機器同士の水平方向の間隔。 */
/**
 * 隣との間隔。`stopper` は独立レールのエンドストッパの場所（stopperGap の値）。
 *
 * - 機器⇔機器のクリアランス（全体設定）には**足す**。あれは「機器と機器の間の空気」
 *   なので、ストッパの場所を含めると隣に重なる
 * - メーカー指定の最小離隔（部品ごと）には**足さない**。ストッパはその離隔の中に
 *   入れて、機器のすぐ隣に置く。離隔は機器どうしの間に要る空気で、ストッパは
 *   レールに付く小さなクリップなので、離隔の内側に居てよい。
 *   （離隔 20mm の機器に 5mm を上乗せして 25mm 空けるのが「離隔が無効にならない」
 *   と言われたところ）
 */
export function horizontalGap(prevRight: number, eff: Sides, c: ClearanceSettings, stopper = 0) {
  return Math.max(prevRight, eff.left, c.deviceToDevice.sameRow + stopper);
}

/**
 * 独立DINレールの機器を見分ける印。レールの高さ（＝dinOffset）まで持つ。
 * レールに乗らない機器は null。
 */
export function soloMark(spec: DeviceSpec, mount: MountType): number | null {
  return mount === 'din-solo' ? (spec.dinOffset ?? 0) : null;
}

/**
 * 隣どうしのあいだに、**エンドストッパの場所として**要る幅(mm)。
 *
 * 5mm は「物が乗る場所」であって離隔（空気）ではない。機器⇔機器のクリアランスに
 * 含めて max で潰すと、**ストッパが隣の機器に重なる**（クリアランス 0 なら丸ごと重なる）。
 * なのでクリアランスとは別に、足し込む。
 *
 * ただし隣どうしが**同じ高さの独立レール**なら1本につながり、あいだにストッパは
 * 入らない（BOM でも 2個で数えている）ので 0。高さが違えば別々の1本なので両側に要る。
 */
export function stopperGap(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 0;
  if (prev !== null && next !== null && prev === next) return 0;
  return (prev === null ? 0 : SOLO_RAIL_MARGIN) + (next === null ? 0 : SOLO_RAIL_MARGIN);
}

/**
 * 段の中での上下位置。**段の基準線（レール中心）に中心を合わせ**、
 * DINレール取付なら部品ごとのオフセットぶんだけずらす。
 * 基準線の指定が無い段（equal モード）では段の中心が基準線になる。
 */
export function placeY(row: DeviceRow, spec: DeviceSpec, mount: MountType, rot?: Rotation) {
  const offset = mount === 'din' ? (spec.dinOffset ?? 0) : 0;
  return rowAxisY(row) - rotatedSize(spec.size, rot).h / 2 + offset;
}
