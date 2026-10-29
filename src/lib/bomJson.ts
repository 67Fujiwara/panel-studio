/**
 * BOM Pro（購買・見積のツール）へ渡す部品表の JSON。
 *
 * 設計完了の ZIP に `<案件>_bom.json` として入る。BOM Pro の「新規作成 → Panel Studio から取り込む」に
 * ZIP（または中のこの JSON）を渡すと、案件と部品の行（下書き）がまとまって入る。
 * 中身は画面の部品表（buildBom）と同じ行で、機器本体 `device` と派生部品 `derived`（DINレール・ダクト等）を含む。
 */
import type { BomLine, PanelSpec } from '../types';
import type { ElectraJob } from './electraExport';

/** ファイル形式の名前と版。BOM Pro 側はこれを見て読めるか判断する */
export const BOM_JSON_FORMAT = 'panel-studio/bom';
export const BOM_JSON_VERSION = 1;

export function bomJson(bom: BomLine[], job: ElectraJob, panel: PanelSpec): string {
  return JSON.stringify({
    format: BOM_JSON_FORMAT,
    version: BOM_JSON_VERSION,
    generator: 'Panel Studio',
    exportedAt: new Date().toISOString(),
    job: { company: job.company, jobNo: job.jobNo, owner: job.owner, completedAt: job.completedAt, note: job.note },
    // 装置名は設計完了では聞かない。盤の型式を候補に出す（BOM Pro の取り込み画面で直せる）
    deviceName: '',
    panel: { model: panel.model },
    lines: bom.map((l) => ({ model: l.model, key: l.key ?? l.model, maker: l.maker, name: l.name, qty: l.qty, unit: l.unit, source: l.source })),
  });
}
