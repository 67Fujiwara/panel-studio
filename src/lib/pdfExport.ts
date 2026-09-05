/**
 * PDF の書き出し。DXF と同じ描画（線・円・弧・文字）を受けて、A3 横 1 枚の PDF にする。
 *
 * ライブラリは足さない。PDF は「オブジェクトの並び＋相互参照表」のテキストで、
 * 線と文字だけなら数十行で組める。共有フォルダの HTML 1 枚で完結させる方針のため。
 *
 * - 用紙は A3 横（420×297mm）。図はページに**収まる縮尺**で描き、表題に縮尺を書く
 * - 座標は mm・左下原点・Y 上向き。PDF もそうなので、面の座標をそのまま拡縮するだけ
 * - 文字は日本語が要る（面の名前・注記）。フォントを埋め込まずに済ませるため、
 *   Adobe-Japan1 の CID フォント（KozMinPr6N-Regular）を**参照だけ**する。
 *   Acrobat・Chrome・Edge は手元の日本語フォントで代替表示する。
 *   文字列は UniJIS-UCS2-H で UCS-2 の 16 進として書く（ASCII もこれで通る）
 * - 円・弧はベジェで近似する（PDF に円プリミティブは無い）
 */
import { LAYER, type Drawer } from './drawing';

/** mm → pt */
const PT = 72 / 25.4;
const PAGE = { w: 420, h: 297 }; // A3 横 (mm)
const MARGIN = 10;
const TITLE_H = 12;

/** レイヤごとの線の色（RGB 0..1）。画面の見え方に寄せる */
const STROKE: Record<string, [number, number, number]> = {
  [LAYER.outline]: [0, 0, 0],
  [LAYER.device]: [0.16, 0.36, 0.7],
  [LAYER.deviceText]: [0.16, 0.36, 0.7],
  [LAYER.duct]: [0.45, 0.45, 0.45],
  [LAYER.rail]: [0.3, 0.3, 0.3],
  [LAYER.hole]: [0.85, 0.1, 0.1],
  [LAYER.tap]: [0.75, 0.1, 0.6],
  [LAYER.notch]: [0.9, 0.45, 0.05],
  [LAYER.note]: [0, 0, 0],
};

type Op =
  | { k: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { k: 'circle'; layer: string; cx: number; cy: number; r: number }
  | { k: 'arc'; layer: string; cx: number; cy: number; r: number; a0: number; a1: number }
  | { k: 'text'; layer: string; x: number; y: number; h: number; s: string; rot: number };

const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '0');

/** 文字列を UCS-2BE の 16 進に。サロゲートペアは UCS-2 に無いので "?" にする */
function ucs2Hex(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    const c = cp > 0xffff ? 0x3f : cp;
    out += c.toString(16).padStart(4, '0');
  }
  return out;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

/**
 * 文字ごとにフォントを選ぶ。
 * 英数字だけなら Helvetica（標準書体。どの閲覧ソフトでも必ず出る）、
 * 日本語が混じるときだけ CID フォント（閲覧側の日本語フォントで代替表示）。
 * 型式・座標など図面で確実に読みたい文字は英数字なので、そちらを固い側に寄せる
 */
