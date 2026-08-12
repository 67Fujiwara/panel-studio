// 盤内レイアウトと BOM が共有する唯一の型定義。
// 各面の座標系は「面の左下を原点、X 右、Y 上、単位 mm」で統一する。

/** 取付方式。direct は面に直接ネジ留めすること。 */
export type MountType = 'din' | 'direct';

/** 制御盤の面。中板だけが配線ダクトを持ち、他の面は直付けのみ。 */
export type FaceId = 'plate' | 'door' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** カテゴリは ConfigFile 画面で増やせるようにするため、固定の union にしない。 */
export type DeviceCategory = string;

/** 部品表のカテゴリ定義。ConfigFile 画面で編集する。 */
export type CategoryDef = {
  id: DeviceCategory;
  label: string;
  color: string;
};

export type Sides = { top: number; bottom: number; left: number; right: number };

/** 取付穴。ピッチと穴径を持つ。直付けのケガキ座標と加工リストに使う。 */
export type MountHoles = {
  /** 穴の並び。横×縦のピッチ(mm)。1列なら片方を 0 にする */
  pitchX: number;
  pitchY: number;
  /** 横方向・縦方向の穴の数 */
  countX: number;
  countY: number;
  /** 穴径(mm) */
  dia: number;
};

/** 部品の出どころ。共通の部品表か、担当者ごとの My部品か。 */
export type PartSource = 'config' | 'my';

/**
 * 部品の外形線。CAD から取り込んだ図形を、部品の左下を原点とした mm 座標で持つ。
 * JSON に書き出すので、キーは短くしてある。
 */
export type ShapeEntity =
  /** 折れ線。pts は [x0,y0,x1,y1,...] */
  | { t: 'p'; pts: number[]; c?: boolean }
  /** 円 */
  | { t: 'c'; x: number; y: number; r: number }
  /** 円弧。角度はラジアン */
  | { t: 'a'; x: number; y: number; r: number; a0: number; a1: number };

export type DeviceShape = {
  /** 取り込んだときの外接寸法。表示時はこれを外形サイズに合わせて拡縮する */
  w: number;
  h: number;
  entities: ShapeEntity[];
};

/** 機器マスタの1件。レイアウトと BOM の両方がここを参照する。 */
export type DeviceSpec = {
  id: string;
  maker: string;
  /** 型式。BOM のキーになる */
  model: string;
  name: string;
  category: DeviceCategory;
  /** config = 共通の部品表 / my = 担当者ごとの My部品 */
  source?: PartSource;
  /** My部品のときの担当者名 */
  owner?: string;
  /** 取付穴のピッチと径 */
  mountHoles?: MountHoles;
  /** CAD から取り込んだ外形線。無ければただの四角で描く */
  shape?: DeviceShape;
  /**
   * DINレールからの上下オフセット(mm)。0 ならレール中心に合わせる。
   * 機器によってレールに対する掛かり位置が違うので、部品ごとに持たせる。
   */
  dinOffset?: number;
  /** w=幅, h=高さ, d=取付面からの突出（DINレール取付時はレール高さが別途加算される） */
  size: { w: number; h: number; d: number };
  /** 対応する取付方式。両対応の機器は案件ごとに選ばせる */
  mount: MountType[];
  /**
   * メーカー指定の最小離隔。グローバル設定を下回らせないため、
   * 実効値は max(グローバル設定, ここの値) を採る。
   */
  clearance?: Partial<Sides>;
  /** 発熱量。盤内温度上昇の計算に使う */
  heatW?: number;
  /** 扉・側面などに取り付けるとき、面に開ける穴 */
  panelCutout?: { kind: 'hole'; dia: number } | { kind: 'notch'; w: number; h: number };
};

