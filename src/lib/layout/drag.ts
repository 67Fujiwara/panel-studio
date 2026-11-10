/**
 * ドラッグの判定。ポインタの位置（面の座標）と配置から「何をするか」を決める。
 *
 * 画面（PanelCanvas）はポインタを面の座標に直してここへ渡し、返った決定を書くだけにする。
 * 判定の種類:
 *  - pin      : 座標で置く（Shift ドラッグ、止め金具の密着、独立レールへの吸い付き、空いた場所への座標置き）
 *  - unpin    : 吸い付きから離れたので段の流れへ戻す
 *  - reorder  : 他の機器の間へ入れ込む（並べ替え）
 */
import { rotatedSize, rowAxisY } from '../../types';
import type { LayoutResult, PlacedDevice, Profile } from '../../types';
import { isStopper } from './clearance';
import { JOIN_DIST, SNAP_RAIL, SOLO_RAIL_MARGIN } from './constants';
import { pinnedAt, type Size } from './nudge';
import { independentRails } from './rails';
import type { DeviceLookup } from './types';
import { LAYOUT_RULES } from './ducts';
import { isRailMount } from '../../types';

export type DragContext = {
  layout: LayoutResult;
  devices: DeviceLookup;
  profile: Profile;
  face: Size;
  /** 段割り（ダクトで区切られた行）のある面か。扉・側面は座標で置く面 */
  hasRows: boolean;
};

/** ドラッグ中の 1 台 */
export type Dragged = {
  placed: PlacedDevice;
  size: Size;
  /** いまのポインタ位置に対応する左下角（5mm スナップ・面の中に収めたあと） */
  x: number;
  y: number;
  /** ポインタそのものの面の座標（段の判定に使う） */
  cursor: { x: number; y: number };
};

export type DragDecision =
  | { kind: 'pin'; placed: PlacedDevice; snapped: boolean }
  | { kind: 'unpin' }
  | { kind: 'reorder'; row: number; before: string | null; zone: number | undefined };

const overlapsDuct = (ctx: DragContext, x: number, y: number, size: Size) =>
  ctx.layout.ducts.some((dd) => !dd.removed && x < dd.x + dd.w && dd.x < x + size.w && y < dd.y + dd.h && dd.y < y + size.h);

/**
 * 手動配置（Shift ドラッグ）でダクトの上に落とさないよう、近い側へ避ける。
 * 横ダクトは上下へ、縦ダクトは左右へ、近いほうへ押し出す。
 * 押し出した先が別のダクトに掛かる（段の隙間が機器より狭い）ときはあきらめてそのまま置き、
 * チェック（ダクト干渉）に任せる
 */
export function dodgeDucts(ctx: DragContext, x: number, y: number, size: Size): { x: number; y: number } {
  const live = ctx.layout.ducts.filter((dd) => !dd.removed);
  let nx = x;
  let ny = y;
  for (let pass = 0; pass < 3; pass++) {
    const hit = live.find((dd) => nx < dd.x + dd.w && dd.x < nx + size.w && ny < dd.y + dd.h && dd.y < ny + size.h);
    if (!hit) return { x: nx, y: ny };
    if (hit.w >= hit.h) {
      ny = ny + size.h / 2 > hit.y + hit.h / 2 ? hit.y + hit.h : hit.y - size.h;
      ny = Math.max(0, Math.min(ctx.face.h - size.h, ny));
    } else {
      nx = nx + size.w / 2 > hit.x + hit.w / 2 ? hit.x + hit.w : hit.x - size.w;
      nx = Math.max(0, Math.min(ctx.face.w - size.w, nx));
    }
  }
  return overlapsDuct(ctx, nx, ny, size) ? { x, y } : { x: nx, y: ny };
}

/** 機器の dinOffset（直付けなら 0） */
function offsetOf(ctx: DragContext, p: PlacedDevice): number {
  const spec = ctx.devices.get(p.specId);
  return p.mount === 'direct' ? 0 : (spec?.dinOffset ?? 0);
}

/**
 * 独立DINレールの上へ持っていったら、その並びに吸い付かせる。
 * 縦はレールの中心が揃う位置へ、横はレールの端に自分のレールの余長ぶんだけ空けて付ける。
 * 吸い付く先は**自分を抜いて**数える（自分のレールを相手にすると付いたり離れたりを繰り返す）
 */
