/**
 * 配置計算の入口。
 *
 * 中身は目的ごとに分けてある:
 *  - clearance.ts  離隔・寸法・段の余白の決めごと
 *  - ducts.ts      ダクトのレイアウト規則・縦ダクトの帯・段の区画
 *  - pack.ts       段への流し込み（枠を作る → 置き場所を探す → 段とダクトを決める）
 *  - push.ts       段を上のダクトの手前まで詰める
 *  - rails.ts      DINレール（共通レール・独立レール・手直し）
 *  - checks.ts     重なり・干渉・スロット・奥行きの検査
 * 他のファイルからは今までどおり '../lib/layout' を import する。
 */
import { faceSize, FACE_BY_ID } from '../../data/faces';
import { hasTapCuts, rotatedSize } from '../../types';
import type { FaceId, LayoutResult, PanelSpec, PlacedDevice, Profile } from '../../types';
import { effectiveClearance, isStopper, placeY, rowGap, vertSpan } from './clearance';
import { buildQueue, packAuto, packEqual } from './pack';
import { pushRowsUp } from './push';
import { baseUnitViolations, depthViolations, detectOverlaps, ductOverlaps, railOverlaps } from './checks';
import { computeRails } from './rails';
import type { DeviceLookup, LayoutItem, Obstacle } from './types';

export type { DeviceLookup, LayoutItem, Segment, VertBand } from './types';
export type { RailRun } from './rails';
export { HEAT_THRESHOLD_W, RAIL_END_MARGIN, SOLO_RAIL_MARGIN } from './constants';
export {
  deviceProjection,
  ductGap,
  ductWidth,
  effectiveClearance,
  effectiveDepth,
  isStopper,
  rowGap,
  vertWidth,
} from './clearance';
export { computeRows, vertBandOf } from './ducts';
export { computeRails, independentRails, rowOfPinnedRail } from './rails';
export {
  clearanceDemand,
  ductKeyMove,
  isOnRowRail,
  nudgeDevice,
  pinnedAt,
  planDuctNudge,
  planRailNudge,
  planVertNudge,
} from './nudge';
export type { DuctNudgePlan, RailNudgePlan } from './nudge';
export { decideDrag, dodgeDucts, dropTarget, freeSpotOnRail, snapStopperToDevice, snapToSoloRails } from './drag';
export type { DragContext, DragDecision, Dragged } from './drag';

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

  /*
   * 座標で置いた機器のうち段の番号を持つもの（矢印キーで寄せた1台など）は、
   * その段の流し込みが避ける場所として渡す。避けないと、寄せた跡へ隣が詰まってきて重なる
   */
  const obstacles: Obstacle[] = pinned.flatMap((p) => {
    const spec = devices.get(p.specId);
    if (!spec || p.row === undefined || p.row < 0) return [];
    // 段の高さに入れるぶん。流し込みの機器と同じ計算（基準線の上下＋離隔）
    const need = vertSpan(spec, p.mount, p.rot, effectiveClearance(spec, profile.clearance, rowGap(profile, p.row)));
    return [
      {
        row: p.row,
        x0: p.x,
        x1: p.x + rotatedSize(spec.size, p.rot).w,
        stopper: isStopper(spec),
        up: need.up,
        down: need.down,
      },
    ];
  });
  const auto = profile.duct.rowHeightMode === 'auto';
  const result = auto
    ? packAuto(panel, face, profile, queue, obstacles)
    : packEqual(panel, face, profile, queue, pinned, devices);

  // auto モードでは段の高さを中身から決めるため、手動配置した機器は
  // 段の割り付けに参加させず、置かれた座標のまま残す。干渉は重なり検出で拾う。
  // 外側／内側と「他の面にも出す」は配置には関わらないので、items から写すだけ
  const extra = new Map(faceItems.map((i) => [i.uid, i]));
  const rowByIndex = new Map(result.rows.map((r) => [r.index, r]));
  const placed = (auto ? [...pinned, ...result.placed] : result.placed).map((p) => {
    const it = extra.get(p.uid);
    // 座標置きでも段のレールに乗ったままのもの（onRail）は、上下を段のレールに合わせ直す。
    // ダクトの余白を変えて段が動いたとき、レールから外れて取り残されないように
    let y = p.y;
    if (p.pinned && p.onRail) {
      const row = rowByIndex.get(p.row);
      const spec = devices.get(p.specId);
      if (row && spec) y = placeY(row, spec, p.mount, p.rot);
    }
    // ストアの pinned をそのまま返さない（pushRowsUp が y を動かすので、写しにする）
    return { ...p, y, ...(it && (it.side || it.showOn) ? { side: it.side, showOn: it.showOn } : {}) };
  });

  // 消したダクトは配列から外さず印を付けて残す。図の上に薄く出して押し戻せるようにする
  const gone = new Set(removedDucts);
  // 干渉判定は removed の印が付いたあとの並びで行う。消した場所は機器が使ってよい
  const ducts = result.ducts.map((d) => (gone.has(d.id) ? { ...d, removed: true } : d));

  /*
   * 段の中身を上へ詰める。ダクトのある面（中板）だけ。
   * ダクトの無い面は「上のダクトまで」という当たりが無く、面の天井まで
   * 全部が寄ってしまうため、詰めない。
   */
  if (FACE_BY_ID.get(face)?.ducts) {
    pushRowsUp(
      result.rows,
      ducts,
      placed,
      devices,
      faceSize(panel, face).h,
      profile,
    );
  }

  return {
    rows: result.rows,
    ducts,
    placed,
    size: faceSize(panel, face),
    violations: [
      ...result.violations,
      ...depthViolations(panel, face, placed, devices),
      ...baseUnitViolations(placed, devices),
      ...detectOverlaps(placed, devices),
      ...ductOverlaps(placed, ducts, devices),
      // DINレールどうしの重なり（レールのある面だけ）
      ...(FACE_BY_ID.get(face)?.ducts
        ? railOverlaps(
            computeRails({ rows: result.rows, ducts, placed, violations: [], size: faceSize(panel, face) }, devices, profile.rail.endMargin, profile.rail.adjust),
            devices,
            placed,
          )
        : []),
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
