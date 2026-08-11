import { computeRails } from './layout';
import type { DeviceLookup } from './layout';
import type { BomLine, LayoutResult, Profile } from '../types';

/** 配線ダクト・DINレールの定尺(mm)。社内の調達に合わせて変更する。 */
const DUCT_STOCK_LENGTH = 2000;
const RAIL_STOCK_LENGTH = 1000;

/**
 * BOM を組み立てる。盤全体（6面ぶん）をまとめて集計する。
 *
 * BOM 自動化の価値は機器本体ではなく「派生部品」にある。DINレールの切断長、
 * ダクトの定尺からの必要本数、エンドストッパ — 手作業で一番漏れるのがここ。
 */
export function buildBom(
  layouts: LayoutResult[],
  profile: Profile,
  devices: DeviceLookup,
): BomLine[] {
  const lines: BomLine[] = [];
  const placed = layouts.flatMap((l) => l.placed);

  // --- 機器本体（型式で集約） ---
  const counts = new Map<string, number>();
  for (const p of placed) counts.set(p.specId, (counts.get(p.specId) ?? 0) + 1);
  for (const [specId, qty] of counts) {
    const spec = devices.get(specId);
    if (!spec) continue;
    lines.push({
      model: spec.model,
      maker: spec.maker,
      name: spec.name,
      qty,
      unit: '個',
      source: 'device',
    });
  }

  // --- DINレール（段ごとに1本。作図と同じ計算を共有する） ---
  const rails = layouts.flatMap((l) => computeRails(l, devices));
  const railTotal = rails.reduce((s, r) => s + Math.ceil(r.length), 0);
  const railCount = rails.length;
  if (railCount > 0) {
    lines.push({
      model: `DINレール TH35-7.5（切断 計${railTotal}mm / ${railCount}本）`,
      maker: '—',
      name: 'DINレール',
      qty: Math.ceil(railTotal / RAIL_STOCK_LENGTH),
      unit: `本(${RAIL_STOCK_LENGTH}mm定尺)`,
      source: 'derived',
    });
    lines.push({
      model: 'エンドストッパ',
      maker: '—',
      name: 'DINレール用エンドストッパ',
      qty: railCount * 2,
      unit: '個',
      source: 'derived',
    });
  }

  // --- 配線ダクト（レイアウト上のダクト矩形の総延長から） ---
  const ductTotal = layouts.flatMap((l) => l.ducts).reduce((sum, d) => sum + d.w, 0);
  if (ductTotal > 0) {
    const stockQty = Math.ceil(ductTotal / DUCT_STOCK_LENGTH);
    const offcut = stockQty * DUCT_STOCK_LENGTH - ductTotal;
    lines.push({
      model: `配線ダクト 幅${profile.duct.width}（必要長 ${Math.ceil(ductTotal)}mm / 端材 ${Math.ceil(offcut)}mm）`,
      maker: '—',
      name: '配線ダクト',
      qty: stockQty,
      unit: '本(2000mm定尺)',
      source: 'derived',
    });
  }

  // --- 直付け機器の取付ネジ（取付穴の数から。穴情報が無い機器は4本で概算） ---
  let screws = 0;
  for (const p of placed) {
    if (p.mount !== 'direct') continue;
    const holes = devices.get(p.specId)?.mountHoles;
    screws += holes ? Math.max(1, holes.countX) * Math.max(1, holes.countY) : 4;
  }
  if (screws > 0) {
    lines.push({
      model: 'M4 取付ネジ',
      maker: '—',
      name: '機器取付ネジ（直付け分）',
      qty: screws,
      unit: '本',
      source: 'derived',
    });
  }

  return lines;
}

/** 発熱の合計。換気扇・クーラーの要否判断に使う。 */
export function totalHeatW(layouts: LayoutResult[], devices: DeviceLookup): number {
  return layouts
    .flatMap((l) => l.placed)
    .reduce((sum, p) => sum + (devices.get(p.specId)?.heatW ?? 0), 0);
}
