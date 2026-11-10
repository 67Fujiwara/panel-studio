import { describe, expect, it } from 'vitest';
import {
  autoLayout,
  computeRails,
  ductKeyMove,
  nudgeDevice,
  planDuctNudge,
  planRailNudge,
  planVertNudge,
} from '../../src/lib/layout';
import { MCCB, TB, dinItems, lookup, panel, profile } from './helpers';

const face = { w: 540, h: 740 };

describe('機器の矢印キー（nudgeDevice）', () => {
  it('左右に寄せただけなら座標置きになるがレールには乗ったまま（onRail）', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(TB, 4), [], lookup(TB), []);
    const p = lay.placed[0]!;
    const moved = nudgeDevice(lay, lookup(TB), face, p, 10, 0)!.placed;
    expect(moved.x).toBeCloseTo(p.x + 10, 5);
    expect(moved.y).toBeCloseTo(p.y, 5);
    expect(moved.pinned).toBe(true);
    expect(moved.onRail).toBe(true);
  });

  it('上下に少し動かしてもレールの帯の中なら元の高さに戻り、理由が付く（DIN 機器はレールから浮かせられない）', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(TB, 4), [], lookup(TB), []);
    const p = lay.placed[0]!;
    const up1 = nudgeDevice(lay, lookup(TB), face, p, 0, 1)!;
    expect(up1.placed.onRail).toBe(true);
    expect(up1.placed.y).toBeCloseTo(p.y, 5);
    expect(up1.note).toContain('レールの高さから外せません');
    const up10 = nudgeDevice(lay, lookup(TB), face, p, 0, 10)!;
    expect(up10.placed.y).toBeCloseTo(p.y, 5);
    // レールの帯（±17.5）を越えれば外れて独立レールになる
    const far = nudgeDevice(lay, lookup(TB), face, p, 0, 40)!;
    expect(far.placed.onRail).toBe(false);
    expect(far.placed.y).toBeCloseTo(p.y + 40, 5);
    expect(far.note).toBeNull();
  });

  it('面の外へは出ない', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(MCCB, 1), [], lookup(MCCB), []);
    const p = lay.placed[0]!;
    expect(nudgeDevice(lay, lookup(MCCB), face, p, -1000, 0)!.placed.x).toBe(0);
    expect(nudgeDevice(lay, lookup(MCCB), face, p, 1000, 0)!.placed.x).toBeCloseTo(540 - 75, 5);
    expect(nudgeDevice(lay, lookup(MCCB), face, p, 0, 1000)!.placed.y).toBeCloseTo(740 - 130, 5);
  });
});

describe('横ダクトの矢印キー（planDuctNudge）', () => {
  const twoRows = () => {
    // 1 段目 遮断器（離隔 上下 20）、2 段目 端子台（離隔なし）
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 4).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay = autoLayout(panel(), prof, 'plate', items, [], lookup(MCCB, TB), []);
    return { items, prof, lay };
  };

  it('← → は左右の余白を同時に付け替えて全体をずらし、面の外へは出ない', () => {
    const { prof, lay } = twoRows();
    // 余白が両方 0（面いっぱい）のダクトは、どちらへもずらせない（面の外へ出るため）
    const full = planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 10, 0);
    expect(full.patch).toBeNull();
    expect(full.note).toBeNull();
    // 右に 60 の余白があれば、右へ 10 寄せて 左 10 / 右 50 になる
    prof.duct.ductGaps = { 1: { right: 60 } };
    expect(planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 10, 0).patch).toEqual({ left: 10, right: 50 });
    // 右へ 100 は余白 60 で止まる
    expect(planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 100, 0).patch).toEqual({ left: 60, right: 0 });
  });

  it('↓ は上の余白を増やし下の余白を減らす。下の段の離隔が効いていれば止まり、理由にその機器が出る', () => {
    const { prof, lay } = twoRows();
    // ダクト 1 の下は 2 段目の端子台（離隔なし）なので下へ動く。
    // 上の余白は効いている値（遮断器の離隔 20）を基準に 21 になる（設定の 15 + 1 ではない）
    const down = planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 0, -1);
    expect(down.patch).toEqual({ above: 21, below: 14 });
    // ダクト 1 の上は 1 段目の遮断器（下 20）。余白 15 < 20 なので上へは動けない
    const up = planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 0, 1);
    expect(up.patch).toBeNull();
    expect(up.note).toContain('MCCB-75');
    expect(up.note).toContain('20mm');
  });

  it('効いている余白（max(余白, 離隔)）を基準に付け替える', () => {
    // 端子台を 1 段目、遮断器を 2 段目に。ダクト 1 の下の段（遮断器）の離隔 上 20 が効いている
    const items = [...dinItems(TB, 4), ...dinItems(MCCB, 2).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay = autoLayout(panel(), prof, 'plate', items, [], lookup(MCCB, TB), []);
    const up = planDuctNudge(prof, lay, lookup(MCCB, TB), 1, 0, 1);
    // 上の段は端子台なので上へ動ける。下の余白は効いている 20 を基準に 21 になる（15+1 ではない）
    expect(up.patch).toEqual({ above: 14, below: 21 });
  });

  it('最下段のダクト（edge: bottom）は上の余白だけ動かし、下へはいくらでも動く', () => {
    const { prof, lay } = twoRows();
    const plan = planDuctNudge(prof, lay, lookup(MCCB, TB), 2, 0, -30, 'bottom');
    expect(plan.patch).toEqual({ above: 45 });
  });
});

