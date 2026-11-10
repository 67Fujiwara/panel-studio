/**
 * 矢印キーの微調整（機器・横ダクト・縦ダクト・DINレールの端）の「どこまで動かせるか」。
 *
 * 画面（PanelCanvas）とストアはここで出した答えを書くだけにする。
 * どれも純粋な関数なので、機器の組み合わせごとに単体テストで確かめられる。
 */
import { DIN_RAIL_WIDTH } from '../../data/enclosures';
import { faceSize } from '../../data/faces';
import { rotatedSize, rowAxisY } from '../../types';
import type { DeviceRow, DeviceSpec, Duct, DuctGap, FaceId, LayoutResult, PanelSpec, PlacedDevice, Profile } from '../../types';
import { HEAT_THRESHOLD_W, SAME_AXIS_MM } from './constants';
import { vertBandOf } from './ducts';
import type { RailRun } from './rails';
import type { DeviceLookup } from './types';

export type Size = { w: number; h: number };

/**
 * その高さに置いた DIN 機器が、段の共通レール（基準線）に乗っているか。
 * 「レールに乗ったまま」の判定はここ 1 か所。矢印キー・ドラッグ・レール計算が同じ答えを出す
 */
export function isOnRowRail(y: number, spec: DeviceSpec, rot: PlacedDevice['rot'], row: DeviceRow): boolean {
  const axis = y + rotatedSize(spec.size, rot).h / 2 - (spec.dinOffset ?? 0);
  return Math.abs(axis - rowAxisY(row)) <= SAME_AXIS_MM;
}

/** 面の中に収める（左下角の座標） */
export function clampToFace(x: number, y: number, size: Size, face: Size): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(face.w - size.w, x)),
    y: Math.max(0, Math.min(face.h - size.h, y)),
  };
}

/**
 * その高さに置いた DIN 機器のレール中心が、どの段のレールの帯（35mm）に掛かるか。
 * 掛かるなら、その段のレールに乗せたときの y を返す。
 *
 * DIN 機器はレールのクリップで付くので、レールから 1mm 浮かせることはできない。
 * 帯に掛かる高さに置かれたら、その段のレールの高さに吸い付かせる。
 * 以前は 1mm 上へ動かしただけで「独立レール」になり、その独立レールが段の共通レールを
 * 切り刻んで隣の機器のレールが消えていた
 */
export function snapToRowRail(
  layout: LayoutResult,
  spec: DeviceSpec,
  rot: PlacedDevice['rot'],
  y: number,
): { row: DeviceRow; y: number } | null {
  const h = rotatedSize(spec.size, rot).h;
  const off = spec.dinOffset ?? 0;
  const axis = y + h / 2 - off;
  let best: { row: DeviceRow; d: number } | null = null;
  for (const row of layout.rows) {
    const d = Math.abs(rowAxisY(row) - axis);
    if (d < DIN_RAIL_WIDTH / 2 && (!best || d < best.d)) best = { row, d };
  }
  if (!best) return null;
  return { row: best.row, y: rowAxisY(best.row) - h / 2 + off };
}

/**
 * 座標で置くときの印の付け方。置いた高さが段のレールの帯に掛かるなら、その段のレールの
 * 高さに吸い付かせて「レールに乗ったまま」（onRail）。印があるものは、ダクトの余白を変えて
 * 段が動いてもレールに付いていく。帯から外れた高さに置いたものは印なし（その高さに留まり、独立レールになる）
 */
export function pinnedAt(
  layout: LayoutResult,
  devices: DeviceLookup,
  p: PlacedDevice,
  x: number,
  y: number,
): PlacedDevice {
  const spec = devices.get(p.specId);
  if (!spec || p.mount !== 'din') return { ...p, x, y, onRail: false, pinned: true };
  const snap = snapToRowRail(layout, spec, p.rot, y);
  if (!snap) return { ...p, x, y, onRail: false, pinned: true };
  return { ...p, x, y: snap.y, row: snap.row.index, onRail: true, pinned: true };
}

export type DeviceNudge = { placed: PlacedDevice; note: string | null };

/**
 * 機器の矢印キー。1mm（Shift で 10mm）動かし、面の外へは出さない。
 * 動かした時点で座標置きになる。左右に寄せただけなら段のレールに乗ったまま。
 * DIN 機器を上下に動かしてもレールの帯の中なら元の高さに戻り、理由を返す
 */
