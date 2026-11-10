/**
 * 微調整をでたらめな順番で繰り返し、崩れてはいけないこと（不変条件）を確かめる。
 *
 * - 流し込みの機器どうしは重ならない。ダクトにも掛からない
 * - レールから外した座標置きは、ダクトを動かしても動かない
 * - レールに乗ったまま（onRail）の座標置きは、その段の機器と同じレールの高さに居る
 * - DIN 機器はどれかのレールの上に居る。レールは面の外へ出ない
 * - ダクトを ↑ してから ↓ すると余白が元に戻る
 * 乱数は種を固定しているので、落ちたら同じ手順で再現できる
 */
import { describe, expect, it } from 'vitest';
import { autoLayout, computeRails, isOnRowRail, nudgeDevice, planDuctNudge, planRailNudge } from '../../src/lib/layout';
import { DIN_RAIL_WIDTH } from '../../src/data/enclosures';
import { rotatedSize } from '../../src/types';
import type { PlacedDevice, Profile, RailAdjust } from '../../src/types';
import { MCCB, PSU, TB, dinItems, lookup, panel, profile } from './helpers';

const face = { w: 540, h: 740 };
const devices = lookup(MCCB, TB, PSU);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type World = { prof: Profile; pinned: PlacedDevice[]; adjust: Record<string, RailAdjust> };

function invariants(world: World, items: ReturnType<typeof dinItems>, label: string) {
  const lay = autoLayout(panel(), world.prof, 'plate', items, world.pinned, devices, []);
  const pinnedUids = new Set(world.pinned.map((p) => p.uid));
  // 流し込みの機器どうし・流し込みとダクトは重ならない
  for (const v of lay.violations) {
    if (v.kind === 'overlap' && !pinnedUids.has(v.uid)) {
      // 相手が座標置きなら、座標置きの側が悪い（人が置いた位置）。流し込みどうしの重なりだけを拾う
      const other = lay.placed.find((q) => q.uid !== v.uid && v.message.includes(devices.get(q.specId)!.model));
      if (other && !pinnedUids.has(other.uid)) throw new Error(`${label}: 流し込みが重なった: ${v.message}`);
    }
  }
  const rails = computeRails(lay, devices, 20, world.adjust);
  for (const r of rails) {
    expect(r.x, `${label}: レールが左へはみ出た`).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x + r.length, `${label}: レールが右へはみ出た`).toBeLessThanOrEqual(face.w + 1e-6);
  }
  for (const p of lay.placed) {
    const spec = devices.get(p.specId)!;
    if (p.mount !== 'din') continue;
    const s = rotatedSize(spec.size, p.rot);
    const railY = p.y + s.h / 2 - (spec.dinOffset ?? 0);
    const on = rails.some((r) => Math.abs(r.y - railY) < DIN_RAIL_WIDTH / 2 && r.x <= p.x + 1e-6 && p.x + s.w <= r.x + r.length + 1e-6);
    expect(on, `${label}: ${p.uid} がレールに乗っていない`).toBe(true);
    const pin = world.pinned.find((q) => q.uid === p.uid);
    if (pin && pin.onRail) {
      const row = lay.rows.find((r) => r.index === p.row)!;
      expect(isOnRowRail(p.y, spec, p.rot, row), `${label}: onRail の ${p.uid} がレールの高さから外れた`).toBe(true);
    }
    if (pin && pin.onRail === false) {
      expect(p.y, `${label}: レールから外した ${p.uid} が動いた`).toBeCloseTo(pin.y, 6);
      expect(p.x).toBeCloseTo(pin.x, 6);
    }
  }
  return lay;
}

