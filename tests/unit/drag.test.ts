import { describe, expect, it } from 'vitest';
import {
  autoLayout,
  decideDrag,
  dodgeDucts,
  dropTarget,
  freeSpotOnRail,
  snapStopperToDevice,
  snapToSoloRails,
} from '../../src/lib/layout';
import type { DragContext, Dragged } from '../../src/lib/layout';
import type { DeviceSpec } from '../../src/types';
import { MCCB, TB, dinItems, lookup, panel, profile } from './helpers';

/** 止め金具（名前で見分ける） */
const STOPPER: DeviceSpec = {
  id: 'stop',
  maker: 'テスト',
  model: 'CLIPFIX 35',
  name: 'エンドストッパ',
  category: 'terminal',
  size: { w: 8, h: 45, d: 50 },
  mount: ['din'],
};
/** 独立レール取付のインバータ */
const INV: DeviceSpec = {
  id: 'inv',
  maker: 'テスト',
  model: 'INV',
  name: 'インバータ',
  category: 'other',
  size: { w: 70, h: 140, d: 120 },
  mount: ['din-solo'],
};

function ctxOf(specs: DeviceSpec[], items: ReturnType<typeof dinItems>, pinned: Parameters<typeof autoLayout>[4] = []): DragContext {
  const devices = lookup(...specs);
  const prof = profile();
  const layout = autoLayout(panel(), prof, 'plate', items, pinned, devices, []);
  return { layout, devices, profile: prof, face: { w: 540, h: 740 }, hasRows: true };
}

const dragged = (ctx: DragContext, uid: string, x: number, y: number, cursor = { x: x + 1, y: y + 1 }): Dragged => {
  const placed = ctx.layout.placed.find((p) => p.uid === uid)!;
  const spec = ctx.devices.get(placed.specId)!;
  return { placed, size: { w: spec.size.w, h: spec.size.h }, x, y, cursor };
};

describe('ダクトを避ける（dodgeDucts）', () => {
  it('横ダクトに掛かる位置は、中心が近いほうの上下へ押し出す', () => {
    const ctx = ctxOf([MCCB], dinItems(MCCB, 1));
    const duct = ctx.layout.ducts.find((d) => d.id === 1)!; // 1 段目の下のダクト
    const size = { w: 20, h: 30 };
    // 中心がダクトの中心より上 → ダクトの上端へ
    const up = dodgeDucts(ctx, 100, duct.y + duct.h / 2 - size.h / 2 + 5, size);
    expect(up.y).toBeCloseTo(duct.y + duct.h, 5);
    // 中心がダクトの中心より下 → ダクトの下へ
    const down = dodgeDucts(ctx, 100, duct.y + duct.h / 2 - size.h / 2 - 5, size);
    expect(down.y).toBeCloseTo(duct.y - size.h, 5);
  });
});

describe('止め金具の密着（snapStopperToDevice）', () => {
  it('機器の右隣に近づけると、離隔なしでその右端に付き、レールの高さも揃う', () => {
    const ctx = ctxOf([MCCB, STOPPER], [...dinItems(MCCB, 1), ...dinItems(STOPPER, 1)]);
    const m = ctx.layout.placed.find((p) => p.specId === 'mccb')!;
    // レール（機器の中心）の高さの近く、右端から 12mm 離れたところへ
    const d = dragged(ctx, 'stop0', m.x + 75 + 12, m.y + 130 / 2 - 45 / 2 + 6);
    const s = snapStopperToDevice(ctx, d)!;
    expect(s.x).toBeCloseTo(m.x + 75, 5);
    // レール中心（機器の中心）に合わせる
    expect(s.y + 45 / 2).toBeCloseTo(m.y + 130 / 2, 5);
  });

  it('遠ければ吸い付かない', () => {
    const ctx = ctxOf([MCCB, STOPPER], [...dinItems(MCCB, 1), ...dinItems(STOPPER, 1)]);
    const m = ctx.layout.placed.find((p) => p.specId === 'mccb')!;
    expect(snapStopperToDevice(ctx, dragged(ctx, 'stop0', m.x + 75 + 60, m.y))).toBeNull();
  });
});