export function nudgeDevice(
  layout: LayoutResult,
  devices: DeviceLookup,
  face: Size,
  p: PlacedDevice,
  dx: number,
  dy: number,
): DeviceNudge | null {
  const spec = devices.get(p.specId);
  if (!spec) return null;
  const size = rotatedSize(spec.size, p.rot);
  const { x, y } = clampToFace(p.x + dx, p.y + dy, size, face);
  const placed = pinnedAt(layout, devices, p, x, y);
  const note =
    dy !== 0 && placed.onRail && Math.abs(placed.y - p.y) < 1e-6
      ? `${spec.model} は DINレール取付なので、レールの高さから外せません。別の段へ移すにはドラッグで入れ込むか、Shift＋ドラッグで離れた場所へ置いてください（独立レールになります）`
      : null;
  return { placed, note };
}

// ---------------------------------------------------------------------------
// 横ダクト
// ---------------------------------------------------------------------------

export type DuctNudgePlan = {
  /** 書き換える余白（無ければ動かせなかった） */
  patch: Partial<DuctGap> | null;
  /** 動かせなかった理由。動かせたときは null */
  note: string | null;
};

/**
 * 横ダクト 1 本の矢印キー。
 * - ←→: 左右の余白を同時に動かして全体をずらす（面の外へは出さない）
 * - ↑↓: 「上の余白」を削って「下の余白」に足す（逆も）。下の段は動かない。
 *   余白は**下限**で、実際に効くのは max(余白, その段の機器のメーカー指定の最小離隔・発熱の追加離隔)。
 *   余白をその値より小さくしてもダクトは動かないので、動かせるのは余白がその値を上回っている分だけ。
 *   効いている値を基準に付け替える（15 のまま離隔 30 が効いていたダクトを 1mm 下げると、上の余白は 31 になる）
 * - `edge: 'bottom'`（最下段のダクト）は下に段が無いので上の余白だけ動かす
 */
export function planDuctNudge(
  profile: Profile,
  layout: LayoutResult,
  devices: DeviceLookup,
  target: number,
  dx: number,
  dy: number,
  edge?: 'bottom',
): DuctNudgePlan {
  const duct = profile.duct;
  const cur = duct.ductGaps?.[target] ?? {};
  const left = cur.left ?? duct.margin.left;
  const right = cur.right ?? duct.margin.right;
  const shift = Math.max(-left, Math.min(right, dx));

  const above = cur.above ?? profile.clearance.deviceToDuct.bottom;
  const below = cur.below ?? profile.clearance.deviceToDuct.top;
  let up = 0;
  let effAbove = above;
  let effBelow = below;
  let note: string | null = null;
  if (dy) {
    const over = clearanceDemand(layout, devices, profile, target - 1, 'bottom');
    const under = clearanceDemand(layout, devices, profile, target, 'top');
    const upMax = Math.max(0, above - over.v);
    const downMax = edge === 'bottom' ? Infinity : Math.max(0, below - under.v);
    up = Math.max(-downMax, Math.min(upMax, dy));
    effAbove = Math.max(above, over.v);
    effBelow = Math.max(below, under.v);
    const no = `ダクト ${target + 1} 本目`;
    if (dy > 0 && !up) {
      note =
        over.v > 0 && over.v >= above
          ? `${no}はこれ以上上へ動かせません。上の段の ${over.model} のメーカー指定の最小離隔（下 ${over.v}mm）が効いています。部品編集で離隔を直すか、その機器を動かしてください`
          : `${no}はこれ以上上へ動かせません（上の余白が 0 です）`;
    } else if (dy < 0 && !up) {
      note =
        under.v > 0 && under.v >= below
          ? `${no}はこれ以上下へ動かせません。下の段の ${under.model} のメーカー指定の最小離隔（上 ${under.v}mm）が効いています。部品編集で離隔を直すか、その機器を動かしてください`
          : `${no}はこれ以上下へ動かせません（下の余白が 0 です）`;
    }
  }
  if (!shift && !up) return { patch: null, note };
  return {
    patch: {
      ...(shift ? { left: left + shift, right: right - shift } : {}),
      ...(up ? { above: effAbove - up, ...(edge === 'bottom' ? {} : { below: effBelow + up }) } : {}),
    },
    note: null,
  };
}