export function snapToSoloRails(ctx: DragContext, d: Dragged): { x: number; y: number } | null {
  const targets = independentRails(ctx.layout, ctx.devices, d.placed.uid).filter((r) => r.length > 0);
  if (targets.length === 0) return null;
  const off = offsetOf(ctx, d.placed);
  const myRailY = d.y + d.size.h / 2 - off;
  let best: { dist: number; x: number; y: number } | null = null;
  for (const r of targets) {
    if (Math.abs(r.y - myRailY) > SNAP_RAIL) continue;
    const ny = r.y - d.size.h / 2 + off;
    for (const nx of [r.x + r.length + SOLO_RAIL_MARGIN, r.x - SOLO_RAIL_MARGIN - d.size.w]) {
      const dist = Math.abs(nx - d.x);
      if (dist > SNAP_RAIL) continue;
      if (!best || dist < best.dist) best = { dist, x: nx, y: ny };
    }
  }
  if (!best) return null;
  const cx = Math.max(0, Math.min(ctx.face.w - d.size.w, best.x));
  const cy = Math.max(0, Math.min(ctx.face.h - d.size.h, best.y));
  // 吸い付いた先がダクトに掛かるなら、吸着はあきらめる
  return overlapsDuct(ctx, cx, cy, d.size) ? null : { x: cx, y: cy };
}

/**
 * 止め金具（エンドストッパ）を機器の横へ持っていったら、その機器に**密着**させる。
 * 離隔は効かせず、レールの高さも相手に揃える
 */
export function snapStopperToDevice(ctx: DragContext, d: Dragged): { x: number; y: number } | null {
  const off = offsetOf(ctx, d.placed);
  const myRailY = d.y + d.size.h / 2 - off;
  let best: { dist: number; x: number; y: number } | null = null;
  for (const q of ctx.layout.placed) {
    if (q.uid === d.placed.uid) continue;
    const qs = ctx.devices.get(q.specId);
    if (!qs || isStopper(qs)) continue;
    const qsize = rotatedSize(qs.size, q.rot);
    const qRailY = q.y + qsize.h / 2 - offsetOf(ctx, q);
    if (Math.abs(qRailY - myRailY) > SNAP_RAIL) continue;
    const ny = qRailY - d.size.h / 2 + off;
    for (const nx of [q.x + qsize.w, q.x - d.size.w]) {
      const dist = Math.abs(nx - d.x);
      if (dist > SNAP_RAIL) continue;
      if (!best || dist < best.dist) best = { dist, x: nx, y: ny };
    }
  }
  if (!best) return null;
  return {
    x: Math.max(0, Math.min(ctx.face.w - d.size.w, best.x)),
    y: Math.max(0, Math.min(ctx.face.h - d.size.h, best.y)),
  };
}

/** ポインタにいちばん近い段 */
export function nearestRow(ctx: DragContext, cursorY: number) {
  const rows = ctx.layout.rows;
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (Math.abs(cursorY - (r.y + r.h / 2)) < Math.abs(cursorY - (best.y + best.h / 2)) ? r : best));
}

/**
 * ドラッグ中の DIN 機器を、いちばん近い段のレールの x に置いたとき誰とも干渉しないか。
 * 干渉しなければその置き場（左下角と段番号）を返す。
 * 隣の機器の**近く**（JOIN_DIST 以内）なら「横に並べたい」と読んで null（並べ替えに回す）。
 * ぴったり重ねないと並ばない、では、端子台の横へ持っていったのに 5mm スナップのぶん隙間が空いて座標置きになる
 */
export function freeSpotOnRail(ctx: DragContext, d: Dragged): { x: number; y: number; row: number } | null {
  const spec = ctx.devices.get(d.placed.specId);
  const row = nearestRow(ctx, d.cursor.y);
  if (!spec || !row) return null;
  const y = rowAxisY(row) - d.size.h / 2 + (spec.dinOffset ?? 0);
  const nx = Math.max(0, Math.min(ctx.face.w - d.size.w, d.x));
  const gap = ctx.profile.clearance.deviceToDevice.sameRow;
  const x0 = nx - gap - JOIN_DIST;
  const x1 = nx + d.size.w + gap + JOIN_DIST;
  const y0 = y;
  const y1 = y + d.size.h;
  for (const q of ctx.layout.placed) {
    if (q.uid === d.placed.uid) continue;
    const qs = ctx.devices.get(q.specId);
    if (!qs) continue;
    const s = rotatedSize(qs.size, q.rot);
    const sameRow = q.row === row.index || (q.y < y1 && y0 < q.y + s.h);
    if (sameRow && q.x < x1 && x0 < q.x + s.w) return null;
  }
  if (overlapsDuct(ctx, nx, y, d.size)) return null;
  return { x: nx, y, row: row.index };
}

