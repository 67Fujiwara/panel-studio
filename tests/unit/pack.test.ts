/**
 * 流し込みの 3 つの手順をそれぞれ単体で試す。
 * 全体の答えは layout.golden.test.ts が持つので、ここは「各手順が何を保証するか」を書く。
 */
import { describe, expect, it } from 'vitest';
import { candidateOf, fillBuckets, findSlot, foldObstacles, packContext, resolveRows, rowSlots } from '../../src/lib/layout/pack';
import { effectiveClearance, rowGap } from '../../src/lib/layout/clearance';
import type { Entry } from '../../src/lib/layout/types';
import { MCCB, PSU, TB, lookup, panel, profile } from './helpers';

const entry = (spec: typeof TB, uid: string, extra: Partial<Entry['item']> = {}): Entry => ({
  item: { uid, specId: spec.id, face: 'plate', mount: spec.mount[0]!, ...extra },
  spec,
});

describe('1. 段の枠を作る（rowSlots）', () => {
  it('横ダクト段組みでは面の幅いっぱいが 1 区画', () => {
    const ctx = packContext(panel(), 'plate', profile(), []);
    const slots = rowSlots(ctx, 0);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ x0: 0, x1: 540, cursor: 0, used: false });
  });

  it('ゾーン分割では中央の縦ダクトで左右 2 区画に分かれる', () => {
    const prof = profile();
    prof.duct.layout = 'zoned';
    const ctx = packContext(panel(), 'plate', prof, []);
    const slots = rowSlots(ctx, 0);
    expect(slots).toHaveLength(2);
    expect(slots[0]!.x1).toBeLessThanOrEqual(270 - prof.duct.width / 2 + 0.01);
    expect(slots[1]!.x0).toBeGreaterThanOrEqual(270 + prof.duct.width / 2 - 0.01);
  });

  it('段ごとの左右の余白（面の余白）が区画の端に効く', () => {
    const prof = profile();
    prof.duct.margin.left = 30;
    prof.duct.margin.right = 20;
    const ctx = packContext(panel(), 'plate', prof, []);
    expect(rowSlots(ctx, 0)[0]).toMatchObject({ x0: 30, x1: 520 });
  });
});

describe('2. 1 台の置き場所を探す（findSlot）', () => {
  it('空の区画では左端から。直前の機器の右に離隔を空けて続く', () => {
    const ctx = packContext(panel(), 'plate', profile(), []);
    const b = { entries: [], pinnedCount: 0, up: 0, down: 0, downDuct: 0, slots: rowSlots(ctx, 0) };
    const cand = candidateOf(entry(TB, 'a'));
    const eff = effectiveClearance(TB, ctx.c, rowGap(ctx.profile, 0));
    expect(findSlot(ctx, b, 0, cand, eff)?.x).toBe(0);
    // 置いたことにして次を探す
    b.slots[0]!.used = true;
    b.slots[0]!.cursor = TB.size.w;
    expect(findSlot(ctx, b, 0, cand, eff)?.x).toBeCloseTo(TB.size.w, 5);
  });

  it('座標で置いた機器（obstacle）に掛かるなら、その右へ避ける', () => {
    const ctx = packContext(panel(), 'plate', profile(), [{ row: 0, x0: 2, x1: 40, stopper: false, up: 30, down: 30 }]);
    const b = { entries: [], pinnedCount: 0, up: 0, down: 0, downDuct: 0, slots: rowSlots(ctx, 0) };
    const cand = candidateOf(entry(TB, 'a'));
    const eff = effectiveClearance(TB, ctx.c, rowGap(ctx.profile, 0));
    expect(findSlot(ctx, b, 0, cand, eff)?.x).toBe(40);
  });

  it('区画の残り幅に入らなければ null（次の段へ回す判断材料）', () => {
    const ctx = packContext(panel(), 'plate', profile(), []);
    const b = { entries: [], pinnedCount: 0, up: 0, down: 0, downDuct: 0, slots: rowSlots(ctx, 0) };
    b.slots[0]!.used = true;
    b.slots[0]!.cursor = 540 - 50;
    const cand = candidateOf(entry(MCCB, 'm'));
    const eff = effectiveClearance(MCCB, ctx.c, rowGap(ctx.profile, 0));
    expect(findSlot(ctx, b, 0, cand, eff)).toBeNull();
  });

  it('ゾーン分割では動力は左、制御（端子台）は右の区画に入る', () => {
    const prof = profile();
    prof.duct.layout = 'zoned';
    const ctx = packContext(panel(), 'plate', prof, []);
    const b = { entries: [], pinnedCount: 0, up: 0, down: 0, downDuct: 0, slots: rowSlots(ctx, 0) };
    const power = findSlot(ctx, b, 0, candidateOf(entry(MCCB, 'm')), effectiveClearance(MCCB, ctx.c, rowGap(prof, 0)));
    const ctrl = findSlot(ctx, b, 0, candidateOf(entry(TB, 't')), effectiveClearance(TB, ctx.c, rowGap(prof, 0)));
    expect(power?.slot).toBe(b.slots[0]);
    expect(ctrl?.slot).toBe(b.slots[1]);
  });
});

