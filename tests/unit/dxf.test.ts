import { describe, expect, it } from 'vitest';
import { cabistaFaceDxf, plateDxf, type ExportInput } from '../../src/lib/dxfExport';
import type { DeviceSpec, Machining } from '../../src/types';
import { lookup, panel, profile } from './helpers';

/** 外形線が三角形の機器。c=true なら閉じた 3 辺、false なら 2 辺 */
function triangle(closed: boolean): DeviceSpec {
  return {
    id: 'tri',
    maker: 'テスト',
    model: 'TRI',
    name: '三角',
    category: 'other',
    size: { w: 60, h: 60, d: 30 },
    mount: ['direct'],
    shape: { w: 60, h: 60, entities: [{ t: 'p', pts: [0, 0, 60, 0, 30, 60], c: closed }] },
  };
}

function input(spec: DeviceSpec, machining: Machining[] = []): ExportInput {
  return {
    panel: panel(),
    profile: profile(),
    items: [{ uid: 'd1', specId: spec.id, face: 'plate', mount: 'direct' }],
    pinned: [{ uid: 'd1', specId: spec.id, face: 'plate', mount: 'direct', x: 100, y: 100, row: -1, pinned: true }],
    machining,
    removedDucts: {},
    underlays: {},
    devices: lookup(spec),
    ducts: [],
  };
}

const count = (dxf: string, entity: string) => dxf.split('\n').filter((l) => l.trim() === entity).length;

describe('DXF 書き出し', () => {
  it('閉じた折れ線は閉じる辺も線として出る（線が 1 本消えない）', () => {
    const open = count(plateDxf(input(triangle(false)), 'full'), 'LINE');
    const closed = count(plateDxf(input(triangle(true)), 'full'), 'LINE');
    expect(closed - open).toBe(1);
  });

  it('タップ穴は二重丸（呼び径と下穴）で、キャビスタ用でも同じ穴が出る', () => {
    const hole: Machining = { id: 'm1', face: 'plate', kind: 'hole', x: 200, y: 200, dia: 3.3, tap: 'M4' };
    const full = plateDxf(input(triangle(true), [hole]), 'holes');
    const cabista = cabistaFaceDxf(input(triangle(true), [hole]), 'plate');
    expect(count(full, 'CIRCLE')).toBeGreaterThanOrEqual(2);
    expect(count(cabista, 'CIRCLE')).toBe(count(full, 'CIRCLE'));
    expect(cabista.trim().endsWith('EOF')).toBe(true);
  });
});
