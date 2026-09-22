import { autoLayout, deviceProjection } from './layout';
import type { DeviceLookup, LayoutItem } from './layout';
import { rotatedSize } from '../types';
import type { DeviceShape, FaceId, PanelSpec, PlacedDevice, Profile } from '../types';

/**
 * 側面図への**中板の機器**の投影（干渉確認用）。
 *
 * 中板に付けた機器のうち、**側面の外形線（sideShape）を登録したものだけ**を
 * 左右側面のビューに薄く写す。奥行き方向の当たり（機器と扉、機器同士の前後）を
 * 目で確認するためのもので、配置・加工の対象にはならない。
 * キャビネットの面（扉など）に付けた機器の投影は projection.ts が担当する
 * （どの面に出すかを機器ごとに選べる）。
 *
 * 前提と約束:
 * - 奥行きの内訳（背面〜中板）が未入力なら何も出さない。数字を仮置きすると
 *   「収まっている」と読める図が出てしまうため（effectiveDepth と同じ考え方）。
 * - 側面ビューの向きは第三角法の展開（unfold.ts）と同じ。
 *   左側面ビュー: x=0 が背面・x=D が扉。右側面ビュー: x=0 が扉・x=D が背面。
 * - sideShape は「中板側を左・扉側を右」= 左側面ビューの向きで取り込む約束。
 *   向きが逆になるビューでは左右反転して立てる。
 * - 中板は盤の上下中央に付く前提（目安）。取付高さが違う盤では読み替えること。
 */
export type SideSilhouette = {
  uid: string;
  model: string;
  /** 側面ビューの座標(mm・Y上向き・左下原点)。w=奥行き, h=見かけの高さ */
  x: number;
  y: number;
  w: number;
  h: number;
  shape: DeviceShape;
  /** 左右反転して描くか */
  mirror: boolean;
};

export function sideSilhouettes(
  side: 'left' | 'right',
  panel: PanelSpec,
  profile: Profile,
  items: LayoutItem[],
  pinned: PlacedDevice[],
  devices: DeviceLookup,
  removedDucts: Partial<Record<FaceId, number[]>>,
): SideSilhouette[] {
  const backToPlate = panel.depth.backToPlate;
  if (backToPlate === null) return [];
  const D = panel.outer.d;
  // 中板の上下の取付位置（中央付き前提の目安）
  const plateLift = (panel.outer.h - panel.plate.h) / 2;

  const out: SideSilhouette[] = [];
  const layout = autoLayout(panel, profile, 'plate', items, pinned, devices, removedDucts.plate ?? []);
  for (const p of layout.placed) {
    const spec = devices.get(p.specId);
    if (!spec?.sideShape) continue;
    const d = spec.size.d;
    const h = rotatedSize(spec.size, p.rot).h;
    const y = p.y + plateLift;
    // 機器本体の手前側の始まり。中板上面 + DINレール高さ + OP（下に挟まる）の厚み
    const optD = (p.opts ?? []).reduce((s, id) => s + (devices.get(id)?.size.d ?? 0), 0);
    const start = backToPlate + optD + (deviceProjection(spec, p.mount) - d);
    out.push(
      side === 'left'
        ? { uid: p.uid, model: spec.model, x: start, y, w: d, h, shape: spec.sideShape, mirror: false }
        : { uid: p.uid, model: spec.model, x: D - start - d, y, w: d, h, shape: spec.sideShape, mirror: true },
    );
  }
  return out;
}
