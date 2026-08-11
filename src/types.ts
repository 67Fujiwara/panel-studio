// 盤内レイアウトと BOM が共有する唯一の型定義。
// 座標系は「中板(取付板)の左下を原点、X 右、Y 上、単位 mm」で統一する。

export type MountType = 'din' | 'plate';

export type DeviceCategory =
  | 'breaker'
  | 'contactor'
  | 'relay'
  | 'plc'
  | 'psu'
  | 'terminal'
  | 'other';

export type Sides = { top: number; bottom: number; left: number; right: number };

/** 機器マスタの1件。レイアウトと BOM の両方がここを参照する。 */
export type DeviceSpec = {
  id: string;
  maker: string;
  /** 型式。BOM のキーになる */
  model: string;
  name: string;
  category: DeviceCategory;
  /** w=幅, h=高さ, d=中板面からの突出（DINレール取付時はレール高さが別途加算される） */
  size: { w: number; h: number; d: number };
  /** 対応する取付方式。両対応の機器は案件ごとに選ばせる */
  mount: MountType[];
  /**
   * メーカー指定の最小離隔。グローバル設定を下回らせないため、
   * 実効値は max(グローバル設定, ここの値) を採る。
   */
  clearance?: Partial<Sides>;
  /** 発熱量。盤内温度上昇の計算に使う（v2） */
  heatW?: number;
};

/** 中板上に配置された機器1台。 */
export type PlacedDevice = {
  uid: string;
  specId: string;
  mount: MountType;
  /** 機器の左下角の座標(mm) */
  x: number;
  y: number;
  /** 属する機器行 */
  row: number;
  /**
   * 人が手で動かした機器は true。
   * 再配置のとき pinned は動かさないことで「1台足したら全部組み替わる」のを防ぐ。
   */
  pinned: boolean;
};

/** 盤（キャビネット）1面。v1 は単一中板の壁掛キャビネットのみ扱う。 */
export type PanelSpec = {
  model: string;
  /** 中板(取付板)の有効寸法 */
  plate: { w: number; h: number };
  depth: {
    /** 盤外形の奥行き */
    outer: number;
    /**
     * 背面内側 → 中板上面 の距離。
     * メーカー図面の値が実物と合わないため手入力する。
     */
    backToPlate: number;
    /** 扉裏の突出量（ハンドル・扉面機器） */
    doorProjection: number;
  };
};

export type DuctLayoutId =
  | 'horizontal-rows'
  | 'vertical-sides'
  | 'cross'
  | 'zoned'
  | 'terminal-bottom';

/**
 * 機器行の高さの決め方。
 * - equal: 全段を同じ高さで割り付ける（段数を指定）
 * - auto : 段に入った機器の背丈から段ごとに高さを決める（実際の盤に近い）
 */
export type RowHeightMode = 'equal' | 'auto';

export type DuctSettings = {
  layout: DuctLayoutId;
  /** ダクト幅 40/50/60/80/100 */
  width: number;
  rowHeightMode: RowHeightMode;
  /** 機器行の数。equal のときだけ使う */
  rowCount: number;
  /** 中板端からの余白 */
  margin: Sides;
};

/** DXF 出力の設定。レイヤ名は社内規則に合わせて差し替えられるようにしておく。 */
export type DrawingSettings = {
  layers: {
    plate: string;
    duct: string;
    device: string;
    text: string;
    rail: string;
  };
  /** 機器名の文字高さ(mm) */
  textHeight: number;
};

export type ClearanceSettings = {
  /** 機器 ⇔ ダクト */
  deviceToDuct: Sides;
  /** 機器 ⇔ 機器 */
  deviceToDevice: { sameRow: number; betweenRows: number };
  /** 機器 ⇔ 中板端 */
  deviceToPlateEdge: number;
  /** 発熱機器に追加で確保する離隔 */
  heatExtra: number;
};

/** My設定ファイル（*.panelstudio.json）。schemaVersion は最初から入れる。 */
export type Profile = {
  schemaVersion: 1;
  profileName: string;
  duct: DuctSettings;
  clearance: ClearanceSettings;
  drawing: DrawingSettings;
};

export type Rect = { x: number; y: number; w: number; h: number };

/** 機器を並べる1行。 */
export type DeviceRow = {
  index: number;
  /** 行の下端 Y と高さ */
  y: number;
  h: number;
};

export type Violation = {
  uid: string;
  kind: 'overflow' | 'depth' | 'clearance' | 'overlap';
  message: string;
};

export type LayoutResult = {
  rows: DeviceRow[];
  ducts: Rect[];
  placed: PlacedDevice[];
  violations: Violation[];
};

export type BomLine = {
  model: string;
  maker: string;
  name: string;
  qty: number;
  unit: string;
  /** 機器本体か、DINレール等の派生部品か */
  source: 'device' | 'derived';
};
