import Encoding from 'encoding-japanese';
import { DIN_RAIL_WIDTH } from '../data/enclosures';
import { FACES, FACE_LABEL, faceSize } from '../data/faces';
import { autoLayout, computeRails } from './layout';
import type { DeviceLookup, LayoutItem } from './layout';
import { autoMachining, TAP_DRILL } from './machining';
import { unfoldCells } from './unfold';
import { rotatedSize } from '../types';
import type { DeviceShape, FaceId, Machining, PanelSpec, PlacedDevice, Profile } from '../types';

/**
 * DXF 書き出し。
 *
 * AutoCAD LT は COM/ActiveX 自動化に対応していないので、ファイルで渡すしかない。
 * 形式は **R12 (AC1009)** に絞ってある。LWPOLYLINE や真円弧の派生を使わず
 * LINE / CIRCLE / ARC / TEXT だけで組み立てるので、古い CAD でもまず開ける。
 *
 * 単位は mm、原点は書き出す図の左下。
 * 文字コードは Shift-JIS（国内の CAD はこちら。メーカー配布の DXF も同じ）。
 */

/** レイヤ名。加工だけを拾いたいことがあるので、加工は種類ごとに分ける。 */
export const LAYER = {
  outline: '外形',
  device: '機器',
  deviceText: '機器-型式',
  duct: 'ダクト',
  rail: 'DINレール',
  hole: '加工-丸穴',
  tap: '加工-タップ',
  notch: '加工-切り欠き',
  note: '図面-注記',
} as const;

/** レイヤの色番号（AutoCAD Color Index）。 */
const LAYER_COLOR: Record<string, number> = {
  [LAYER.outline]: 7,
  [LAYER.device]: 5,
  [LAYER.deviceText]: 5,
  [LAYER.duct]: 8,
  [LAYER.rail]: 8,
  [LAYER.hole]: 1,
  [LAYER.tap]: 2,
  [LAYER.notch]: 6,
  [LAYER.note]: 7,
};

const n = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);

/** DXF は「グループコード\n値\n」の繰り返し。組み立てを1か所にまとめる。 */
class DxfWriter {
  private out: string[] = [];

  private pair(code: number, value: string | number) {
    this.out.push(String(code), String(value));
  }

  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.pair(10, n(x1));
    this.pair(20, n(y1));
    this.pair(30, 0);
    this.pair(11, n(x2));
    this.pair(21, n(y2));
    this.pair(31, 0);
  }

  rect(layer: string, x: number, y: number, w: number, h: number) {
    this.line(layer, x, y, x + w, y);
    this.line(layer, x + w, y, x + w, y + h);
    this.line(layer, x + w, y + h, x, y + h);
    this.line(layer, x, y + h, x, y);
  }

  circle(layer: string, cx: number, cy: number, r: number) {
    if (r <= 0) return;
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.pair(10, n(cx));
    this.pair(20, n(cy));
    this.pair(30, 0);
    this.pair(40, n(r));
  }

  /** 角度はラジアンで受けて、DXF の度に直す。 */
  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number) {
    if (r <= 0) return;
    const deg = (a: number) => ((a * 180) / Math.PI + 360) % 360;
    this.pair(0, 'ARC');
    this.pair(8, layer);
    this.pair(10, n(cx));
    this.pair(20, n(cy));
    this.pair(30, 0);
    this.pair(40, n(r));
    this.pair(50, n(deg(a0)));
    this.pair(51, n(deg(a1)));
  }

  text(layer: string, x: number, y: number, height: number, s: string, rotation = 0) {
    if (!s) return;
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, n(x));
    this.pair(20, n(y));
    this.pair(30, 0);
    this.pair(40, n(height));
    this.pair(1, s);
    if (rotation) this.pair(50, n(rotation));
  }

  /** ヘッダ・レイヤ表で挟んで DXF 一式にする。 */
  finish(): string {
    const head: string[] = [];
    const p = (code: number, value: string | number) => head.push(String(code), String(value));

    p(0, 'SECTION');
    p(2, 'HEADER');
    p(9, '$ACADVER');
    p(1, 'AC1009');
    // 単位は mm
    p(9, '$INSUNITS');
    p(70, 4);
    p(0, 'ENDSEC');

    p(0, 'SECTION');
    p(2, 'TABLES');
    p(0, 'TABLE');
    p(2, 'LAYER');
    p(70, Object.keys(LAYER_COLOR).length);
    for (const [name, color] of Object.entries(LAYER_COLOR)) {
      p(0, 'LAYER');
      p(2, name);
      p(70, 0);
      p(62, color);
      p(6, 'CONTINUOUS');
    }
    p(0, 'ENDTAB');
    p(0, 'ENDSEC');

    p(0, 'SECTION');
    p(2, 'ENTITIES');

    const tail = ['0', 'ENDSEC', '0', 'EOF'];
    // DXF は CRLF が通例
    return [...head, ...this.out, ...tail].join('\r\n') + '\r\n';
  }
}

