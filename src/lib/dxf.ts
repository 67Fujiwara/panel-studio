import Encoding from 'encoding-japanese';
import { DIN_RAIL_WIDTH } from '../data/enclosures';
import { DEVICE_BY_ID } from '../data/devices';
import { computeRails } from './layout';
import type { LayoutResult, PanelSpec, Profile, Rect } from '../types';

/**
 * DXF R12 (AC1009) を書き出す。
 *
 * 設計時のモデル空間は 1:1 のため、**実寸 mm をそのまま出力する**。
 * 縮尺は PDF 化のときに掛ける運用なので、ここで倍率を掛けてはいけない。
 *
 * R12 を選ぶ理由は、ハンドル管理が不要で構造が単純なわりに
 * AutoCAD / AutoCAD LT / BricsCAD のいずれでも確実に開けるため。
 */

/** DXF のグループコード1組。 */
const g = (code: number, value: string | number) => `${code}\n${value}\n`;

/** DXF に出す座標値。指数表記や余計な桁を避ける。 */
const n = (v: number) => String(Number(v.toFixed(4)));

/** AutoCAD Color Index。レイヤごとの既定色。 */
const LAYER_COLOR = { plate: 7, duct: 8, device: 5, text: 3, rail: 2 } as const;

function layerTable(layers: Profile['drawing']['layers']): string {
  const names = Object.entries(layers) as [keyof typeof LAYER_COLOR, string][];
  let s = g(0, 'TABLE') + g(2, 'LAYER') + g(70, names.length);
  for (const [key, name] of names) {
    s += g(0, 'LAYER') + g(2, name) + g(70, 0) + g(62, LAYER_COLOR[key]) + g(6, 'CONTINUOUS');
  }
  return s + g(0, 'ENDTAB');
}

/** 閉じたポリラインとして矩形を1オブジェクトで出す（AutoCAD 側で扱いやすい）。 */
function rect(layer: string, r: Rect): string {
  const pts: [number, number][] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  let s =
    g(0, 'POLYLINE') +
    g(8, layer) +
    g(66, 1) +
    g(10, 0) +
    g(20, 0) +
    g(30, 0) +
    g(70, 1); // 1 = 閉じたポリライン
  for (const [x, y] of pts) {
    s += g(0, 'VERTEX') + g(8, layer) + g(10, n(x)) + g(20, n(y)) + g(30, 0);
  }
  return s + g(0, 'SEQEND') + g(8, layer);
}

function text(layer: string, x: number, y: number, height: number, value: string): string {
  return (
    g(0, 'TEXT') +
    g(8, layer) +
    g(10, n(x)) +
    g(20, n(y)) +
    g(30, 0) +
    g(40, n(height)) +
    g(1, value) +
    g(72, 1) + // 水平: 中央
    g(73, 2) + // 垂直: 中央
    g(11, n(x)) +
    g(21, n(y)) +
    g(31, 0)
  );
}

export function buildDxf(panel: PanelSpec, layout: LayoutResult, profile: Profile): string {
  const { layers, textHeight } = profile.drawing;
  let e = '';

  // 中板の外形
  e += rect(layers.plate, { x: 0, y: 0, w: panel.plate.w, h: panel.plate.h });

  // 配線ダクト
  for (const d of layout.ducts) e += rect(layers.duct, d);

  // DINレール（機器より先に出して、機器が上に重なって見えるようにする）
  for (const r of computeRails(layout)) {
    e += rect(layers.rail, { x: r.x, y: r.y, w: r.length, h: DIN_RAIL_WIDTH });
  }

  // 機器と機器名
  for (const p of layout.placed) {
    const spec = DEVICE_BY_ID.get(p.specId);
    if (!spec) continue;
    e += rect(layers.device, { x: p.x, y: p.y, w: spec.size.w, h: spec.size.h });
    e += text(layers.text, p.x + spec.size.w / 2, p.y + spec.size.h / 2, textHeight, spec.model);
  }

  return (
    g(0, 'SECTION') +
    g(2, 'HEADER') +
    g(9, '$ACADVER') +
    g(1, 'AC1009') +
    g(9, '$INSUNITS') +
    g(70, 4) + // 4 = ミリメートル
    g(9, '$EXTMIN') +
    g(10, 0) +
    g(20, 0) +
    g(30, 0) +
    g(9, '$EXTMAX') +
    g(10, n(panel.plate.w)) +
    g(20, n(panel.plate.h)) +
    g(30, 0) +
    g(0, 'ENDSEC') +
    g(0, 'SECTION') +
    g(2, 'TABLES') +
    layerTable(layers) +
    g(0, 'ENDSEC') +
    g(0, 'SECTION') +
    g(2, 'ENTITIES') +
    e +
    g(0, 'ENDSEC') +
    g(0, 'EOF')
  );
}

/**
 * Shift-JIS(CP932) で書き出す。
 * 国内の AutoCAD は DXF を Shift-JIS として読むため、UTF-8 のままだと
 * レイヤ名や文字に日本語を使ったときに文字化けする。
 */
export function dxfBlob(content: string): Blob {
  const bytes = Encoding.convert(Encoding.stringToCode(content), {
    to: 'SJIS',
    from: 'UNICODE',
  });
  return new Blob([new Uint8Array(bytes)], { type: 'application/dxf' });
}

/**
 * ダウンロード用のファイル名。
 *
 * 非ASCII を含むファイル名はブラウザ・OS のロケール次第で丸ごと捨てられ、
 * `download` という名前で保存されてしまうことがある。確実に名前が残るよう
 * ASCII だけで組み立て、型式から取れる英数字が無いときは日時で代替する。
 */
export function dxfFileName(model: string): string {
  const ascii = model
    // 型式によく出る記号は ASCII に寄せてから落とす（700×1000 → 700x1000）
    .replace(/[×✕]/g, 'x')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\(\s*\)/g, '') // 中身が消えて空になった括弧を捨てる
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  if (ascii.length >= 3) return `${ascii}_plate.dxf`;
  const t = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `panel_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}_plate.dxf`;
}

export function downloadDxf(panel: PanelSpec, layout: LayoutResult, profile: Profile): void {
  const url = URL.createObjectURL(dxfBlob(buildDxf(panel, layout, profile)));
  const a = document.createElement('a');
  a.href = url;
  a.download = dxfFileName(panel.model);
  // download 属性を効かせるにはドキュメントに入れてからクリックする必要がある。
  // revoke も即座にやるとダウンロードが間に合わないことがあるので遅らせる。
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