describe('微調整をでたらめに繰り返しても崩れない', () => {
  for (const seed of [1, 2, 3, 7, 11]) {
    it(`種 ${seed}`, () => {
      const rand = rng(seed);
      const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
      const items = [
        ...dinItems(MCCB, 2),
        ...dinItems(TB, 10).map((i) => ({ ...i, row: 1 })),
        ...dinItems(MCCB, 1, 'm2').map((i) => ({ ...i, row: 2 })),
        ...dinItems(TB, 6, 't2').map((i) => ({ ...i, row: 2 })),
      ];
      const world: World = { prof: profile(), pinned: [], adjust: {} };
      let lay = invariants(world, items, 'start');
      for (let step = 0; step < 60; step++) {
        const op = pick(['dev-x', 'dev-x', 'dev-y', 'duct-y', 'duct-y', 'duct-x', 'rail'] as const);
        const label = `種 ${seed} 手 ${step} ${op}`;
        if (op === 'dev-x' || op === 'dev-y') {
          const p = pick(lay.placed.filter((q) => q.mount === 'din'));
          // dev-y は 1mm（帯の中→戻る）か 40mm（帯の外→独立レール）
          const moved = nudgeDevice(lay, devices, face, p, op === 'dev-x' ? pick([-10, -1, 1, 10]) : 0, op === 'dev-y' ? pick([-40, -1, 1, 40]) : 0)!.placed;
          world.pinned = [...world.pinned.filter((q) => q.uid !== moved.uid), moved];
        } else if (op === 'duct-y' || op === 'duct-x') {
          const horizontals = lay.ducts.filter((d) => d.vert === undefined).map((d) => d.id);
          const target = pick(horizontals.filter((id) => id > 0));
          const last = Math.max(...horizontals);
          const dx = op === 'duct-x' ? pick([-10, 10]) : 0;
          const dy = op === 'duct-y' ? pick([-10, -1, 1, 10]) : 0;
          const plan = planDuctNudge(world.prof, lay, devices, target, dx, dy, target === last ? 'bottom' : undefined);
          if (plan.patch) {
            const gaps = { ...world.prof.duct.ductGaps, [target]: { ...(world.prof.duct.ductGaps[target] ?? {}), ...plan.patch } };
            world.prof = { ...world.prof, duct: { ...world.prof.duct, ductGaps: gaps } };
            // 余白が負になっていない
            for (const g of Object.values(gaps)) {
              for (const v of [g.above, g.below]) if (v !== undefined) expect(v, `${label}: 余白が負`).toBeGreaterThanOrEqual(0);
            }
          }
        } else {
          const rails = computeRails(lay, devices, 20, world.adjust).filter((r) => r.key && r.bounds);
          if (rails.length === 0) continue;
          const r = pick(rails);
          const end = pick(['left', 'right'] as const);
          const plan = planRailNudge(r, end, pick([-10, -1, 1, 10]), 0, face.w);
          if (plan.delta) world.adjust = { ...world.adjust, [r.key!]: { ...world.adjust[r.key!], [end]: (world.adjust[r.key!]?.[end] ?? 0) + plan.delta } };
        }
        lay = invariants(world, items, label);
      }
    });
  }

  it('ダクトを ↑ してから同じだけ ↓ すると余白が元に戻る', () => {
    const items = [...dinItems(TB, 4), ...dinItems(TB, 4, 'b').map((i) => ({ ...i, row: 1 }))];
    let prof = profile();
    prof = { ...prof, duct: { ...prof.duct, ductGaps: { 1: { above: 30, below: 30 } } } };
    const lay = autoLayout(panel(), prof, 'plate', items, [], devices, []);
    const up = planDuctNudge(prof, lay, devices, 1, 0, 7).patch!;
    const prof2 = { ...prof, duct: { ...prof.duct, ductGaps: { 1: { ...prof.duct.ductGaps[1], ...up } } } };
    const lay2 = autoLayout(panel(), prof2, 'plate', items, [], devices, []);
    const down = planDuctNudge(prof2, lay2, devices, 1, 0, -7).patch!;
    expect({ ...prof2.duct.ductGaps[1], ...down }).toEqual({ above: 30, below: 30 });
  });
});
