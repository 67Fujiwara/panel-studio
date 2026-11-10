/**
 * 微調整の「動作チェック」。人がやる順番どおりに、機器・ダクト・レールを動かして
 * 配置計算を通し、期待どおりに付いてくる／留まる／止まることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  autoLayout,
  computeRails,
  nudgeDevice,
  planDuctNudge,
  planRailNudge,
} from '../../src/lib/layout';
import type { PlacedDevice, Profile } from '../../src/types';
import { MCCB, TB, dinItems, lookup, panel, profile } from './helpers';

const face = { w: 540, h: 740 };
const devices = lookup(MCCB, TB);

/** ダクトの微調整をプロフィールに書く（ストアの nudgeDuct と同じ書き方） */
function applyDuct(prof: Profile, target: number, patch: NonNullable<ReturnType<typeof planDuctNudge>['patch']>): Profile {
  return { ...prof, duct: { ...prof.duct, ductGaps: { ...prof.duct.ductGaps, [target]: { ...(prof.duct.ductGaps[target] ?? {}), ...patch } } } };
}

describe('微調整の組み合わせ', () => {
  it('右へ寄せた端子台は、ダクトを動かしても他の端子台と同じレールの高さに居続ける', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 6).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay1 = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const tb = lay1.placed.find((p) => p.uid === 'tb0')!;
    // 矢印キーで右へ 100mm
    let moved = tb;
    for (let i = 0; i < 10; i++) moved = nudgeDevice(lay1, devices, face, moved, 10, 0)!.placed;
    const pinned: PlacedDevice[] = [moved];
    const lay2 = autoLayout(panel(), prof, 'plate', items, pinned, devices, []);
    // ダクト 1（1 段目と 2 段目の間）を ↓ へ 10mm（2 段目の端子台には離隔が無いので動く）
    const plan = planDuctNudge(prof, lay2, devices, 1, 0, -10);
    expect(plan.patch).toBeTruthy();
    const prof2 = applyDuct(prof, 1, plan.patch!);
    const lay3 = autoLayout(panel(), prof2, 'plate', items, pinned, devices, []);
    const me = lay3.placed.find((p) => p.uid === 'tb0')!;
    const other = lay3.placed.find((p) => p.uid === 'tb1')!;
    expect(me.x).toBeCloseTo(tb.x + 100, 5);
    expect(me.y).toBeCloseTo(other.y, 5); // 同じレールの高さ
    // ダクト ↓ は上と下の余白を付け替えるので、ダクトだけ 10 下がり、下の段（端子台）は動かない
    const d1Before = lay2.ducts.find((d) => d.id === 1)!;
    const d1After = lay3.ducts.find((d) => d.id === 1)!;
    expect(d1After.y).toBeCloseTo(d1Before.y - 10, 5);
    expect(other.y).toBeCloseTo(lay2.placed.find((p) => p.uid === 'tb1')!.y, 5);
    // レールは 1 本のまま（寄せた機器まで伸びる）
    const rails = computeRails(lay3, devices, 20).filter((r) => r.row === 1 && !r.solo);
    expect(rails).toHaveLength(1);
    expect(rails[0]!.x + rails[0]!.length).toBeGreaterThanOrEqual(me.x + TB.size.w);
  });

  it('レールの帯の外（40mm 上）へ出した端子台は独立レールになり、ダクトを動かしてもその高さに留まる', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 6).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay1 = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const tb = lay1.placed.find((p) => p.uid === 'tb5')!;
    const moved = nudgeDevice(lay1, devices, face, nudgeDevice(lay1, devices, face, tb, 40, 0)!.placed, 0, 40)!.placed;
    expect(moved.onRail).toBe(false);
    const pinned: PlacedDevice[] = [moved];
    const prof2 = applyDuct(prof, 1, planDuctNudge(prof, autoLayout(panel(), prof, 'plate', items, pinned, devices, []), devices, 1, 0, -10).patch!);
    const lay3 = autoLayout(panel(), prof2, 'plate', items, pinned, devices, []);
    const me = lay3.placed.find((p) => p.uid === 'tb5')!;
    expect(me.y).toBeCloseTo(moved.y, 5);
    const rails = computeRails(lay3, devices, 20);
    expect(rails.some((r) => r.solo && r.row === 1)).toBe(true);
  });

  it('帯の外ぎりぎり（20mm 上）へ出した端子台は独立レールが共通レールに重なり、検査に出る。隣のレールは削られない', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 6).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay1 = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const tb = lay1.placed.find((p) => p.uid === 'tb2')!;
    const moved = nudgeDevice(lay1, devices, face, tb, 0, 20)!.placed;
    expect(moved.onRail).toBe(false);
    const lay2 = autoLayout(panel(), prof, 'plate', items, [moved], devices, []);
    expect(lay2.violations.some((v) => v.uid === 'tb2' && v.message.includes('DINレールが他のレールに重なって'))).toBe(true);
    // 隣の端子台は共通レールに乗ったまま（レールが切り刻まれない）
    const rails = computeRails(lay2, devices, 20);
    const common = rails.filter((r) => r.row === 1 && !r.solo);
    expect(common).toHaveLength(1);
    for (const uid of ['tb0', 'tb1', 'tb3', 'tb4', 'tb5']) {
      const q = lay2.placed.find((p) => p.uid === uid)!;
      expect(common[0]!.x <= q.x + 1e-6 && q.x + TB.size.w <= common[0]!.x + common[0]!.length + 1e-6, uid).toBe(true);
    }
  });

  it('ダクトを ↓ へ押し続けると、下の段の機器の離隔で止まり理由が出る。数字も変わらない', () => {
    // 1 段目 端子台、2 段目 遮断器（上の離隔 20）
    const items = [...dinItems(TB, 4), ...dinItems(MCCB, 2).map((i) => ({ ...i, row: 1 }))];
    let prof = profile();
    const notes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const lay = autoLayout(panel(), prof, 'plate', items, [], devices, []);
      const plan = planDuctNudge(prof, lay, devices, 1, 0, -1);
      if (plan.patch) prof = applyDuct(prof, 1, plan.patch);
      else notes.push(plan.note ?? '');
    }
    // 下の余白 15 は既に離隔 20 に負けているので 1 回目から止まる
    expect(notes).toHaveLength(5);
    expect(notes[0]).toContain('MCCB-75');
    expect(prof.duct.ductGaps[1]).toBeUndefined();
  });

  it('ダクトを ↑ へ動かすと、上の段の離隔ぶんまでは動き、その先で止まる', () => {
    // 1 段目 遮断器（下の離隔 20）、2 段目 端子台。ダクト 1 の上の余白を 30 にしておく
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 4).map((i) => ({ ...i, row: 1 }))];
    let prof = profile();
    prof = applyDuct(prof, 1, { above: 30 });
    let moved = 0;
    for (let i = 0; i < 20; i++) {
      const lay = autoLayout(panel(), prof, 'plate', items, [], devices, []);
      const plan = planDuctNudge(prof, lay, devices, 1, 0, 1);
      if (!plan.patch) break;
      prof = applyDuct(prof, 1, plan.patch);
      moved++;
    }
    expect(moved).toBe(10); // 30 → 20 で止まる
    expect(prof.duct.ductGaps[1]!.above).toBe(20);
  });

  it('ダクトを ← → で寄せても座標置きの機器は動かず、ダクトだけ短くなる', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 4).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay1 = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const pinned: PlacedDevice[] = [nudgeDevice(lay1, devices, face, lay1.placed.find((p) => p.uid === 'tb0')!, 300, 0)!.placed];
    // 右に 60 の余白を取ってあるダクトを → で 40 寄せる
    const prof1 = applyDuct(prof, 1, { right: 60 });
    const plan = planDuctNudge(prof1, lay1, devices, 1, 40, 0);
    expect(plan.patch).toEqual({ left: 40, right: 20 });
    const prof2 = applyDuct(prof1, 1, plan.patch!);
    const lay2 = autoLayout(panel(), prof2, 'plate', items, pinned, devices, []);
    const d1 = lay2.ducts.find((d) => d.id === 1)!;
    expect(d1.x).toBe(40);
    expect(d1.x + d1.w).toBe(520);
    expect(lay2.placed.find((p) => p.uid === 'tb0')!.x).toBeCloseTo(pinned[0]!.x, 5);
  });

  it('レールの手直しは機器を足したあとも同じ段・同じ本に残る', () => {
    const items = dinItems(TB, 4);
    const prof = profile();
    const lay1 = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const r1 = computeRails(lay1, devices, 20)[0]!;
    const plan = planRailNudge(r1, 'right', 10, 0, 540);
    const adjust = { [r1.key!]: { right: plan.delta } };
    const more = dinItems(TB, 6);
    const lay2 = autoLayout(panel(), prof, 'plate', more, [], devices, []);
    const r2 = computeRails(lay2, devices, 20, adjust)[0]!;
    expect(r2.x + r2.length).toBeCloseTo(6 * TB.size.w + 20 + 10, 5);
  });
});
