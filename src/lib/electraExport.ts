/**
 * ElectraCAD Studio（自作の図面ソフト）へ差し込むための中間ファイル。
 *
 * 設計完了で出す DXF / PDF は「Panel Studio の図枠」で完結した図だが、実際の納品図は
 * ElectraCAD Studio の仕様ページの次に、**ElectraCAD Studio の図枠で**入れたい。
 * そこで、図枠を持たない「中身だけ」を、ElectraCAD 側が読みやすい JSON にして別ファイルで出す。
 *
 * - 座標は mm・左下原点・Y 上向き（DXF と同じ）。図枠への当てはめ（縮尺・位置）は
 *   ElectraCAD 側が図枠の作図領域を知っているので、そちらで決める。
 *   このファイルは各シートの実寸（extent）を持っており、そこから縮尺を選べる。
 * - 線・円・弧・文字の生データ（entities）に加え、そのまま貼れる **SVG（1:1 mm）**も持たせる。
 *   ElectraCAD が Web 技術なら SVG をそのまま図枠の中に置くだけで済むし、
 *   そうでなくても entities から自前で描ける。
 * - 文字コードは UTF-8（DXF の Shift-JIS とは違う。JSON なので UTF-8 が自然）
 *
 * DXF・PDF と同じ描画命令（Drawer）を受けているので、絵は 3 つとも同じ。
 */
import { LAYER, type Drawer } from './drawing';

/** ファイル形式の名前と版。ElectraCAD 側はこれを見て読めるか判断する */
export const ELECTRA_FORMAT = 'panel-studio/electracad-sheets';
export const ELECTRA_VERSION = 1;

/** 一般的な図面の縮尺。ElectraCAD 側が「収まる最大の縮尺」を選ぶときの候補 */
export const STANDARD_SCALES = [1, 2, 2.5, 5, 10, 20, 50] as const;

/** レイヤごとの色（画面・PDF と同じ見え方）と DXF の色番号 */
export const LAYER_STYLE: Record<string, { color: string; aci: number }> = {
  [LAYER.outline]: { color: '#000000', aci: 7 },
  [LAYER.device]: { color: '#295cb3', aci: 5 },
  [LAYER.deviceText]: { color: '#295cb3', aci: 5 },
  [LAYER.duct]: { color: '#737373', aci: 8 },
  [LAYER.rail]: { color: '#4d4d4d', aci: 8 },
  [LAYER.hole]: { color: '#d91a1a', aci: 1 },
  [LAYER.tap]: { color: '#bf1a99', aci: 2 },
  [LAYER.notch]: { color: '#e6730d', aci: 6 },
  [LAYER.note]: { color: '#000000', aci: 7 },
};

export type ElectraEntity =
  | { t: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { t: 'circle'; layer: string; cx: number; cy: number; r: number }
  /** 弧。角度は **度**・反時計回り（a0 → a1）。DXF の ARC と同じ向き */
  | { t: 'arc'; layer: string; cx: number; cy: number; r: number; a0: number; a1: number }
  /** 文字。(x, y) は左下、h は文字の高さ mm、rot は度（反時計回り） */
  | { t: 'text'; layer: string; x: number; y: number; h: number; s: string; rot: number };

export type ElectraSheet = {
  /** cabinet_full / cabinet_holes / plate_full / plate_holes */
  id: string;
  /** 表題に使う名前（日本語） */
  title: string;
  /** 図の実寸（mm）。左下 (0,0) から右上 (w,h) */
  extent: { w: number; h: number };
  /** 使っているレイヤと色 */
  layers: Record<string, { color: string; aci: number }>;
  entities: ElectraEntity[];
  /** 1 mm = 1 ユーザー単位の SVG。viewBox="0 0 w h"、Y は上向きに直してある */
  svg: string;
};

export type ElectraJob = {
  company: string;
  jobNo: string;
  owner: string;
  completedAt: string;
  note: string;
};

export type ElectraFile = {
  format: typeof ELECTRA_FORMAT;
  version: typeof ELECTRA_VERSION;
  generator: string;
  exportedAt: string;
  units: 'mm';
  /** 座標系の説明。読む側が迷わないように文章でも書いておく */
  coordinates: string;
  standardScales: readonly number[];
  job: ElectraJob;
  panel: { model: string; outer: { w: number; h: number; d: number }; plate: { w: number; h: number } };
  sheets: ElectraSheet[];
};

const r3 = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);
const deg = (a: number) => r3((((a * 180) / Math.PI) % 360 + 360) % 360);