/**
 * 並べ替えの入れ込み先。いちばん近い段と「どの機器の直前に入れるか」、ゾーン分割なら区画。
 * 段は中心までの距離がいちばん短いもの。ダクトの上で放しても 1 段目へ飛ばない
 */
export function dropTarget(ctx: DragContext, cursor: { x: number; y: number }, dragUid: string): { row: number; before: string | null; zone: number | undefined } {
  const row = nearestRow(ctx, cursor.y);
  const targetRow = row ? row.index : 0;
  const others = ctx.layout.placed.filter((p) => p.uid !== dragUid).sort((a, b) => a.row - b.row || a.x - b.x);
  const before = others.find((p) => {
    const spec = ctx.devices.get(p.specId);
    const w = spec ? rotatedSize(spec.size, p.rot).w : 0;
    return p.row > targetRow || (p.row === targetRow && cursor.x < p.x + w / 2);
  });
  let zone: number | undefined;
  if (LAYOUT_RULES[ctx.profile.duct.layout].zoned) {
    const vducts = ctx.layout.ducts.filter((dd) => !dd.removed && dd.h > dd.w).sort((a, b) => a.x - b.x);
    if (vducts.length > 0) zone = vducts.filter((dd) => dd.x + dd.w / 2 < cursor.x).length;
  }
  return { row: targetRow, before: before?.uid ?? null, zone };
}

/**
 * ドラッグ 1 コマの決定。
 * @param free  Shift ドラッグ（座標を自由に決める）か、段の無い面の座標置きか
 * @param snapped 直前のコマで吸い付いていたか（離れたら段の流れへ戻す）
 */
export function decideDrag(ctx: DragContext, d: Dragged, free: boolean, snapped: boolean): DragDecision {
  const spec = ctx.devices.get(d.placed.specId);
  const stopper = spec ? isStopper(spec) : false;
  if (free) {
    const dodged = dodgeDucts(ctx, d.x, d.y, d.size);
    const at = { ...d, x: dodged.x, y: dodged.y };
    const snap = (stopper ? snapStopperToDevice(ctx, at) : null) ?? snapToSoloRails(ctx, at) ?? dodged;
    return { kind: 'pin', placed: pinnedAt(ctx.layout, ctx.devices, d.placed, snap.x, snap.y), snapped: false };
  }
  // 止め金具は、ふつうのドラッグでも機器の横へ近づけたらそこへ密着させる（狙った機器のどちら側かを目で決められる）
  if (stopper) {
    const s = snapStopperToDevice(ctx, d);
    if (s) return { kind: 'pin', placed: pinnedAt(ctx.layout, ctx.devices, d.placed, s.x, s.y), snapped: true };
  }
  // 独立レールの上へ持っていったらそこに並べる（段に残すと共通レールがそこまで引き伸ばされる）
  if (isRailMount(d.placed.mount)) {
    const s = snapToSoloRails(ctx, d);
    if (s) return { kind: 'pin', placed: pinnedAt(ctx.layout, ctx.devices, d.placed, s.x, s.y), snapped: true };
  }
  if (snapped) return { kind: 'unpin' };
  // 誰とも干渉しない空いた場所なら、その段のレールのその位置に座標置き（レールに乗ったまま）
  if (d.placed.mount === 'din' && ctx.hasRows) {
    const spot = freeSpotOnRail(ctx, d);
    if (spot) {
      return { kind: 'pin', placed: { ...d.placed, x: spot.x, y: spot.y, row: spot.row, pinned: true, onRail: true }, snapped: false };
    }
  }
  return { kind: 'reorder', ...dropTarget(ctx, d.cursor, d.placed.uid) };
}
