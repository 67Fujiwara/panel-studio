import type { DeviceLookup } from './layout';
import type { Machining, PlacedDevice, TapSize, Violation } from '../types';

/** タップの下穴径。加工リストにはこの径で出す。 */
export const TAP_DRILL: Record<TapSize, number> = { M3: 2.5, M4: 3.3, M5: 4.2, M6: 5.0 };

export const TAP_SIZES: TapSize[] = ['M3', 'M4', 'M5', 'M6'];

/** 加工1件の呼び名。タップは呼びで、丸穴は径で表す。 */
export function machiningLabel(m: Machining): string {
  if (m.kind === 'notch') return `${m.w}×${m.h} 切り欠き`;
  return m.tap ? `${m.tap} タップ` : `φ${m.dia} 丸穴`;
}

/** 集計用の短い呼び名。 */
export function machiningKey(m: Machining): string {
  return machiningLabel(m);
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

/**
 * 加工同士のかぶりを見つける。
 *
 * 同じ座標に穴を重ねて指示すると、加工屋では下穴が潰れて図面どおりに開かない。
 * 手で足した加工と、機器から自動で出た加工が同じ場所に来ることもあるので、
 * 座標が一致しているかではなく **実際に形が重なるか** で見る。
 * 図面上でわざと近づける刻みを考えて、接している程度（1mm 未満の食い込み）は見逃す。
 */
const CUT_TOUCH = 1;

/** 加工1件の当たり判定用の形。 */
function cutHit(a: Machining, b: Machining): boolean {
  const rect = (m: Machining) =>
    m.kind === 'notch'
      ? { x0: m.x - m.w / 2, x1: m.x + m.w / 2, y0: m.y - m.h / 2, y1: m.y + m.h / 2 }
      : { x0: m.x - m.dia / 2, x1: m.x + m.dia / 2, y0: m.y - m.dia / 2, y1: m.y + m.dia / 2 };

  if (a.kind === 'hole' && b.kind === 'hole') {
    return Math.hypot(a.x - b.x, a.y - b.y) < (a.dia + b.dia) / 2 - CUT_TOUCH;
  }
  // 丸穴と切り欠き、切り欠き同士は外接四角どうしの重なりで見る
  const ra = rect(a);
  const rb = rect(b);
  return (
    ra.x0 < rb.x1 - CUT_TOUCH &&
    rb.x0 < ra.x1 - CUT_TOUCH &&
    ra.y0 < rb.y1 - CUT_TOUCH &&
    rb.y0 < ra.y1 - CUT_TOUCH
  );
}

/** かぶっている加工の組を違反として返す。自動導出ぶんと手動ぶんの両方を見る。 */
export function machiningOverlaps(items: Machining[]): Violation[] {
  const out: Violation[] = [];
  // 同じ機器から出た開口と取付穴の位置関係はメーカーが決めたもので、
  // こちらの指示ミスではないので数えない
  const ownerOf = (m: Machining) => (isDerived(m) ? m.id.split('-')[1] : undefined);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (a.face !== b.face) continue;
      const owner = ownerOf(a);
      if (owner !== undefined && owner === ownerOf(b)) continue;
      if (!cutHit(a, b)) continue;
      const same = a.x === b.x && a.y === b.y;
      out.push({
        uid: a.id,
        kind: 'cut-overlap',
        message:
          `加工がかぶっています: ${machiningLabel(a)}（X${a.x} Y${a.y}）と ` +
          `${machiningLabel(b)}（X${b.x} Y${b.y}）` +
          (same ? ' — 座標が同じです' : ''),
      });
    }
  }
  return out;
}

/** かぶっている加工の ID。一覧で赤く出して、どれを直せばいいか分かるようにする。 */
export function overlappingCutIds(items: Machining[]): Set<string> {
  const out = new Set<string>();
  const ownerOf = (m: Machining) => (isDerived(m) ? m.id.split('-')[1] : undefined);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (a.face !== b.face) continue;
      const owner = ownerOf(a);
      if (owner !== undefined && owner === ownerOf(b)) continue;
      if (!cutHit(a, b)) continue;
      out.add(a.id);
      out.add(b.id);
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