/** SVG の属性値・本文に入れられるようにする */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Drawer を受けて entities を溜め、最後にシート（JSON の 1 枚ぶん）にする */
export class ElectraSheetWriter implements Drawer {
  private entities: ElectraEntity[] = [];
  private used = new Set<string>();

  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.used.add(layer);
    this.entities.push({ t: 'line', layer, x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2) });
  }

  rect(layer: string, x: number, y: number, w: number, h: number) {
    this.line(layer, x, y, x + w, y);
    this.line(layer, x + w, y, x + w, y + h);
    this.line(layer, x + w, y + h, x, y + h);
    this.line(layer, x, y + h, x, y);
  }

  circle(layer: string, cx: number, cy: number, r: number) {
    if (r <= 0) return;
    this.used.add(layer);
    this.entities.push({ t: 'circle', layer, cx: r3(cx), cy: r3(cy), r: r3(r) });
  }

  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number) {
    if (r <= 0) return;
    this.used.add(layer);
    this.entities.push({ t: 'arc', layer, cx: r3(cx), cy: r3(cy), r: r3(r), a0: deg(a0), a1: deg(a1) });
  }

  text(layer: string, x: number, y: number, height: number, s: string, rotation = 0) {
    if (!s) return;
    this.used.add(layer);
    this.entities.push({ t: 'text', layer, x: r3(x), y: r3(y), h: r3(height), s, rot: r3(rotation) });
  }

  finish(id: string, title: string, extent: { w: number; h: number }): ElectraSheet {
    const ext = { w: r3(extent.w), h: r3(extent.h) };
    const layers: ElectraSheet['layers'] = {};
    for (const l of this.used) layers[l] = LAYER_STYLE[l] ?? { color: '#000000', aci: 7 };
    return { id, title, extent: ext, layers, entities: this.entities, svg: toSvg(this.entities, ext, layers) };
  }
}

/**
 * entities を SVG にする。
 *
 * - viewBox は "0 0 w h"（mm）。ElectraCAD 側は width/height を付け替えるだけで縮尺になる
 * - SVG は Y 下向きなので、外側の <g> で上下を反転し、文字だけもう一度反転して正立させる
 * - 線幅は vector-effect="non-scaling-stroke" で「縮尺にかかわらず 1px」にしてある。
 *   印刷で太さを変えたいときは stroke-width を差し替える
 */
function toSvg(entities: ElectraEntity[], extent: { w: number; h: number }, layers: ElectraSheet['layers']): string {
  const byLayer = new Map<string, string[]>();
  const push = (layer: string, s: string) => {
    let arr = byLayer.get(layer);
    if (!arr) byLayer.set(layer, (arr = []));
    arr.push(s);
  };
  const f = (v: number) => String(r3(v));
  for (const e of entities) {
    if (e.t === 'line') {
      push(e.layer, `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}"/>`);
    } else if (e.t === 'circle') {
      push(e.layer, `<circle cx="${f(e.cx)}" cy="${f(e.cy)}" r="${f(e.r)}"/>`);
    } else if (e.t === 'arc') {
      const a0 = (e.a0 * Math.PI) / 180;
      let sweep = ((e.a1 - e.a0) % 360 + 360) % 360;
      if (sweep === 0) sweep = 360;
      if (sweep >= 360) {
        push(e.layer, `<circle cx="${f(e.cx)}" cy="${f(e.cy)}" r="${f(e.r)}"/>`);
        continue;
      }
      const a1 = a0 + (sweep * Math.PI) / 180;
      const sx = e.cx + e.r * Math.cos(a0);
      const sy = e.cy + e.r * Math.sin(a0);
      const ex = e.cx + e.r * Math.cos(a1);
      const ey = e.cy + e.r * Math.sin(a1);
      // 外側の <g> で Y を反転しているので、ここでの sweep=1（正の角度方向）が見た目の反時計回りになる
      const large = sweep > 180 ? 1 : 0;
      push(e.layer, `<path d="M${f(sx)} ${f(sy)} A${f(e.r)} ${f(e.r)} 0 ${large} 1 ${f(ex)} ${f(ey)}"/>`);
    } else {
      const rot = e.rot ? ` rotate(${f(-e.rot)})` : '';
      push(
        e.layer,
        `<text transform="translate(${f(e.x)} ${f(e.y)}) scale(1 -1)${rot}" font-size="${f(e.h)}">${esc(e.s)}</text>`,
      );
    }
  }
  const groups: string[] = [];
  for (const [layer, items] of byLayer) {
    const style = layers[layer] ?? { color: '#000000' };
    groups.push(
      `<g class="layer" data-layer="${esc(layer)}" stroke="${style.color}" fill="${style.color}">${items.join('')}</g>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(extent.w)} ${f(extent.h)}" width="${f(extent.w)}mm" height="${f(extent.h)}mm"` +
    ` fill="none" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="round"` +
    ` font-family="Helvetica, Arial, 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif">` +
    `<style>line,circle,path{fill:none;vector-effect:non-scaling-stroke}text{stroke:none}</style>` +
    `<g transform="translate(0 ${f(extent.h)}) scale(1 -1)">${groups.join('')}</g></svg>`
  );
}

/** 図枠の作図領域（mm）に収まる、いちばん大きい標準縮尺（1:n の n）。ElectraCAD 側の参考実装と同じ式 */
export function fitScale(extent: { w: number; h: number }, area: { w: number; h: number }): number {
  for (const n of STANDARD_SCALES) {
    if (extent.w / n <= area.w && extent.h / n <= area.h) return n;
  }
  const n = Math.max(extent.w / area.w, extent.h / area.h);
  return Math.ceil(n * 10) / 10;
}

export function buildElectraFile(
  job: ElectraJob,
  panel: ElectraFile['panel'],
  sheets: ElectraSheet[],
  now = new Date(),
): ElectraFile {
  return {
    format: ELECTRA_FORMAT,
    version: ELECTRA_VERSION,
    generator: 'Panel Studio',
    exportedAt: now.toISOString(),
    units: 'mm',
    coordinates: '左下が原点 (0,0)、X は右向き、Y は上向き。角度は度・反時計回り。各シートの実寸は extent。',
    standardScales: STANDARD_SCALES,
    job,
    panel,
    sheets,
  };
}
