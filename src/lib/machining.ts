import { DEVICE_BY_ID } from '../data/devices';
import type { Machining, PlacedDevice } from '../types';

/**
 * 機器から自動で決まる加工。
 *
 * 押ボタンを置けば φ22 の穴、表示器を置けば角穴、というように
 * 機器マスタの panelCutout から座標付きで導出する。手で座標を拾う必要をなくすのが狙い。
 * 導出結果は保存せず、配置から毎回計算する（配置を動かせば加工もついてくる）。
 */
export function derivedMachining(placed: PlacedDevice[]): Machining[] {
  const out: Machining[] = [];
  for (const p of placed) {
    const spec = DEVICE_BY_ID.get(p.specId);
    const cut = spec?.panelCutout;
    if (!spec || !cut) continue;
    const cx = p.x + spec.size.w / 2;
    const cy = p.y + spec.size.h / 2;
    if (cut.kind === 'hole') {
      out.push({
        id: `auto-${p.uid}`,
        face: p.face,
        kind: 'hole',
        x: round(cx),
        y: round(cy),
        dia: cut.dia,
        note: spec.model,
      });
    } else {
      out.push({
        id: `auto-${p.uid}`,
        face: p.face,
        kind: 'notch',
        x: round(cx - cut.w / 2),
        y: round(cy - cut.h / 2),
        w: cut.w,
        h: cut.h,
        note: spec.model,
      });
    }
  }
  return out;
}

const round = (v: number) => Number(v.toFixed(1));

/** 自動導出ぶんは編集できない。ID の接頭辞で見分ける。 */
export const isDerived = (m: Machining) => m.id.startsWith('auto-');

/** 同じ寸法の加工をまとめた集計（加工指示に使う）。 */
export function summarizeMachining(items: Machining[]): { label: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const m of items) {
    const key = m.kind === 'hole' ? `φ${m.dia} 穴` : `${m.w}×${m.h} 角穴`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map].map(([label, qty]) => ({ label, qty })).sort((a, b) => b.qty - a.qty);
}