/** その段の機器が求める最小離隔（メーカー指定・発熱）のいちばん大きいものと、その機器 */
export function clearanceDemand(
  layout: LayoutResult,
  devices: DeviceLookup,
  profile: Profile,
  row: number,
  side: 'top' | 'bottom',
): { v: number; model: string } {
  let best = { v: 0, model: '' };
  for (const p of layout.placed) {
    if (p.row !== row) continue;
    const spec = devices.get(p.specId);
    if (!spec) continue;
    const heat = (spec.heatW ?? 0) >= HEAT_THRESHOLD_W ? profile.clearance.heatExtra : 0;
    const v = Math.max(spec.clearance?.[side] ?? 0, heat);
    if (v > best.v) best = { v, model: spec.model };
  }
  return best;
}

/**
 * 図の上で選んだダクトと押したキーから、ダクトの微調整に渡す値を決める。
 * - いちばん上のダクト（id 0）は面の上端で決まるので上下には動かない
 * - 段の高さ「全段そろえる」は段の高さが固定なので、横ダクトの上下は動かない
 * - 最下段は消したダクトも含めて決める（消してもその下に段は無いので）
 */
export function ductKeyMove(
  layout: LayoutResult,
  profile: Profile,
  d: Duct,
  dx: number,
  dy: number,
): { target: number | { vert: number }; dx: number; dy: number; edge?: 'bottom' } {
  if (d.vert !== undefined) return { target: { vert: d.vert }, dx, dy: 0 };
  const lastId = Math.max(...layout.ducts.filter((q) => q.vert === undefined).map((q) => q.id));
  const movable = d.id !== 0 && profile.duct.rowHeightMode !== 'equal';
  return { target: d.id, dx, dy: movable ? dy : 0, edge: d.id === lastId ? 'bottom' : undefined };
}

/**
 * 縦ダクトの ←→。帯ごとずらす。面の外へ出る分は溜めない（戻すときに空振りしないように）
 */
export function planVertNudge(panel: PanelSpec, face: FaceId, profile: Profile, v: number, dx: number): number {
  if (!dx) return 0;
  const band = vertBandOf(panel, face, profile, v);
  const w = faceSize(panel, face).w;
  const step = band ? Math.max(-band.x0, Math.min(w - band.x1, dx)) : dx;
  return step || 0; // -0 を 0 に

}

// ---------------------------------------------------------------------------
// DINレールの端
// ---------------------------------------------------------------------------

export type RailNudgePlan = {
  /** 控えに足す量。外へ伸ばす向きが＋。0 なら動かせなかった */
  delta: number;
  note: string | null;
};

/**
 * レールの端の矢印キー。左端は x、右端は x+length を動かす。
 * 縮めるのは機器の端まで、伸ばすのはダクト・直付け機器・独立レール・面の端まで。
 * 上下はその段のダクトで決まるので動かさず、案内だけ返す
 */
export function planRailNudge(r: RailRun, end: 'left' | 'right', dx: number, dy: number, faceW: number): RailNudgePlan {
  const no = `DINレール ${r.row + 1} 段目`;
  const side = end === 'left' ? '左端' : '右端';
  if (dy) return { delta: 0, note: `${no}の上下は段のダクトで決まります。ダクトを選んで ↑↓ で動かしてください` };
  if (!r.bounds) return { delta: 0, note: null };
  const b = end === 'left' ? r.bounds.left : r.bounds.right;
  const cur = end === 'left' ? r.x : r.x + r.length;
  const next = Math.max(Math.max(0, b.min), Math.min(Math.min(faceW, b.max), cur + dx));
  const moved = next - cur;
  if (!moved) {
    const outward = end === 'left' ? dx < 0 : dx > 0;
    return {
      delta: 0,
      note: outward
        ? `${no}の${side}はこれ以上伸ばせません（ダクト・直付け機器・独立レール・面の端に当たります）`
        : `${no}の${side}は機器より内側へは縮められません`,
    };
  }
  // 控えは「外へ伸ばす向きが＋」。左端は左へ動くほど＋
  return { delta: end === 'left' ? -moved : moved, note: null };
}
