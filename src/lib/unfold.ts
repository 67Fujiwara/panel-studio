import type { FaceId, PanelSpec } from '../types';

/** 展開図の面と面のすき間(mm 相当) */
export const UNFOLD_GAP = 40;

export type UnfoldCell = { id: FaceId; x: number; y: number; w: number; h: number };

/**
 * 制御盤を第三角法で並べたときの各面の位置。
 *
 *            上面
 *   左側面   正面   右側面   背面
 *            底面
 *
 * 中板は箱の一部ではないので、下に離して置く。
 * 面選択の図と DXF 書き出しが同じ並びになるよう、ここに1本化してある。
 */
export function unfoldCells(panel: PanelSpec): { cells: UnfoldCell[]; w: number; h: number } {
  const { w: W, h: H, d: D } = panel.outer;
  const { w: pw, h: ph } = panel.plate;
  const G = UNFOLD_GAP;

  const xLeft = 0;
  const xDoor = D + G;
  const xRight = xDoor + W + G;
  const xBack = xRight + D + G;

  const yTop = 0;
  const yMid = D + G;
  const yBottom = yMid + H + G;
  const yPlate = yBottom + D + G * 1.6;

  const cells: UnfoldCell[] = [
    { id: 'top', x: xDoor, y: yTop, w: W, h: D },
    { id: 'left', x: xLeft, y: yMid, w: D, h: H },
    { id: 'door', x: xDoor, y: yMid, w: W, h: H },
    { id: 'right', x: xRight, y: yMid, w: D, h: H },
    { id: 'back', x: xBack, y: yMid, w: W, h: H },
    { id: 'bottom', x: xDoor, y: yBottom, w: W, h: D },
    { id: 'plate', x: xDoor, y: yPlate, w: pw, h: ph },
  ];

  return { cells, w: xBack + W, h: yPlate + ph };
}
