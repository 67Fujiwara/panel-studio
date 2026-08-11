import { DEVICE_BY_ID } from '../data/devices';
import type { BomLine, LayoutResult, Profile } from '../types';

/** 配線ダクト・DINレールの定尺(mm)。社内の調達に合わせて変更する。 */
const DUCT_STOCK_LENGTH = 2000;
const RAIL_STOCK_LENGTH = 1000;

/**
 * BOM を組み立てる。
 *
 * BOM 自動化の価値は機器本体ではなく「派生部品」にある。DINレールの切断長、
 * ダクトの定尺からの必要本数、エンドストッパ — 手作業で一番漏れるのがここ。
 */
export function buildBom(layout: LayoutResult, profile: Profile): BomLine[] {
  const lines: BomLine[] = [];

  // --- 機器本体（型式で集約） ---
  const counts = new Map<string, number>();
  for (const p of layout.placed) {
    counts.set(p.specId, (counts.get(p.specId) ?? 0) + 1);
  }
  for (const [specId, qty] of counts) {
    const spec = DEVICE_BY_ID.get(specId);
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

  // --- DINレール（行ごとに1本、機器の占有幅から切断長を出す） ---
  let railTotal = 0;
  let railCount = 0;
  for (const row of layout.rows) {
    const inRow = layout.placed.filter((p) => p.row === row.index && p.mount === 'din');
    if (inRow.length === 0) continue;
    const left = Math.min(...inRow.map((p) => p.x));
    const right = Math.max(
      ...inRow.map((p) => p.x + (DEVICE_BY_ID.get(p.specId)?.size.w ?? 0)),
    );
    // 両端に少し余裕を持たせて切る
    railTotal += Math.ceil(right - left) + 40;
    railCount += 1;
  }
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
  const ductTotal = layout.ducts.reduce((sum, d) => sum + d.w, 0);
  if (ductTotal > 0) {
    const stockQty = Math.ceil(ductTotal / DUCT_STOCK_LENGTH);
    const offcut = stockQty * DUCT_STOCK_LENGTH - ductTotal;
    lines.push({
      model: `配線ダクト 幅${profile.duct.width}（必要長 ${Math.ceil(ductTotal)}mm / 端材 ${Math.ceil(offcut)}mm）`,
      maker: '—',
      name: '配線ダクト',
      qty: stockQty,
      unit: `本(${DUCT_STOCK_LENGTH}mm定尺)`,
      source: 'derived',
    });
  }

  // --- 直付け機器の取付ネジ（1台あたり4本で概算） ---
  const plateCount = layout.placed.filter((p) => p.mount === 'plate').length;
  if (plateCount > 0) {
    lines.push({
      model: 'M4 取付ネジ',
      maker: '—',
      name: '機器取付ネジ（直付け分）',
      qty: plateCount * 4,
      unit: '本',
      source: 'derived',
    });
  }

  return lines;
}

/** 盤内の総発熱。換気扇・クーラーの要否判断に使う（v2 で温度上昇計算に拡張）。 */
export function totalHeatW(layout: LayoutResult): number {
  return layout.placed.reduce(
    (sum, p) => sum + (DEVICE_BY_ID.get(p.specId)?.heatW ?? 0),
    0,
  );
}
