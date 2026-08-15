import { faceSize } from '../data/faces';
import type {
  AreaExclude,
  FaceId,
  FaceWorkArea,
  Machining,
  PanelSpec,
  Rect,
  Violation,
  WorkArea,
} from '../types';

/**
 * 加工有効範囲。
 *
 * メーカーの「加工有効範囲図」（日東工業なら BOX-LASER-〇〇 / BASE-LASER-〇〇）は
 * **模式図で、図中の寸法値どおりに図形が描かれていない**と注記されている。
 * 製品の DXF にもハッチングは入っていない。つまり図から範囲を読み取る道は無い。
 *
 * 一方で中身は「端から 10mm」「扉側だけ 35mm」「ボルトホルダーを避ける」といった
 * 数値の集まりで、しかも W・H・D が変わっても同じ値のことがほとんど。
 * そこで**型式（シリーズ）ごとに1回だけ数値で登録**し、以後は自動で当てる。
 */

/** 面の中で実際に加工できる領域。外枠から除外矩形を引いたもの。 */
export type ResolvedArea = {
  /** 端の入り込みを引いた外枠 */
  rect: Rect;
  /** さらに除く矩形（面の座標・左下原点） */
  excludes: Rect[];
};

/** 除外矩形を面の座標（左下原点）に直す。 */
function placeExclude(e: AreaExclude, size: { w: number; h: number }): Rect {
  const x = e.anchor === 'bottom-left' || e.anchor === 'top-left' ? e.dx : size.w - e.dx - e.w;
  const y = e.anchor === 'bottom-left' || e.anchor === 'bottom-right' ? e.dy : size.h - e.dy - e.h;
  return { x, y, w: e.w, h: e.h };
}

/**
 * その面の加工有効範囲。登録が無ければ null（＝面いっぱい使える。判定しない）。
 *
 * 「登録が無い＝制限なし」にしておくのは、登録前から違反だらけの図になるのを避けるため。
 * 分からないものを禁止扱いにすると、人は表示を無視するようになる。
 */
