import { FACE_BY_ID } from '../data/faces';
import { rotatedSize } from '../types';
import { computeRails } from './layout';
import type { DeviceLookup, RailRun } from './layout';
import type {
  Duct,
  FaceId,
  FixingSettings,
  LayoutResult,
  Machining,
  PlacedDevice,
  Profile,
  TapSize,
  Violation,
} from '../types';

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
    // 回した機器は幅と高さが入れ替わるので、見かけの寸法で中心を出す
    const size = rotatedSize(spec.size, p.rot);
    const cx = p.x + size.w / 2;
    const cy = p.y + size.h / 2;

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
export const isDerived = (m: Machining) =>
  m.id.startsWith('cut-') || m.id.startsWith('hole-') || m.id.startsWith('fix-');

/**
 * 1本の帯（ダクト・DINレール）を留める穴の位置を、端からの距離で割り出す。
 *
 * 留め方の考え方は現場と同じで **「両端はできるだけ外側、残りは真ん中に寄せる」**。
 * 端を押さえないと帯が浮くし、真ん中が偏っていると図面として見苦しいため。
 *
 * - 両端の穴は端から endOffset のところ
 * - 間の穴は指定ピッチのまま、帯の中心を軸に振り分ける
 * - ピッチ 0 なら両端の間を等分する（定尺の穴位置に縛られないとき）
 */
export function fixingOffsets(length: number, f: FixingSettings): number[] {
  const n = Math.max(1, Math.floor(f.points));
  const first = Math.min(f.endOffset, length / 2);
  const last = length - first;
  if (n === 1) return [length / 2];
  if (n === 2) return [first, last];

  const inner = n - 2;
  const mid = length / 2;
  let middles: number[];
  if (f.pitch > 0) {
    // 中の穴は帯の中心を軸に、指定ピッチで左右対称に並べる
    middles = Array.from({ length: inner }, (_, i) => mid + (i - (inner - 1) / 2) * f.pitch);
  } else {
    middles = Array.from({ length: inner }, (_, i) => first + ((last - first) * (i + 1)) / (n - 1));
  }
  // 端の穴より外へ出さない
  const clamp = (v: number) => Math.min(last, Math.max(first, v));
  return [first, ...middles.map(clamp), last];
}

/**
 * ダクトと DINレールを中板に留める穴。
 *
 * 帯1本ごとに「何か所・どのタップで」を設定から決めて座標に展開する。
 * 実際の加工では機器の取付穴と同じ図面に出るものなので、同じ仕組みで持たせている。
 */
export function fixingMachining(
  face: FaceId,
  ducts: Duct[],
  rails: RailRun[],
  profile: Profile,
): Machining[] {
  const out: Machining[] = [];
  if (!FACE_BY_ID.get(face)?.ducts) return out;

  for (const d of ducts) {
    if (d.removed) continue;
    const f = profile.duct.fixing;
    const vertical = d.h > d.w;
    const len = vertical ? d.h : d.w;
    for (const [i, at] of fixingOffsets(len, f).entries()) {
      out.push({
        id: `fix-duct${d.id}-${i}`,
        face,
        kind: 'hole',
        x: round(vertical ? d.x + d.w / 2 : d.x + at),
        y: round(vertical ? d.y + at : d.y + d.h / 2),
        dia: TAP_DRILL[f.tap],
        tap: f.tap,
        note: `ダクト ${d.id + 1} 本目 固定`,
      });
    }
  }

  for (const r of rails) {
    const f = profile.rail.fixing;
    for (const [i, at] of fixingOffsets(r.length, f).entries()) {
      out.push({
        id: `fix-rail${r.row}-${i}`,
        face,
        kind: 'hole',
        x: round(r.x + at),
        y: round(r.y),
        dia: TAP_DRILL[f.tap],
        tap: f.tap,
        note: `DINレール ${r.row + 1} 段目 固定`,
      });
    }
  }

  return out;
}

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
    // ダクト・レールの固定穴は機器から出たものではないので、まとめて1つの枝にする
    const fixing = m.id.startsWith('fix-');
    const uid = m.id.split('-')[1] ?? '';
    const p = fixing ? undefined : placed.find((q) => q.uid === uid);
    const key = fixing ? 'fixing' : p ? uid : 'manual';
    const model = fixing ? 'ダクト・DINレール 固定' : (p && devices.get(p.specId)?.model) ?? '手動追加';
    const g = groups.get(key) ?? { uid: key, model, items: [] };
    g.items.push(m);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * その面で自動的に決まる加工をすべて出す。
 * 機器から出るもの（開口・取付穴）と、ダクト・レールの固定穴の両方。
 */
export function autoMachining(
  face: FaceId,
  layout: LayoutResult,
  devices: DeviceLookup,
  profile: Profile,
): Machining[] {
  return [
    ...derivedMachining(layout.placed, devices),
    ...fixingMachining(face, layout.ducts, computeRails(layout, devices, profile.rail.endMargin), profile),
  ];
}
