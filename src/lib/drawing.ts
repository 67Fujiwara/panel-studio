/**
 * 図面書き出しの共通部分。DXF と PDF が同じ描画命令を受け取れるようにする。
 *
 * dxfExport ⇄ pdfExport で互いに import すると循環になる（モジュール初期化中に
 * LAYER を触って未初期化エラー）ので、両方が使うものはこの小さなファイルに置く。
 */

/** レイヤ名。DXF ではそのままレイヤに、PDF では色分けに使う */
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
  /** 風船番号（丸囲みの番号と引き出し線）。図の機器が何かを部品表で引くためのもの */
  balloon: '図面-風船',
  /** 図の余白に置く部品表（No. / 型式 / 品名 / メーカー / 数量） */
  table: '図面-部品表',
  /** 面の内側に付けた機器（外から見えないので、図では破線・別レイヤ） */
  inside: '機器-内側',
  /** ほかの面に付けた機器の投影（干渉確認・位置の参考。薄い線） */
  proj: '機器-投影',
} as const;

/** 図面に線・円・弧・文字を置く口。座標は mm・左下原点・Y 上向き、角度はラジアン */
export interface Drawer {
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void;
  rect(layer: string, x: number, y: number, w: number, h: number): void;
  circle(layer: string, cx: number, cy: number, r: number): void;
  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number): void;
  text(layer: string, x: number, y: number, height: number, s: string, rotation?: number): void;
}
