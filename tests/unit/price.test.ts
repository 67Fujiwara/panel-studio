import { describe, expect, it } from 'vitest';
import { priceLines, priceTotal, quoteRequestCsv } from '../../src/lib/price';
import type { BomLine } from '../../src/types';

const lines: BomLine[] = [
  { model: 'NF63-SV 3P 60A', maker: '三菱電機', name: '配線用遮断器', qty: 2, unit: '個', source: 'device' },
  { model: 'DINレール TH35-7.5（切断 計170mm / 1本）', maker: '—', name: 'DINレール', qty: 1, unit: '本', source: 'derived', key: 'TH35-7.5' },
];

describe('見積依頼 CSV', () => {
  it('見出しは 注文番号・品名・型番・メーカー名・数量・希望出荷日 の順で、品名が型番の前にある', () => {
    const csv = quoteRequestCsv(lines, { orderNo: 'A-1', shipDate: '2026/12/01' });
    const [head, first] = csv.split(/\r?\n/);
    const cols = head!.split(',').map((c) => c.replace(/^"|"$/g, ''));
    expect(cols.indexOf('品名')).toBeGreaterThan(cols.indexOf('お客さま注文番号'));
    expect(cols.indexOf('品名')).toBeLessThan(cols.indexOf('型番（必須）'));
    expect(first).toContain('配線用遮断器');
    expect(first).toContain('NF63-SV 3P 60A');
  });
});

describe('単価引き', () => {
  it('単価が無い機器は不明に数え、派生部品は対象外', () => {
    const priced = priceLines(lines, { 'NF63-SV 3P 60A': { unit: 1000 } } as never);
    const total = priceTotal(priced);
    expect(total.total).toBe(2000);
    expect(total.missing).toBe(0);
    const none = priceTotal(priceLines(lines, {} as never));
    expect(none.missing).toBe(1);
  });
});
