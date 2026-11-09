import { describe, expect, it } from 'vitest';
import { autoLayout } from '../../src/lib/layout';
import type { PlacedDevice } from '../../src/types';
import { MCCB, TB, dinItems, lookup, panel, profile } from './helpers';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe('段への流し込み（autoLayout）', () => {
  it('端子台は同じ段に隙間なく並ぶ', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(TB, 8), [], lookup(TB), []);
    const xs = lay.placed.map((p) => p.x).sort((a, b) => a - b);
    expect(lay.placed).toHaveLength(8);
    expect(new Set(lay.placed.map((p) => p.row)).size).toBe(1);
    for (let i = 1; i < xs.length; i++) expect(near(xs[i]! - xs[i - 1]!, TB.size.w)).toBe(true);
  });

  it('段からあふれた機器は消えずに次の段へ落ちる', () => {
    // 幅 5.2 × 120 台 = 624mm > 中板 540mm
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(TB, 120), [], lookup(TB), []);
    expect(lay.placed).toHaveLength(120);
    expect(new Set(lay.placed.map((p) => p.row)).size).toBeGreaterThanOrEqual(2);
    expect(lay.violations.filter((v) => v.kind === 'overflow')).toHaveLength(0);
  });

  it('座標で置いた機器（レールに乗ったまま）を流し込みは避け、重ねない', () => {
    const items = dinItems(TB, 8);
    const pinned: PlacedDevice[] = [
      { uid: 'tb0', specId: TB.id, face: 'plate', mount: 'din', x: 100, y: 0, row: 0, pinned: true, onRail: true },
    ];
    const lay = autoLayout(panel(), profile(), 'plate', items, pinned, lookup(TB), []);
    expect(lay.placed).toHaveLength(8);
    const me = lay.placed.find((p) => p.uid === 'tb0')!;
    expect(me.x).toBe(100);
    for (const q of lay.placed) {
      if (q.uid === 'tb0') continue;
      // 横に重ならない
      expect(q.x + TB.size.w <= me.x + 0.01 || me.x + TB.size.w <= q.x + 0.01).toBe(true);
    }
    expect(lay.violations.filter((v) => v.kind === 'overlap')).toHaveLength(0);
  });

  it('横ダクト段組みでは、横ダクトは段の数 + 1 本', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 120)];
    const lay = autoLayout(panel(), profile(), 'plate', items, [], lookup(MCCB, TB), []);
    const rows = lay.rows.length;
    const horizontal = lay.ducts.filter((d) => d.vert === undefined);
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(horizontal).toHaveLength(rows + 1);
  });

  it('座標で置いた機器はダクトの位置に影響されて動かない（x はそのまま）', () => {
    const items = dinItems(MCCB, 2);
    const pinned: PlacedDevice[] = [
      { uid: 'mccb1', specId: MCCB.id, face: 'plate', mount: 'direct', x: 300, y: 300, row: -1, pinned: true },
    ];
    const prof = profile();
    prof.duct.ductGaps = { 1: { above: 60, below: 60 } };
    const lay = autoLayout(panel(), prof, 'plate', items, pinned, lookup(MCCB), []);
    const me = lay.placed.find((p) => p.uid === 'mccb1')!;
    expect(me.x).toBe(300);
    expect(me.y).toBe(300);
  });
});