/** 部品の外形線を、置かれた位置・向き・大きさに合わせて描く。 */
function drawShape(
  w: DxfWriter,
  shape: DeviceShape,
  at: { x: number; y: number },
  size: { w: number; h: number },
  rot: number,
) {
  const sx = size.w / (shape.w || 1);
  const sy = size.h / (shape.h || 1);
  const cos = Math.cos((rot * Math.PI) / 180);
  const sin = Math.sin((rot * Math.PI) / 180);
  // 部品の中心を原点にして回し、置き場所の中心へ戻す
  const cx = size.w / 2;
  const cy = size.h / 2;
  const map = (px: number, py: number) => {
    const x = px * sx - cx;
    const y = py * sy - cy;
    return { x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos };
  };

  for (const e of shape.entities) {
    if (e.t === 'c') {
      const c = map(e.x, e.y);
      w.circle(LAYER.device, c.x, c.y, e.r * Math.abs(sx));
    } else if (e.t === 'a') {
      const c = map(e.x, e.y);
      const r = (rot * Math.PI) / 180;
      w.arc(LAYER.device, c.x, c.y, e.r * Math.abs(sx), e.a0 + r, e.a1 + r);
    } else {
      for (let i = 0; i + 3 < e.pts.length; i += 2) {
        const a = map(e.pts[i]!, e.pts[i + 1]!);
        const b = map(e.pts[i + 2]!, e.pts[i + 3]!);
        w.line(LAYER.device, a.x, a.y, b.x, b.y);
      }
    }
  }
}

/** 加工1件。丸穴・タップ・切り欠きをレイヤで分けて描く。 */
function drawMachining(w: DxfWriter, m: Machining, ox: number, oy: number) {
  if (m.kind === 'notch') {
    w.rect(LAYER.notch, ox + m.x - m.w / 2, oy + m.y - m.h / 2, m.w, m.h);
    return;
  }
  if (m.tap) {
    // 二重丸。外が呼び径、内が下穴
    const outer = Number(m.tap.slice(1));
    w.circle(LAYER.tap, ox + m.x, oy + m.y, outer / 2);
    w.circle(LAYER.tap, ox + m.x, oy + m.y, (TAP_DRILL[m.tap] ?? m.dia) / 2);
    return;
  }
  w.circle(LAYER.hole, ox + m.x, oy + m.y, m.dia / 2);
}

export type ExportInput = {
  panel: PanelSpec;
  profile: Profile;
  items: LayoutItem[];
  pinned: PlacedDevice[];
  machining: Machining[];
  removedDucts: Partial<Record<FaceId, number[]>>;
  devices: DeviceLookup;
};

/** 書き出す中身。加工屋には穴だけ渡したいので切り替えられるようにする。 */
export type ExportKind = 'full' | 'holes';

