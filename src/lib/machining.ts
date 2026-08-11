import type { DeviceLookup } from './layout';
import type { Machining, PlacedDevice, TapSize } from '../types';

/** タップの下穴径。加工リストにはこの径で出す。 */
export const TAP_DRILL: Record<TapSize, number> = { M3: 2.5, M4: 3.3, M5: 4.2, M6: 5.0 };

export const TAP_SIZES: TapSize[] = ['M3', 'M4', 'M5', 'M6'];

/** 加工1件の呼び名。タップ穴は呼びで、バカ穴は径で表す。 */
export function machiningLabel(m: Machining): string {
  if (m.kind === 'notch') return `${m.w}×${m.h} 角穴`;
  return m.tap ? `${m.tap} タップ` : `φ${m.dia} 穴`;
}

/** 集計用の短い呼び名。 */
export function machiningKey(m: Machining): string {
  if (m.kind === 'notch') return `${m.w}×${m.h} 角穴`;
  return m.tap ? `${m.tap} タップ` : `φ${m.dia} 穴`;
}

const round = (v: number) => Number(v.toFixed(1));

/**
 * 機器から自動で決まる加工。
 *
 * 押ボタンを置けば φ22 の穴、表示器を置けば角穴、直付け機器なら取付穴のケガキ座標 —
 * というように、機器マスタの panelCutout / mountHoles から座標付きで導出する。
 * 手で座標を拾う必要をなくすのが狙い。
 * 導出結果は保存せず配置から毎回計算する（配置を動かせば加工もついてくる）。
 */
export function derivedMachining(placed: PlacedDevice[], devices: DeviceLookup): Machining[] {
  const out: Machining[] = [];
  for (const p of placed) {
    const spec = devices.get(p.specId);
    if (!spec) continue;
    const cx = p.x + spec.size.w / 2;
    const cy = p.y + spec.size.h / 2;

    // パネルの開口（押ボタン穴・表示器の角穴など）
    const cut = spec.panelCutout;
    if (cut) {
      if (cut.kind === 'hole') {
        out.push({
          id: `cut-${p.uid}`,
          face: p.face,
          kind: 'hole',
          x: round(cx),
          y: round(cy),
          dia: cut.dia,
          note: `${spec.model} 開口`,
        });
      } else {
        // 切り欠きも中心座標で持つ
        out.push({
          id: `cut-${p.uid}`,
          face: p.face,
          kind: 'notch',
          x: round(cx),
          y: round(cy),
          w: cut.w,
          h: cut.h,
          note: `${spec.model} 開口`,
        });
      }
    }

    // 直付けの取付穴。ピッチから1穴ずつ座標に展開する
    const holes = spec.mountHoles;
    if (holes && p.mount === 'direct') {
      const nx = Math.max(1, holes.countX);
      const ny = Math.max(1, holes.countY);
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
          const ox = nx === 1 ? 0 : (ix - (nx - 1) / 2) * holes.pitchX;
          const oy = ny === 1 ? 0 : (iy - (ny - 1) / 2) * holes.pitchY;
          out.push({
            id: `hole-${p.uid}-${ix}-${iy}`,
            face: p.face,
            kind: 'hole',
            x: round(cx + ox),
            y: round(cy + oy),
            dia: holes.dia,
            note: `${spec.model} 取付穴`,
          });
        }
      }
    }
  }
  return out;
}

/** 自動導出ぶんは編集できない。ID の接頭辞で見分ける。 */
export const isDerived = (m: Machining) => m.id.startsWith('cut-') || m.id.startsWith('hole-');

/** 同じ寸法の加工をまとめた集計（加工指示に使う）。 */
export function summarizeMachining(items: Machining[]): { label: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const m of items) {
    const key = machiningKey(m);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map].map(([label, qty]) => ({ label, qty })).sort((a, b) => b.qty - a.qty);
}

/** 加工を「どの機器から出たか」でまとめる。右ペインの表示に使う。 */
export function groupByDevice(
  items: Machining[],
  placed: PlacedDevice[],
  devices: DeviceLookup,
): { uid: string; model: string; items: Machining[] }[] {
  const groups = new Map<string, { uid: string; model: string; items: Machining[] }>();
  for (const m of items) {
    const uid = m.id.split('-')[1] ?? '';
    const p = placed.find((q) => q.uid === uid);
    const model = (p && devices.get(p.specId)?.model) ?? '手動追加';
    const key = p ? uid : 'manual';
    const g = groups.get(key) ?? { uid: key, model, items: [] };
    g.items.push(m);
    groups.set(key, g);
  }
  return [...groups.values()];
}