const fontOp = (s: string, size: number) => `/${ASCII_ONLY.test(s) ? 'F1' : 'F2'} ${f(size)} Tf`;
const textOp = (s: string) =>
  ASCII_ONLY.test(s)
    ? `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
    : `<${ucs2Hex(s)}>`;

export class PdfWriter implements Drawer {
  private ops: Op[] = [];

  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.ops.push({ k: 'line', layer, x1, y1, x2, y2 });
  }
  rect(layer: string, x: number, y: number, w: number, h: number) {
    this.line(layer, x, y, x + w, y);
    this.line(layer, x + w, y, x + w, y + h);
    this.line(layer, x + w, y + h, x, y + h);
    this.line(layer, x, y + h, x, y);
  }
  circle(layer: string, cx: number, cy: number, r: number) {
    if (r > 0) this.ops.push({ k: 'circle', layer, cx, cy, r });
  }
  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number) {
    if (r > 0) this.ops.push({ k: 'arc', layer, cx, cy, r, a0, a1 });
  }
  text(layer: string, x: number, y: number, height: number, s: string, rotation = 0) {
    if (s) this.ops.push({ k: 'text', layer, x, y, h: height, s, rot: rotation });
  }

  /**
   * 1 ページの PDF にする。
   * @param extent 図の範囲(mm)。原点 (0,0) から w×h を用紙に収める
   * @param title 表題（案件・面・日付など）。縮尺はこちらで足す
   */
  finish(extent: { w: number; h: number }, title: string): Uint8Array {
    const availW = PAGE.w - MARGIN * 2;
    const availH = PAGE.h - MARGIN * 2 - TITLE_H;
    const scale = Math.min(availW / Math.max(1, extent.w), availH / Math.max(1, extent.h));
    // 図は用紙の左下寄せ。表題は上の帯に
    const X = (x: number) => f((MARGIN + x * scale) * PT);
    const Y = (y: number) => f((MARGIN + y * scale) * PT);
    const R = (r: number) => r * scale * PT;

    const c: string[] = [];
    c.push('0.3 w 1 J 1 j'); // 線幅 0.3pt・丸端
    let cur = '';
    const setColor = (layer: string) => {
      const rgb = STROKE[layer] ?? [0, 0, 0];
      const s = `${rgb.map((v) => f(v)).join(' ')} RG ${rgb.map((v) => f(v)).join(' ')} rg`;
      if (s !== cur) {
        c.push(s);
        cur = s;
      }
    };
    const K = 0.5523; // 4 分割ベジェで円を近似するときの制御点係数
    const bezierArc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
      // 90° 以下に割って、それぞれをベジェ 1 本で
      let sweep = a1 - a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2)));
      const step = sweep / n;
      const k = (4 / 3) * Math.tan(step / 4);
      const px = (a: number) => (MARGIN + (cx + r * Math.cos(a)) * scale) * PT;
      const py = (a: number) => (MARGIN + (cy + r * Math.sin(a)) * scale) * PT;
      c.push(`${f(px(a0))} ${f(py(a0))} m`);
      for (let i = 0; i < n; i++) {
        const s = a0 + i * step;
        const e = s + step;
        const rr = R(r);
        const p1x = px(s) - rr * k * Math.sin(s);
        const p1y = py(s) + rr * k * Math.cos(s);
        const p2x = px(e) + rr * k * Math.sin(e);
        const p2y = py(e) - rr * k * Math.cos(e);
        c.push(`${f(p1x)} ${f(p1y)} ${f(p2x)} ${f(p2y)} ${f(px(e))} ${f(py(e))} c`);
      }
      c.push('S');
    };
    void K;

    for (const op of this.ops) {
      setColor(op.layer);
      if (op.k === 'line') {
        c.push(`${X(op.x1)} ${Y(op.y1)} m ${X(op.x2)} ${Y(op.y2)} l S`);
      } else if (op.k === 'circle') {
        bezierArc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      } else if (op.k === 'arc') {
        bezierArc(op.cx, op.cy, op.r, op.a0, op.a1);
      } else {
        const size = Math.max(2, op.h * scale * PT);
        const rad = (op.rot * Math.PI) / 180;
        const cos = f(Math.cos(rad));
        const sin = f(Math.sin(rad));
        c.push(`BT ${fontOp(op.s, size)} ${cos} ${sin} ${f(-Math.sin(rad))} ${cos} ${X(op.x)} ${Y(op.y)} Tm ${textOp(op.s)} Tj ET`);
      }
    }
    // 表題（上の帯）。縮尺は「1:n」で
    setColor(LAYER.note);
    const ratio = scale >= 1 ? `${(scale).toFixed(2)}:1` : `1:${(1 / scale).toFixed(2)}`;
    const ty = (PAGE.h - MARGIN - 6) * PT;
    /*
     * 表題は2段。上は英数字だけ（Helvetica。どの閲覧ソフトでも必ず出る）、
     * 下は日本語入り（CID フォント。日本語フォントの無い閲覧ソフトでは出ないことがある）。
     * 案件番号と縮尺だけは確実に読めるようにするため
     */
    const ascii = `${title.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim()}   scale ${ratio}   unit mm`;
    c.push(`BT ${fontOp(ascii, 3.5 * PT)} 1 0 0 1 ${f(MARGIN * PT)} ${f(ty)} Tm ${textOp(ascii)} Tj ET`);
    const jp = `${title}   縮尺 ${ratio}   単位 mm`;
    c.push(`BT ${fontOp(jp, 2.6 * PT)} 1 0 0 1 ${f(MARGIN * PT)} ${f(ty - 4 * PT)} Tm ${textOp(jp)} Tj ET`);
    c.push(
      `${f(MARGIN * PT)} ${f((PAGE.h - MARGIN - TITLE_H + 2) * PT)} m ${f((PAGE.w - MARGIN) * PT)} ${f((PAGE.h - MARGIN - TITLE_H + 2) * PT)} l S`,
    );

    const content = c.join('\n');
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(PAGE.w * PT)} ${f(PAGE.h * PT)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
      `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
      // 英数字は標準 14 書体の Helvetica（どの閲覧ソフトにも必ずある）。型式・座標はこちらで出る
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      // 日本語フォント。埋め込まず、閲覧側の Adobe-Japan1 フォントで代替表示させる
      '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [7 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 8 0 R /DW 1000 /W [1 95 500] >>',
      '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [-437 -340 1147 1317] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 742 /StemV 80 >>',
    ];

    let pdf = '%PDF-1.4\n%âãÏÓ\n';
    const enc = new TextEncoder();
    const byteLen = (s: string) => enc.encode(s).length;
    const offsets: number[] = [];
    let pos = byteLen(pdf);
    objects.forEach((body, i) => {
      offsets.push(pos);
      const s = `${i + 1} 0 obj\n${body}\nendobj\n`;
      pdf += s;
      pos += byteLen(s);
    });
    const xref = pos;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc.encode(pdf);
  }
}