/** 面上に配置された機器1台。 */
export type PlacedDevice = {
  uid: string;
  specId: string;
  face: FaceId;
  mount: MountType;
  /** 機器の左下角の座標(mm) */
  x: number;
  y: number;
  /** 属する機器行。自由配置の面では -1 */
  row: number;
  /**
   * 人が手で動かした機器は true。
   * 再配置のとき pinned は動かさないことで「1台足したら全部組み替わる」のを防ぐ。
   */
  pinned: boolean;
};

/** タップ（ねじ）穴の呼び。 */
export type TapSize = 'M3' | 'M4' | 'M5' | 'M6';

/**
 * 面に施す加工の中身。穴あけと切り欠き。
 * 穴は「バカ穴（径指定）」と「タップ穴（呼び指定）」を切り替えられる。
 * タップのときの dia は下穴径。
 */
export type MachiningDraft =
  | { kind: 'hole'; x: number; y: number; dia: number; tap?: TapSize; note?: string }
  /** 切り欠きも x,y は「中心」座標 */
  | { kind: 'notch'; x: number; y: number; w: number; h: number; note?: string };

/** 面に施す加工。 */
export type Machining = MachiningDraft & { id: string; face: FaceId };

/** 盤（キャビネット）1台。外形と中板から6面の作図寸法を導く。 */
export type PanelSpec = {
  model: string;
  /** 盤の外形 */
  outer: { w: number; h: number; d: number };
  /** 中板(取付板)の有効寸法 */
  plate: { w: number; h: number };
  depth: {
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

/**
 * 段ごとの余白の上書き。
 * top/bottom は上下のダクトとの余白、left/right は面の端からの余白。
 * left/right を省いた古いファイルも読めるよう任意にしてある。
 */
export type RowGap = { top: number; bottom: number; left?: number; right?: number };

export type DuctSettings = {
  layout: DuctLayoutId;
  /** ダクト幅 40/50/60/80/100 */
  width: number;
  rowHeightMode: RowHeightMode;
  /** 機器行の数。equal のときだけ使う */
  rowCount: number;
  /** 面の端からの余白 */
  margin: Sides;
  /**
   * 段ごとの余白。段番号をキーにした上書き。
   * 指定がない段は上下が clearance.deviceToDuct、左右が margin。
   */
  rowGaps: Record<number, RowGap>;
};

export type ClearanceSettings = {
  /** 機器 ⇔ ダクト */
  deviceToDuct: Sides;
  /** 機器 ⇔ 機器 */
  deviceToDevice: { sameRow: number; betweenRows: number };
  /** 機器 ⇔ 面の端 */
  deviceToPlateEdge: number;
  /** 発熱機器に追加で確保する離隔 */
  heatExtra: number;
};

/** BOM の書き出し設定。ERP の取込仕様に合わせて差し替えられるようにしておく。 */
export type BomSettings = {
  /** 国内 ERP は Shift-JIS 指定のことが多い */
  encoding: 'cp932' | 'utf8';
  delimiter: ',' | '\t' | ';';
  withHeader: boolean;
  /** 出力する列と並び順 */
  columns: BomColumnId[];
};

export type BomColumnId = 'model' | 'maker' | 'name' | 'qty' | 'unit' | 'source';

/** My設定ファイル（*.panelstudio.json）。schemaVersion は最初から入れる。 */
export type Profile = {
  schemaVersion: 1;
  profileName: string;
  duct: DuctSettings;
  clearance: ClearanceSettings;
  bom: BomSettings;
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
  kind: 'overflow' | 'depth' | 'clearance' | 'overlap' | 'cut-overlap';
  message: string;
};

/**
 * 1本の配線ダクト。id は上から数えた通し番号で、
 * 途中のダクトを消しても他の番号がずれないようにしてある（消したダクトの記憶に使う）。
 *
 * 消したダクトも位置を保ったまま removed で残す。図の上に薄く出して、
 * 押せば元に戻せるようにするため（消したら二度と戻せない、を避ける）。
 */
export type Duct = Rect & { id: number; removed?: boolean };

export type LayoutResult = {
  rows: DeviceRow[];
  ducts: Duct[];
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
