import Encoding from 'encoding-japanese';
import { FACE_LABEL } from '../data/faces';
import type { BomColumnId, BomLine, BomSettings, Machining } from '../types';

/**
 * CSV 書き出し。
 *
 * 列・並び順・区切り文字・文字コードは設定側に持たせてある。ERP の取込仕様が
 * 判明したときに、コードを触らず設定を変えるだけで対応できるようにするため。
 * 国内 ERP は Shift-JIS(CP932) 指定のことが多いので既定はそちら。
 */

export const BOM_COLUMN_LABEL: Record<BomColumnId, string> = {
  model: '型式',
  maker: 'メーカー',
  name: '品名',
  qty: '数量',
  unit: '単位',
  source: '区分',
};

const SOURCE_LABEL = { device: '機器', derived: '派生部品' } as const;

function cell(value: string, delimiter: string): string {
  const needsQuote = value.includes(delimiter) || /["\n\r]/.test(value);
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

function toRow(values: string[], delimiter: string): string {
  return values.map((v) => cell(v, delimiter)).join(delimiter);
}

export function bomToCsv(lines: BomLine[], s: BomSettings): string {
  const rows: string[] = [];
  if (s.withHeader) {
    rows.push(toRow(s.columns.map((c) => BOM_COLUMN_LABEL[c]), s.delimiter));
  }
  for (const l of lines) {
    rows.push(
      toRow(
        s.columns.map((c) => (c === 'source' ? SOURCE_LABEL[l.source] : String(l[c]))),
        s.delimiter,
      ),
    );
  }
  // ERP 取込では CRLF を要求されることが多い
  return rows.join('\r\n') + '\r\n';
}

/** 加工リスト。穴あけ・切り欠きの座標を面ごとに出す。 */
export function machiningToCsv(items: Machining[], s: BomSettings): string {
  const header = ['面', '種類', 'X', 'Y', '径/幅', '高さ', '備考'];
  const rows: string[] = [];
  if (s.withHeader) rows.push(toRow(header, s.delimiter));
  for (const m of items) {
    rows.push(
      toRow(
        m.kind === 'hole'
          ? [FACE_LABEL(m.face), '穴あけ', String(m.x), String(m.y), String(m.dia), '', m.note ?? '']
          : [FACE_LABEL(m.face), '切り欠き', String(m.x), String(m.y), String(m.w), String(m.h), m.note ?? ''],
        s.delimiter,
      ),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

function toBlob(text: string, encoding: BomSettings['encoding']): Blob {
  if (encoding === 'utf8') {
    // Excel が UTF-8 CSV を正しく開けるよう BOM を付ける
    return new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), text], { type: 'text/csv' });
  }
  const bytes = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
  return new Blob([new Uint8Array(bytes)], { type: 'text/csv' });
}

/**
 * ファイル名は ASCII だけで組み立てる。非ASCII を含む名前はブラウザ・OS の
 * ロケール次第で丸ごと捨てられ、`download` という名前で保存されることがある。
 */
export function asciiFileName(base: string, fallback: string): string {
  const ascii = base
    .replace(/[×✕]/g, 'x')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  if (ascii.length >= 3) return ascii;
  const t = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${fallback}_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
}

export function downloadCsv(text: string, fileName: string, encoding: BomSettings['encoding']): void {
  const url = URL.createObjectURL(toBlob(text, encoding));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // download 属性を効かせるにはドキュメントに入れてからクリックする必要がある
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