describe('ダクトの選択とキーの読み替え（ductKeyMove）', () => {
  it('いちばん上のダクトと「全段そろえる」は上下に動かず、最下段は edge: bottom、縦ダクトは左右だけ', () => {
    const items = [...dinItems(MCCB, 2), ...dinItems(TB, 4).map((i) => ({ ...i, row: 1 }))];
    const prof = profile();
    const lay = autoLayout(panel(), prof, 'plate', items, [], lookup(MCCB, TB), []);
    const horizontal = lay.ducts.filter((d) => d.vert === undefined);
    expect(ductKeyMove(lay, prof, horizontal[0]!, 1, 1)).toEqual({ target: 0, dx: 1, dy: 0, edge: undefined });
    expect(ductKeyMove(lay, prof, horizontal[1]!, 0, -1)).toEqual({ target: 1, dx: 0, dy: -1, edge: undefined });
    expect(ductKeyMove(lay, prof, horizontal[2]!, 0, 1)).toEqual({ target: 2, dx: 0, dy: 1, edge: 'bottom' });
    const equal = profile();
    equal.duct.rowHeightMode = 'equal';
    expect(ductKeyMove(lay, equal, horizontal[1]!, 0, 1).dy).toBe(0);
    expect(ductKeyMove(lay, prof, { id: 9, vert: 0, x: 0, y: 0, w: 50, h: 740 }, 3, 3)).toEqual({ target: { vert: 0 }, dx: 3, dy: 0 });
  });
});

describe('縦ダクトの矢印キー（planVertNudge）', () => {
  it('帯が面の外へ出る分は溜めない', () => {
    const prof = profile();
    prof.duct.layout = 'horizontal-left'; // 左端に縦ダクト 1 本
    expect(planVertNudge(panel(), 'plate', prof, 0, -10)).toBe(0);
    expect(planVertNudge(panel(), 'plate', prof, 0, 10)).toBe(10);
    expect(planVertNudge(panel(), 'plate', prof, 0, 10000)).toBe(540 - 50);
  });
});

describe('DINレールの端の矢印キー（planRailNudge）', () => {
  it('外へ伸ばせて、機器より内側へは縮まない。↑↓ は案内だけ', () => {
    const lay = autoLayout(panel(), profile(), 'plate', dinItems(MCCB, 2), [], lookup(MCCB), []);
    const r = computeRails(lay, lookup(MCCB), 20)[0]!; // 0..170、機器は 0..150
    expect(planRailNudge(r, 'right', 10, 0, 540)).toEqual({ delta: 10, note: null });
    expect(planRailNudge(r, 'right', -30, 0, 540)).toEqual({ delta: -20, note: null });
    const shrink = planRailNudge({ ...r, length: 150 }, 'right', -1, 0, 540);
    expect(shrink.delta).toBe(0);
    expect(shrink.note).toContain('縮められません');
    // 左端は面の端 0 なので伸ばせない
    const left = planRailNudge(r, 'left', -1, 0, 540);
    expect(left.delta).toBe(0);
    expect(left.note).toContain('伸ばせません');
    expect(planRailNudge(r, 'right', 0, 1, 540).note).toContain('ダクトを選んで');
  });
});