/** 面1つぶんを、指定した位置を左下として書き込む。 */
function drawFace(
  w: DxfWriter,
  input: ExportInput,
  face: FaceId,
  ox: number,
  oy: number,
  kind: ExportKind,
) {
  const { panel, profile, items, pinned, machining, removedDucts, devices } = input;
  const size = faceSize(panel, face);
  const layout = autoLayout(panel, profile, face, items, pinned, devices, removedDucts[face] ?? []);

  // 面の外形
  w.rect(LAYER.outline, ox, oy, size.w, size.h);

  if (kind === 'full') {
    for (const d of layout.ducts) {
      if (d.removed) continue;
      w.rect(LAYER.duct, ox + d.x, oy + d.y, d.w, d.h);
    }
    for (const r of computeRails(layout, devices, profile.rail.endMargin)) {
      w.rect(LAYER.rail, ox + r.x, oy + r.y - DIN_RAIL_WIDTH / 2, r.length, DIN_RAIL_WIDTH);
    }
    for (const p of layout.placed) {
      const spec = devices.get(p.specId);
      if (!spec) continue;
      const s = rotatedSize(spec.size, p.rot);
      if (spec.shape) {
        drawShape(w, spec.shape, { x: ox + p.x + s.w / 2, y: oy + p.y + s.h / 2 }, spec.size, p.rot ?? 0);
      } else {
        w.rect(LAYER.device, ox + p.x, oy + p.y, s.w, s.h);
      }
      // 型式は機器の左下に小さく。図面上で拾えるようにする
      w.text(LAYER.deviceText, ox + p.x + 2, oy + p.y + 2, Math.min(8, s.h / 3), spec.model);
    }
  }

  // 加工は full / holes のどちらにも出す。これが書き出しの主目的
  for (const m of autoMachining(face, layout, devices, profile)) drawMachining(w, m, ox, oy);
  for (const m of machining.filter((q) => q.face === face)) drawMachining(w, m, ox, oy);
}

/** キャビネット（中板以外の6面）を三面図の並びで1枚に書き出す。 */
export function cabinetDxf(input: ExportInput, kind: ExportKind): string {
  const w = new DxfWriter();
  const { cells } = unfoldCells(input.panel);
  for (const c of cells) {
    if (c.id === 'plate') continue;
    drawFace(w, input, c.id, c.x, c.y, kind);
    w.text(LAYER.note, c.x, c.y - 14, 10, `${FACE_LABEL(c.id)} ${c.w}x${c.h}`);
  }
  return w.finish();
}

/** 中板だけを1枚に書き出す。 */
export function plateDxf(input: ExportInput, kind: ExportKind): string {
  const w = new DxfWriter();
  drawFace(w, input, 'plate', 0, 0, kind);
  w.text(LAYER.note, 0, -14, 10, `中板 ${input.panel.plate.w}x${input.panel.plate.h}`);
  return w.finish();
}

/** ダウンロード1件。中身は Shift-JIS に変換する。 */
function download(text: string, filename: string) {
  const bytes = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type DxfSet = { name: string; text: string }[];

/**
 * 設計完了時に出す4ファイル。
 *
 * キャビネットと中板それぞれについて、
 *  - 機器つき（配置の確認・組立用）
 *  - 加工穴のみ（板金・加工屋へ渡す用）
 * の2種類を作る。加工屋に機器の絵まで渡すと拾う線が増えて事故のもとになるため。
 */
export function buildDxfSet(input: ExportInput, base: string): DxfSet {
  return [
    { name: `${base}_cabinet_full.dxf`, text: cabinetDxf(input, 'full') },
    { name: `${base}_cabinet_holes.dxf`, text: cabinetDxf(input, 'holes') },
    { name: `${base}_plate_full.dxf`, text: plateDxf(input, 'full') },
    { name: `${base}_plate_holes.dxf`, text: plateDxf(input, 'holes') },
  ];
}

/**
 * 4ファイルをまとめてダウンロードする。
 * ブラウザは連続ダウンロードを1回だけ確認するので、間隔を空けて順に出す。
 */
export async function downloadDxfSet(set: DxfSet) {
  for (const [i, f] of set.entries()) {
    download(f.text, f.name);
    if (i < set.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
}

/** 全面ぶんの機器と加工の数。書き出す前に中身があるか確かめるのに使う。 */
export function exportSummary(input: ExportInput) {
  let cuts = 0;
  for (const f of FACES) {
    const layout = autoLayout(
      input.panel,
      input.profile,
      f.id,
      input.items,
      input.pinned,
      input.devices,
      input.removedDucts[f.id] ?? [],
    );
    cuts += autoMachining(f.id, layout, input.devices, input.profile).length;
  }
  cuts += input.machining.length;
  return { devices: input.items.length, cuts };
}
