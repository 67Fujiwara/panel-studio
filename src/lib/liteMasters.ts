/**
 * 部品表・My部品の外形線をまとめて軽くする（shapeLite を全部にかける）。
 *
 * 手で押すボタンにはしない。起動時・読み込み時・部品表が変わったときに
 * 自動で通る。済みの印（shape.lite）が付いたものは素通りするので、
 * 2回目以降はほぼ何もしない。
 */
import { useStore } from '../store';
import { liteShape, shapePoints } from './shapeLite';

export type LiteSummary = {
  parts: number;
  before: number;
  after: number;
  ptsBefore: number;
  ptsAfter: number;
};

export function liteMasters(): LiteSummary {
  const s = useStore.getState();
  const sum: LiteSummary = { parts: 0, before: 0, after: 0, ptsBefore: 0, ptsAfter: 0 };
  for (const d of [...s.devices, ...s.myDevices]) {
    const patch: { shape?: typeof d.shape; sideShape?: typeof d.sideShape } = {};
    for (const k of ['shape', 'sideShape'] as const) {
      const sh = d[k];
      if (!sh || sh.lite) continue;
      const r = liteShape(sh);
      sum.before += r.before;
      sum.after += r.after;
      sum.ptsBefore += shapePoints(sh);
      sum.ptsAfter += shapePoints(r.shape);
      patch[k] = r.shape;
    }
    if (Object.keys(patch).length > 0) {
      s.updatePart(d.id, patch);
      sum.parts++;
    }
  }
  return sum;
}
