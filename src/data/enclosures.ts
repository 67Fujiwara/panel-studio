import type { PanelSpec, Profile } from '../types';

/**
 * 盤マスタのサンプル。
 *
 * ⚠ 寸法は仮値です。DXF 取り込み（Phase 3）で型式ごとに実寸を確定し、
 *    ここを育てていく想定です。特に depth.backToPlate は
 *    メーカー図面の値が実物と合わないため、必ず手入力で上書きします。
 *
 * TODO: 実案件で使っているのは日東工業の「ステンレス SR形 制御盤キャビネット(IP54)」。
 *       型式と中板の有効寸法を確定してここへ登録する。
 *       換気ファン／ルーバーの取付位置による中板の使用不可領域も要検討。
 *       詳細は docs/02-drawing-conventions.md を参照。
 */
export const SAMPLE_ENCLOSURES: PanelSpec[] = [
  {
    model: '壁掛 600×800（仮）',
    plate: { w: 540, h: 740 },
    depth: { outer: 200, backToPlate: 40, doorProjection: 30 },
  },
  {
    model: '壁掛 700×1000（仮）',
    plate: { w: 640, h: 940 },
    depth: { outer: 250, backToPlate: 45, doorProjection: 30 },
  },
  {
    model: '壁掛 800×1200（仮）',
    plate: { w: 740, h: 1140 },
    depth: { outer: 250, backToPlate: 45, doorProjection: 35 },
  },
  {
    model: '壁掛 500×600（仮）',
    plate: { w: 440, h: 540 },
    depth: { outer: 200, backToPlate: 40, doorProjection: 25 },
  },
];

/** DINレールの高さ。奥行き方向の干渉判定でこの分を機器に加算する。 */
export const DIN_RAIL_HEIGHT = 7.5;

export const DEFAULT_PROFILE: Profile = {
  schemaVersion: 1,
  profileName: '標準',
  duct: {
    layout: 'horizontal-rows',
    width: 50,
    rowCount: 3,
    margin: { top: 30, bottom: 30, left: 30, right: 30 },
  },
  clearance: {
    deviceToDuct: { top: 10, bottom: 10, left: 10, right: 10 },
    deviceToDevice: { sameRow: 5, betweenRows: 10 },
    deviceToPlateEdge: 20,
    heatExtra: 20,
  },
};

export const DUCT_LAYOUT_LABEL: Record<Profile['duct']['layout'], string> = {
  'horizontal-rows': '横ダクト段組み',
  'vertical-sides': '縦ダクト両サイド',
  cross: '田の字（外周＋十字）',
  zoned: 'ゾーン分割（動力／制御）',
  'terminal-bottom': '端子台最下段専用',
};
