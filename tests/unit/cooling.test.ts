import { describe, expect, it } from 'vitest';
import { checkCoolingInput, coolingCalc, effectiveArea } from '../../src/lib/cooling';

/** 仕様書のテストケース 5 件。数値は仕様書の期待値そのまま */
const base = { material: 'steel' as const, wMm: 800, hMm: 1800, dMm: 400, ta: 35, ti: 40 };
const r = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

describe('ファン／クーラー選定の計算', () => {
  it('ケース 1: 単独・背面壁・清浄・330W → フィルターファン 3.04 m³/min', () => {
    const c = coolingCalc({ ...base, mount: 'single_wall', env: 'clean', qv: 330 });
    expect(r(c.A, 3)).toBe(3.76);
    expect(r(c.Qs, 1)).toBe(103.4);
    expect(r(c.vh, 1)).toBe(140.5);
    expect(r(c.selectVmin, 2)).toBe(3.04);
    expect(c.method).toBe('fan');
  });

  it('ケース 2: 目標温度を 45℃ に上げると風量が減る', () => {
    const c = coolingCalc({ ...base, mount: 'single_wall', env: 'clean', qv: 330, ti: 45 });
    expect(r(c.Qs, 1)).toBe(206.8);
    expect(r(c.vh, 1)).toBe(38.2);
    expect(r(c.selectVmin, 2)).toBe(0.83);
    expect(c.method).toBe('fan');
  });

  it('ケース 3: 自然放熱で足りれば冷却不要', () => {
    const c = coolingCalc({ ...base, mount: 'single_wall', env: 'clean', qv: 100, ti: 45 });
    expect(c.method).toBe('none');
    expect(c.Qnet).toBeLessThan(0);
  });

  it('ケース 4: 粉塵環境ではファン不可 → 熱交換器 12.3 W/K', () => {
    const c = coolingCalc({ ...base, mount: 'single_wall', env: 'dust', qv: 330, ti: 45 });
    expect(c.method).toBe('heat_exchanger');
    expect(r(c.hexCap, 1)).toBe(12.3);
  });

  it('ケース 5: 外気温が目標以上なら盤用クーラー 371.4 W', () => {
    const c = coolingCalc({ ...base, mount: 'single_wall', env: 'clean', qv: 330, ta: 40, ti: 38 });
    expect(c.method).toBe('cooler');
    expect(r(c.coolerCap, 1)).toBe(371.4);
  });

  it('有効放熱面積は IEC 60890 の式で、ふさがる面が増えるほど小さい', () => {
    const free = effectiveArea('single_free', 0.8, 1.8, 0.4);
    const wall = effectiveArea('single_wall', 0.8, 1.8, 0.4);
    const roof = effectiveArea('middle_wall_roof', 0.8, 1.8, 0.4);
    expect(free).toBeGreaterThan(wall);
    expect(wall).toBeGreaterThan(roof);
  });

  it('入力チェック: Ti ≤ Ta は警告、範囲外の寸法はエラー', () => {
    const warn = checkCoolingInput({ ...base, mount: 'single_wall', env: 'clean', qv: 330, ta: 40, ti: 38 });
    expect(warn.warnings.length).toBeGreaterThan(0);
    const bad = checkCoolingInput({ ...base, mount: 'single_wall', env: 'clean', qv: 330, wMm: 50 });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.bad.has('wMm')).toBe(true);
  });
});
