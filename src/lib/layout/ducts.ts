/** ダクトのレイアウト規則、縦ダクトの帯、段の区画、equal モードの段割り。 */
import { FACE_BY_ID, faceSize } from '../../data/faces';
import type { DeviceRow, Duct, DuctLayoutId, FaceId, PanelSpec, Profile } from '../../types';
import { ductGap, ductWidth, rowGap, vertWidth } from './clearance';
import type { Segment, VertBand } from './types';

/**
 * レイアウトごとの決まりごと。
 *
 * ダクトの引き方の違いは、結局のところ
 *  - 縦ダクトをどこに立てるか
 *  - 段と段の間に横ダクトを入れるか
 *  - 機器をどの区画に流し込むか
 * の3つに落ちる。ここで表にしておき、詰め込みの処理は共通にする。
 */
export type LayoutRule = {
  /** 縦ダクトの位置。面の幅に対する比で持つ（0=左端, 0.5=中央, 1=右端） */
  verticals: number[];
  /** 段と段の間に横ダクトを入れるか */
  horizontals: boolean;
  /** 区画を機能で分ける（動力＝左／制御＝右） */
  zoned?: boolean;
  /** 端子台を必ず最下段に置く */
  terminalLast?: boolean;
};

export const LAYOUT_RULES: Record<DuctLayoutId, LayoutRule> = {
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
export const POWER_CATEGORIES = new Set(['breaker', 'contactor']);

/**
 * その段の使える X 範囲（余白と端クリアランスの大きいほうを採る）。
 * 段ごとに左右の余白を変えられるので、段番号で変わる。
 */
export function usableX(panel: PanelSpec, face: FaceId, profile: Profile, rowIndex: number) {
  const c = profile.clearance;
  const g = rowGap(profile, rowIndex);
  return {
    xMin: Math.max(g.left, c.deviceToPlateEdge),
    xMax: faceSize(panel, face).w - Math.max(g.right, c.deviceToPlateEdge),
  };
}

/**
 * 縦ダクトの帯。面の幅に対する比から実際の位置に直す。
 * 端に立てる縦ダクトは面からはみ出さないよう内側に寄せる。
 * 太さは1本ずつ違うことがあるので、帯ごとに引く。
 */
export function verticalBands(panel: PanelSpec, face: FaceId, profile: Profile): VertBand[] {
  const rule = LAYOUT_RULES[profile.duct.layout];
  if (!FACE_BY_ID.get(face)?.ducts) return [];
  const { w } = faceSize(panel, face);
  const m = profile.duct.margin;
  return rule.verticals.map((t, v) => {
    const dw = vertWidth(profile, v);
    // 矢印キーの微調整（dx）で左右へずらせる。帯ごと動かすので機器はよけ直し、
    // 横ダクトもずれた位置で切れる。面の外へは出さない
    const base = t === 0 ? m.left + dw / 2 : t === 1 ? w - m.right - dw / 2 : w * t;
    const center = Math.max(dw / 2, Math.min(w - dw / 2, base + (profile.duct.vertGaps?.[v]?.dx ?? 0)));
    return { x0: center - dw / 2, x1: center + dw / 2, v };
  });
}

/**
 * 縦ダクト v の帯（矢印キーのずらし込み・面の内側に収めた後）。
 * 図の上の微調整で、面の外へ出る分をずらし値に溜めないために使う。
 */
export function vertBandOf(
  panel: PanelSpec,
  face: FaceId,
  profile: Profile,
  v: number,
): { x0: number; x1: number } | undefined {
  return verticalBands(panel, face, profile).find((b) => b.v === v);
}

/** その段で機器を置ける X 区画。縦ダクトで分断された残りを左から順に返す。 */
export function rowSegments(
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
export function splitByBands(bands: Segment[], x: number, w: number, minW = 1): Segment[] {
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
  // 切れ端が細すぎるものは実物として成り立たないので落とす。
  // 端の縦ダクトを矢印キーで内側へ寄せたときに、その外側へできる数 mm の切れ端もここで消える
  return parts.filter((s) => s.x1 - s.x0 >= Math.max(1, minW));
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
    for (const p of splitByBands(bands, s.x, s.w, bandW(id))) {
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
