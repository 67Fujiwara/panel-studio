/**
 * キャビネットの面に付けた機器を、**ほかの面の図にも投影**する。
 *
 * 「扉に付けた表示器が側面図でどこまで出るか」「側面に付けたファンが正面図でどの高さにあるか」を、
 * 付けた面以外の図でも見えるようにする。干渉確認と、取引先に渡す図の分かりやすさのため。
 *
 * やり方は 3D の箱に一度直すだけ:
 *  1. 付けた面の座標 (u, v)・見かけの幅高さ・奥行きから、盤の座標 (X 右, Y 上, Z 前) の箱を作る
 *  2. 出したい面の座標に箱を写す（面ごとに向きが決まっている。第三角法の展開と同じ）
 * 面ごとの向きは unfold.ts の並びと sideView.ts の約束に合わせてある:
 *  - 扉: u=X, v=Y（Z=D の面）／ 背面: 後ろから見るので u=W−X
 *  - 左側面: u=Z（0 が背面・D が扉）／ 右側面: u=D−Z（0 が扉）
 *  - 上面: u=X, v=D−Z（下端が扉側）／ 底面: u=X, v=Z（上端が扉側）
 *
 * 機器の本体は、外側取付でも内側取付でも**面の内側へ奥行きぶん**出る（押ボタンの本体は扉の裏に
 * ある。外に出ている頭は図にしない）。だから投影は取付側によらず同じ。
 */
import { autoLayout } from './layout';
import type { DeviceLookup, LayoutItem } from './layout';
import { rotatedSize } from '../types';
import type { DeviceShape, FaceId, PanelSpec, PlacedDevice, Profile } from '../types';

/** 盤の座標での箱。X 右・Y 上・Z 前（0 が背面、D が扉面） */
export type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

const CAB_FACES: FaceId[] = ['top', 'left', 'door', 'right', 'back', 'bottom'];

/** 面の座標 (u,v) の四角＋内側への奥行き d を、盤の箱にする */
export function faceRectToBox(
  face: FaceId,
  panel: PanelSpec,
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
): Box3 | null {
  const { w: W, h: H, d: D } = panel.outer;
  switch (face) {
    case 'door':
      return { x0: u, x1: u + w, y0: v, y1: v + h, z0: D - d, z1: D };
    case 'back':
      return { x0: W - u - w, x1: W - u, y0: v, y1: v + h, z0: 0, z1: d };
    case 'left':
      return { x0: 0, x1: d, y0: v, y1: v + h, z0: u, z1: u + w };
    case 'right':
      return { x0: W - d, x1: W, y0: v, y1: v + h, z0: D - u - w, z1: D - u };
    case 'top':
      return { x0: u, x1: u + w, y0: H - d, y1: H, z0: D - v - h, z1: D - v };
    case 'bottom':
      return { x0: u, x1: u + w, y0: 0, y1: d, z0: v, z1: v + h };
    default:
      return null;
  }
}

/** 盤の箱を、面の座標の四角（左下 x,y と w,h）に写す */
export function boxToFaceRect(
  face: FaceId,
  panel: PanelSpec,
  b: Box3,
): { x: number; y: number; w: number; h: number } | null {
  const { w: W, d: D } = panel.outer;
  switch (face) {
    case 'door':
      return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    case 'back':
      return { x: W - b.x1, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    case 'left':
      return { x: b.z0, y: b.y0, w: b.z1 - b.z0, h: b.y1 - b.y0 };
    case 'right':
      return { x: D - b.z1, y: b.y0, w: b.z1 - b.z0, h: b.y1 - b.y0 };
    case 'top':
      return { x: b.x0, y: D - b.z1, w: b.x1 - b.x0, h: b.z1 - b.z0 };
    case 'bottom':
      return { x: b.x0, y: b.z0, w: b.x1 - b.x0, h: b.z1 - b.z0 };
    default:
      return null;
  }
}

/** ほかの面に出す 1 台ぶん */
export type Projection = {
  uid: string;
  model: string;
  /** 付けた面 */
  from: FaceId;
  /** 出す面の座標(mm・左下原点) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 描く形。無ければ四角 */
  shape?: DeviceShape;
  /** 形を左右反転して描くか */
  mirror: boolean;
};

/** 既定で出す面。扉の機器に側面の外形線があれば、以前どおり左右側面に出す */
export function defaultShowOn(face: FaceId, hasSideShape: boolean): FaceId[] {
  return face === 'door' && hasSideShape ? ['left', 'right'] : [];
}

/**
 * 面 `view` の図に出す、ほかの面の機器の投影。
 * 出すのは、その機器の「他の面にも表示」に `view` が入っているものだけ。
 * 形は、向かい合う面（扉⇄背面）なら正面の外形線、左右側面から見るときは側面の外形線、それ以外は四角。
 */
export function projectionsFor(
  view: FaceId,
  panel: PanelSpec,
  profile: Profile,
  items: LayoutItem[],
  pinned: PlacedDevice[],
  devices: DeviceLookup,
  removedDucts: Partial<Record<FaceId, number[]>>,
): Projection[] {
  if (view === 'plate') return [];
  const out: Projection[] = [];
  for (const from of CAB_FACES) {
    if (from === view) continue;
    if (!items.some((i) => i.face === from)) continue;
    const layout = autoLayout(panel, profile, from, items, pinned, devices, removedDucts[from] ?? []);
    for (const p of layout.placed) {
      const spec = devices.get(p.specId);
      if (!spec) continue;
      const showOn: FaceId[] = p.showOn ?? defaultShowOn(from, Boolean(spec.sideShape));
      if (!showOn.includes(view)) continue;
      const s = rotatedSize(spec.size, p.rot);
      const box = faceRectToBox(from, panel, p.x, p.y, s.w, s.h, spec.size.d);
      if (!box) continue;
      const r = boxToFaceRect(view, panel, box);
      if (!r) continue;
      const vertical = (f: FaceId) => f === 'door' || f === 'back' || f === 'left' || f === 'right';
      const opposite =
        (from === 'door' && view === 'back') ||
        (from === 'back' && view === 'door') ||
        (from === 'left' && view === 'right') ||
        (from === 'right' && view === 'left');
      // 縦の面どうしで直角なら、見えるのはその機器の側面（奥行き×高さ）
      const perpendicular = vertical(from) && vertical(view) && !opposite;
      let shape: DeviceShape | undefined;
      let mirror = false;
      if (opposite && spec.shape) {
        shape = spec.shape;
        mirror = true; // 裏から見るので左右が逆
      } else if (perpendicular && spec.sideShape) {
        shape = spec.sideShape;
        /*
         * 側面の外形線は「取付面を左」にした図で取り込む約束。
         * 出す面の横軸で取付面が左端に来る組み合わせならそのまま、右端に来るなら反転
         * （左側面ビューは u=Z なので背面が左、右側面ビューは u=D−Z なので扉が左。
         *   正面ビューは u=X なので左側面が左、背面ビューは u=W−X なので右側面が左）
         */
        const mountAtLeft =
          (view === 'left' && from === 'back') ||
          (view === 'right' && from === 'door') ||
          (view === 'door' && from === 'left') ||
          (view === 'back' && from === 'right');
        mirror = !mountAtLeft;
      }
      out.push({ uid: p.uid, model: spec.model, from, x: r.x, y: r.y, w: r.w, h: r.h, shape, mirror });
    }
  }
  return out;
}
