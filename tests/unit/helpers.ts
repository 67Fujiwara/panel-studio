/**
 * 単体テストの部品。既定の部品表に依存せず、寸法が分かりやすい機器を自前で持つ。
 * 盤は新規作成時の 600×800（中板 540×740）、設定は既定値を複製して使う。
 */
import { BLANK_PANEL, DEFAULT_PROFILE } from '../../src/data/enclosures';
import type { LayoutItem } from '../../src/lib/layout';
import type { DeviceLookup } from '../../src/lib/layout';
import type { DeviceSpec, PanelSpec, Profile } from '../../src/types';

/** 端子台: 幅 5.2 × 高さ 55。8 台で 41.6mm */
export const TB: DeviceSpec = {
  id: 'tb',
  maker: 'テスト',
  model: 'TB-5',
  name: '端子台',
  category: 'terminal',
  size: { w: 5.2, h: 55, d: 50 },
  mount: ['din'],
};

/** 遮断器: 幅 75 × 高さ 130 */
export const MCCB: DeviceSpec = {
  id: 'mccb',
  maker: 'テスト',
  model: 'MCCB-75',
  name: '配線用遮断器',
  category: 'breaker',
  size: { w: 75, h: 130, d: 68 },
  mount: ['din', 'direct'],
  clearance: { top: 20, bottom: 20 },
  heatW: 6,
};

/** 直付けの電源: 幅 120 × 高さ 120 */
export const PSU: DeviceSpec = {
  id: 'psu',
  maker: 'テスト',
  model: 'PSU-120',
  name: '電源',
  category: 'psu',
  size: { w: 120, h: 120, d: 100 },
  mount: ['direct'],
  heatW: 30,
};

export function lookup(...specs: DeviceSpec[]): DeviceLookup {
  return new Map(specs.map((s) => [s.id, s]));
}

export function panel(): PanelSpec {
  return structuredClone(BLANK_PANEL);
}

export function profile(): Profile {
  return structuredClone(DEFAULT_PROFILE);
}

/** 中板に DIN 取付で n 台並べる items */
export function dinItems(spec: DeviceSpec, n: number, prefix = spec.id): LayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    uid: `${prefix}${i}`,
    specId: spec.id,
    face: 'plate' as const,
    mount: 'din' as const,
  }));
}