describe('独立レールへの吸い付き（snapToSoloRails）', () => {
  it('独立レールの機器の隣へ近づけると、レールの端にストッパ 5mm ぶん空けて付く', () => {
    // 独立レール取付は mount を din-solo にする（dinItems は din にするので直す）
    const ctx = ctxOf([INV, TB], [...dinItems(INV, 1).map((i) => ({ ...i, mount: 'din-solo' as const })), ...dinItems(TB, 1)]);
    const inv = ctx.layout.placed.find((p) => p.specId === 'inv')!;
    // インバータのレールは機器幅＋両端 5mm。その右端 +5 が吸い付く先。高さはレール中心（機器の中心）に合わせる
    const d = dragged(ctx, 'tb0', inv.x + 70 + 5 + 12, inv.y + 140 / 2 - 55 / 2 + 8);
    const s = snapToSoloRails(ctx, d)!;
    expect(s.x).toBeCloseTo(inv.x + 70 + 5 + 5, 5);
  });
});

describe('空いた場所への座標置き（freeSpotOnRail）と入れ込み先（dropTarget）', () => {
  it('隣の機器から 20mm より離れていれば置き場を返し、20mm 以内なら null（並べ替え）', () => {
    const ctx = ctxOf([TB], dinItems(TB, 4)); // 0..20.8
    const far = dragged(ctx, 'tb3', 100, 10);
    expect(freeSpotOnRail(ctx, far)).toMatchObject({ x: 100, row: 0 });
    const near = dragged(ctx, 'tb3', 20.8 + 10, 10);
    expect(freeSpotOnRail(ctx, near)).toBeNull();
  });

  it('入れ込み先は「中心より左にポインタがある最初の機器」。右端より右なら末尾', () => {
    const ctx = ctxOf([TB], dinItems(TB, 4));
    const rowY = ctx.layout.rows[0]!.y + 10;
    expect(dropTarget(ctx, { x: 1, y: rowY }, 'tb3').before).toBe('tb0');
    expect(dropTarget(ctx, { x: 500, y: rowY }, 'tb3').before).toBeNull();
    expect(dropTarget(ctx, { x: 500, y: rowY }, 'tb3').zone).toBeUndefined();
  });
});

describe('ドラッグ 1 コマの決定（decideDrag）', () => {
  it('Shift ドラッグは座標置き（ダクトは避ける）', () => {
    const ctx = ctxOf([MCCB], dinItems(MCCB, 1));
    const duct = ctx.layout.ducts.find((d) => d.id === 1)!;
    const d = dragged(ctx, 'mccb0', 200, duct.y + 5);
    const out = decideDrag(ctx, d, true, false);
    expect(out.kind).toBe('pin');
    if (out.kind === 'pin') {
      expect(out.placed.pinned).toBe(true);
      expect(out.placed.y === duct.y + duct.h || out.placed.y === duct.y - 130).toBe(true);
    }
  });

  it('ふつうのドラッグ: 空いた場所なら座標置き（レールに乗ったまま）、隣の近くなら並べ替え、吸い付きから離れたら戻す', () => {
    const ctx = ctxOf([TB], dinItems(TB, 4));
    const rowY = ctx.layout.rows[0]!.y + 10;
    const free = decideDrag(ctx, dragged(ctx, 'tb3', 200, rowY, { x: 201, y: rowY }), false, false);
    expect(free.kind).toBe('pin');
    if (free.kind === 'pin') expect(free.placed).toMatchObject({ x: 200, row: 0, onRail: true, pinned: true });
    const near = decideDrag(ctx, dragged(ctx, 'tb3', 1, rowY, { x: 1, y: rowY }), false, false);
    expect(near).toEqual({ kind: 'reorder', row: 0, before: 'tb0', zone: undefined });
    const away = decideDrag(ctx, dragged(ctx, 'tb3', 200, rowY), false, true);
    expect(away.kind).toBe('unpin');
  });
});
