import type { DuctSpec, PanelSpec, Profile } from '../types';

/**
 * 盤マスタのサンプル。
 *
 * ⚠ 寸法は仮値です。DXF 取り込みで型式ごとに実寸を確定し、ここを育てていく想定です。
 *    特に depth.backToPlate はメーカー図面の値が実物と合わないため、必ず手入力で
 *    上書きします。
 *
 * TODO: 実案件で使っているのは日東工業の「ステンレス SR形 制御盤キャビネット(IP54)」。
 *       型式と中板の有効寸法を確定してここへ登録する。
 *       換気ファン／ルーバーの取付位置による中板の使用不可領域も要検討。
 *       詳細は docs/02-drawing-conventions.md を参照。
 */
export const SAMPLE_ENCLOSURES: PanelSpec[] = [
  {
    model: '壁掛 600x800（仮）',
    outer: { w: 600, h: 800, d: 200 },
    plate: { w: 540, h: 740 },
    depth: { backToPlate: 40, doorProjection: 60 },
  },
  {
    model: '壁掛 700x1000（仮）',
    outer: { w: 700, h: 1000, d: 250 },
    plate: { w: 640, h: 940 },
    depth: { backToPlate: 45, doorProjection: 70 },
  },
  {
    model: '壁掛 800x1200（仮）',
    outer: { w: 800, h: 1200, d: 250 },
    plate: { w: 740, h: 1140 },
    depth: { backToPlate: 45, doorProjection: 70 },
  },
  {
    model: '壁掛 500x600（仮）',
    outer: { w: 500, h: 600, d: 200 },
    plate: { w: 440, h: 540 },
    depth: { backToPlate: 40, doorProjection: 55 },
  },
];

/** DINレールの高さ。奥行き方向の干渉判定でこの分を機器に加算する。 */
export const DIN_RAIL_HEIGHT = 7.5;

/** DINレール(TH35)の幅。正面視ではこの高さの帯として描かれる。 */
export const DIN_RAIL_WIDTH = 35;

/**
 * 配線ダクトのサンプル。
 *
 * ⚠ 型式・寸法は仮値です。実案件で使う前にメーカーのカタログで確認してください。
 */
export const SAMPLE_DUCTS: DuctSpec[] = [
  { id: 'duct-40x40', maker: '—', model: '配線ダクト 40×40', width: 40, height: 40, stock: 2000 },
  { id: 'duct-50x50', maker: '—', model: '配線ダクト 50×50', width: 50, height: 50, stock: 2000 },
  { id: 'duct-60x60', maker: '—', model: '配線ダクト 60×60', width: 60, height: 60, stock: 2000 },
  { id: 'duct-80x50', maker: '—', model: '配線ダクト 80×50', width: 80, height: 50, stock: 2000 },
  { id: 'duct-100x50', maker: '—', model: '配線ダクト 100×50', width: 100, height: 50, stock: 2000 },
];

export const DEFAULT_PROFILE: Profile = {
  schemaVersion: 1,
  profileName: '標準',
  duct: {
    layout: 'horizontal-rows',
    ductId: 'duct-50x50',
    width: 50,
    rowHeightMode: 'auto',
    rowCount: 3,
    margin: { top: 30, bottom: 30, left: 30, right: 30 },
    rowGaps: {},
    fixing: { points: 3, tap: 'M4', pitch: 0, endOffset: 30 },
  },
  rail: {
    endMargin: 20,
    fixing: { points: 3, tap: 'M4', pitch: 0, endOffset: 25 },
  },
  clearance: {
    deviceToDuct: { top: 10, bottom: 10, left: 10, right: 10 },
    deviceToDevice: { sameRow: 5, betweenRows: 10 },
    deviceToPlateEdge: 20,
    heatExtra: 20,
  },
  bom: {
    // 国内 ERP は Shift-JIS 指定のことが多いので既定を cp932 にしている。
    // ERP の取込仕様が判明したら、この設定を変えるだけで対応できる。
    encoding: 'cp932',
    delimiter: ',',
    withHeader: true,
    columns: ['model', 'maker', 'name', 'qty', 'unit'],
  },
};

export const DUCT_LAYOUT_LABEL: Record<Profile['duct']['layout'], string> = {
  'horizontal-rows': '横ダクト段組み',
  'horizontal-left': '横ダクト段組み ＋ 左ダクト1列',
  'horizontal-right': '横ダクト段組み ＋ 右ダクト1列',
  perimeter: '横ダクト段組み ＋ 全周囲い',
  'vertical-sides': '縦ダクト両サイド',
  cross: '田の字（外周＋十字）',
  zoned: 'ゾーン分割（動力／制御）',
  'terminal-bottom': '端子台最下段専用',
};

/** レイアウトごとの説明。選んだときに何が変わるかを示す。 */
export const DUCT_LAYOUT_HINT: Record<Profile['duct']['layout'], string> = {
  'horizontal-rows': '段と段の間に横ダクトを通します。いちばん一般的な組み方です。',
  'horizontal-left':
    '横ダクト段組みに、左端の縦ダクトを1列足します。幹線を左で縦に落として各段へ振り分ける組み方です。',
  'horizontal-right':
    '横ダクト段組みに、右端の縦ダクトを1列足します。盤の右から線を入れる場合に使います。',
  perimeter:
    '左右の縦ダクトと上下端の横ダクトで外周を囲み、段間にも横ダクトを通します。どの向きにも配線を逃がせます。',
  'vertical-sides':
    '両サイドに縦ダクトを立て、段間には入れません。配線を左右へ逃がすぶん、段を詰めて置けます。',
  cross: '両サイドと中央に縦ダクト、段間にも横ダクト。中央の縦ダクトで段が左右に分かれます。',
  zoned:
    '中央の縦ダクトで左を動力（ブレーカ・電磁接触器）、右を制御に分けます。段間には横ダクトを通します。',
  'terminal-bottom': '横ダクト段組みのまま、端子台だけを最下段にまとめます。',
};

/** まだ実装できていないダクトレイアウト。UI では選べないようにする。 */
export const DUCT_LAYOUT_READY: Record<Profile['duct']['layout'], boolean> = {
  'horizontal-rows': true,
  'horizontal-left': true,
  'horizontal-right': true,
  perimeter: true,
  'vertical-sides': true,
  cross: true,
  zoned: true,
  'terminal-bottom': true,
};