export function resolveArea(panel: PanelSpec, face: FaceId): ResolvedArea | null {
  const a = panel.workArea?.[face];
  if (!a) return null;
  const size = faceSize(panel, face);
  const rect: Rect = {
    x: a.inset.left,
    y: a.inset.bottom,
    w: size.w - a.inset.left - a.inset.right,
    h: size.h - a.inset.top - a.inset.bottom,
  };
  if (rect.w <= 0 || rect.h <= 0) return null;
  return { rect, excludes: a.excludes.map((e) => placeExclude(e, size)) };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (outer: Rect, r: Rect) =>
  r.x >= outer.x - 0.01 &&
  r.y >= outer.y - 0.01 &&
  r.x + r.w <= outer.x + outer.w + 0.01 &&
  r.y + r.h <= outer.y + outer.h + 0.01;

/** その矩形が加工有効範囲に収まっているか。範囲が未登録なら常に true。 */
export function rectInArea(area: ResolvedArea | null, r: Rect): boolean {
  if (!area) return true;
  if (!inside(area.rect, r)) return false;
  return !area.excludes.some((e) => overlaps(e, r));
}

/** 加工1件が占める矩形。丸穴は外接する四角で見る。 */
export function machiningRect(m: Machining): Rect {
  if (m.kind === 'notch') return { x: m.x - m.w / 2, y: m.y - m.h / 2, w: m.w, h: m.h };
  return { x: m.x - m.dia / 2, y: m.y - m.dia / 2, w: m.dia, h: m.dia };
}

/**
 * 加工有効範囲からはみ出しているものを拾う。
 *
 * 「加工できない場所に穴を出した図」を人が図面上で見つけるのは難しい。
 * 板金屋に出してから断られるのが一番高くつくので、ここで止める。
 */
export function areaViolations(
  panel: PanelSpec,
  face: FaceId,
  cuts: Machining[],
  devices: { uid: string; model: string; rect: Rect }[],
): Violation[] {
  const area = resolveArea(panel, face);
  if (!area) return [];
  const out: Violation[] = [];
  for (const m of cuts) {
    if (rectInArea(area, machiningRect(m))) continue;
    out.push({
      uid: '',
      kind: 'out-of-area',
      message: `加工 X${Math.round(m.x)} Y${Math.round(m.y)} が加工有効範囲の外です`,
    });
  }
  for (const d of devices) {
    if (rectInArea(area, d.rect)) continue;
    out.push({
      uid: d.uid,
      kind: 'out-of-area',
      message: `${d.model}: 加工有効範囲の外に出ています（取付穴を開けられません）`,
    });
  }
  return out;
}

/** 登録済みの面の数。設定画面と面選択の表示に使う。 */
export function areaFaceCount(w: WorkArea | undefined): number {
  return w ? Object.keys(w).length : 0;
}

/** 面いっぱい使える初期値。新しく面を登録するときの出発点。 */
export function blankFaceArea(): FaceWorkArea {
  return { inset: { top: 0, bottom: 0, left: 0, right: 0 }, excludes: [] };
}

/**
 * 日東工業 RA形（片扉）の加工有効範囲。
 *
 * 出どころはメーカーの「加工有効範囲図【レーザー】BOX-LASER-RA-2 / BASE-LASER-3」。
 * あの図は**模式図で寸法値どおりに描かれていない**ので、図形ではなく**数値だけ**を写した。
 *
 * ⚠ そのまま信じずに、案件の納入仕様書と突き合わせてから使うこと。
 *    ここに入れてあるのは「毎回ゼロから打ち込まなくて済む出発点」であって、正解の保証ではない。
 *    ※1 の注記どおり、屋外形はボデー外形が基準（ヨコ W-4 × タテ H-6）になる点も要確認。
 */
export const NITTO_RA_PRESET: WorkArea = {
  // 扉：四辺とも端から 10mm
  door: { inset: { top: 10, bottom: 10, left: 10, right: 10 }, excludes: [] },
  // 側面：扉側の辺だけ 35mm（パッキンと折り返しのぶん）、他は 10mm
  left: { inset: { top: 10, bottom: 10, left: 35, right: 10 }, excludes: [] },
  right: { inset: { top: 10, bottom: 10, left: 10, right: 35 }, excludes: [] },
  // 上下面：奥行き方向の手前側が扉なので 35mm
  top: { inset: { top: 10, bottom: 35, left: 10, right: 10 }, excludes: [] },
  bottom: { inset: { top: 35, bottom: 10, left: 10, right: 10 }, excludes: [] },
  // 背面：四隅のボルトホルダーを避ける
  back: {
    inset: { top: 10, bottom: 10, left: 10, right: 10 },
    excludes: [
      { anchor: 'top-left', dx: 35, dy: 7, w: 64, h: 36, note: 'ボルトホルダー' },
      { anchor: 'top-right', dx: 35, dy: 7, w: 64, h: 36, note: 'ボルトホルダー' },
      { anchor: 'bottom-left', dx: 35, dy: 20, w: 64, h: 36, note: 'ボルトホルダー' },
      { anchor: 'bottom-right', dx: 35, dy: 20, w: 64, h: 36, note: 'ボルトホルダー' },
    ],
  },
  // 中板（鉄製基板3）：外形 W-80 × H-80 に対し、四隅を取付ボルトのぶん角欠き
  plate: {
    inset: { top: 15, bottom: 15, left: 0, right: 0 },
    excludes: [
      { anchor: 'top-left', dx: 0, dy: 0, w: 67, h: 50, note: '取付ボルト' },
      { anchor: 'top-right', dx: 0, dy: 0, w: 67, h: 50, note: '取付ボルト' },
      { anchor: 'bottom-left', dx: 0, dy: 0, w: 67, h: 50, note: '取付ボルト' },
      { anchor: 'bottom-right', dx: 0, dy: 0, w: 67, h: 50, note: '取付ボルト' },
    ],
  },
};
