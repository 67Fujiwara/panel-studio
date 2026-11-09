import { describe, expect, it } from 'vitest';
import { autoLayout, computeRails } from '../../src/lib/layout';
import type { PlacedDevice } from '../../src/types';
import { MCCB, TB, dinItems, lookup, panel, profile } from './helpers';

const END = 20;

describe('DINレール（computeRails）', () => {
  it('段の共通レールは機器の両端に余長を足した 1 本。面の左端より外へは出ない', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(MCCB, 2), [], lookup(MCCB), []);
    const rails = computeRails(lay, lookup(MCCB), END);
    expect(rails).toHaveLength(1);
    const r = rails[0]!;
    // 機器は 0..150。左は面の端で 0、右は 150 + 余長
    expect(r.x).toBe(0);
    expect(r.x + r.length).toBeCloseTo(150 + END, 5);
    expect(r.key).toBe('0:0');
  });

  it('面の右端まで寄せた機器があっても、レールは面の幅を超えない', () => {
    const items = dinItems(TB, 4);
    const pinned: PlacedDevice[] = [
      { uid: 'tb3', specId: TB.id, face: 'plate', mount: 'din', x: 540 - TB.size.w, y: 0, row: 0, pinned: true, onRail: true },
    ];
    const lay = autoLayout(panel(), profile(), 'plate', items, pinned, lookup(TB), []);
    for (const r of computeRails(lay, lookup(TB), END)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.length).toBeLessThanOrEqual(540 + 1e-6);
    }
  });

  it('手直し（adjust）は外へ伸ばす向きが＋で、縮めるのは機器の端まで', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(MCCB, 2), [], lookup(MCCB), []);
    const longer = computeRails(lay, lookup(MCCB), END, { '0:0': { right: 10 } })[0]!;
    expect(longer.x + longer.length).toBeCloseTo(150 + END + 10, 5);
    const shorter = computeRails(lay, lookup(MCCB), END, { '0:0': { right: -100 } })[0]!;
    // 機器の右端 150 より内側には縮まない
    expect(shorter.x + shorter.length).toBeCloseTo(150, 5);
    // 端を動かせる範囲も返す
    expect(longer.bounds?.right.min).toBeCloseTo(150, 5);
    expect(longer.bounds?.right.max).toBeCloseTo(540, 5);
  });

  it('切断長の合計は作図と同じ値（adjust を含む）', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(TB, 8), [], lookup(TB), []);
    const plain = computeRails(lay, lookup(TB), END).reduce((s, r) => s + r.length, 0);
    const adjusted = computeRails(lay, lookup(TB), END, { '0:0': { left: 5, right: 5 } }).reduce((s, r) => s + r.length, 0);
    // 左端は面の端 0 で止まるので伸びず、右だけ 5 伸びる
    expect(adjusted - plain).toBeCloseTo(5, 5);
  });
});