describe('2′. 段への振り分け（fillBuckets）', () => {
  it('幅が足りなければ次の段へ、段を名指しされた機器は入らなくてもその段に置いて知らせる', () => {
    const ctx = packContext(panel(), 'plate', profile(), []);
    const queue = [
      ...Array.from({ length: 8 }, (_, i) => entry(MCCB, `m${i}`)), // 75 × 8 = 600 > 540 → 7 台で 1 段目が埋まる
      entry(MCCB, 'forced', { row: 0 }), // 埋まった 1 段目を名指し
    ];
    const { buckets, violations } = fillBuckets(ctx, queue);
    expect(buckets[0]!.entries).toHaveLength(7 + 1);
    expect(buckets[1]!.entries).toHaveLength(1);
    expect(violations.map((v) => v.uid)).toEqual(['forced']);
    expect(violations[0]!.message).toContain('指定された 1 段目に横幅が足りません');
  });

  it('段の中身より幅の広い機器は置けないと知らせ、消えない', () => {
    const wide = { ...PSU, id: 'wide', size: { w: 600, h: 100, d: 50 } };
    const ctx = packContext(panel(), 'plate', profile(), []);
    const { violations } = fillBuckets(ctx, [entry(wide, 'w')]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('超えています');
  });
});

describe('3. 段とダクトを決める（resolveRows）', () => {
  it('横ダクトは段の数 + 1 本で上から順に番号が付き、段の高さは機器の高さと離隔から決まる', () => {
    const ctx = packContext(panel(), 'plate', profile(), []);
    const { buckets } = fillBuckets(ctx, [entry(MCCB, 'm'), entry(TB, 't', { row: 1 })]);
    foldObstacles(ctx, buckets);
    const out = resolveRows(ctx, buckets);
    expect(out.rows).toHaveLength(2);
    const horizontal = out.ducts.filter((d) => d.vert === undefined);
    expect(horizontal.map((d) => d.id)).toEqual([0, 1, 2]);
    // ダクト 0 は面の上端、段 0 はその下。段の高さ = 遮断器 130 + 上下の離隔 20
    expect(horizontal[0]!.y + horizontal[0]!.h).toBeCloseTo(740, 5);
    expect(out.rows[0]!.h).toBeCloseTo(130 + 20 + 20, 5);
    expect(out.violations).toHaveLength(0);
  });

  it('座標で置いた機器だけの段も段として残り、下のダクトはその機器を避ける', () => {
    const ctx = packContext(panel(), 'plate', profile(), [{ row: 1, x0: 100, x1: 220, stopper: false, up: 60, down: 60 }]);
    const { buckets } = fillBuckets(ctx, [entry(MCCB, 'm')]);
    foldObstacles(ctx, buckets);
    const out = resolveRows(ctx, buckets);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]!.h).toBeCloseTo(120, 5);
  });

  it('面に入り切らない高さは知らせる', () => {
    const tall = { ...MCCB, id: 'tall', size: { w: 75, h: 400, d: 68 } };
    const ctx = packContext(panel(), 'plate', profile(), []);
    const { buckets } = fillBuckets(ctx, [entry(tall, 'a'), entry(tall, 'b', { row: 1 })]);
    const out = resolveRows(ctx, buckets);
    expect(out.violations.some((v) => v.message.includes('必要高さ'))).toBe(true);
  });
});
