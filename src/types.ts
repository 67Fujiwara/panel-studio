
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

/** 機器の向き。図の上でダブルクリックすると 90° ずつ回る。 */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * 向きを踏まえた見かけの寸法。90/270 では幅と高さが入れ替わる。
 * 配置・作図・加工の座標がすべてこれを基準にする。
 */
export function rotatedSize(size: { w: number; h: number }, rot: Rotation | undefined) {
  return rot === 90 || rot === 270 ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

/** 面上に配置された機器1台。 */
export type PlacedDevice = {
  uid: string;
  specId: string;
  face: FaceId;
  mount: MountType;
  /** 向き(0/90/180/270)。既定は 0 */
  rot?: Rotation;
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

/**
 * 加工有効範囲から除く矩形。ボルトホルダーや中板の四隅の角欠きなど。
 *
 * 位置は**面の角からの距離**で持つ。盤の大きさが変わっても付いてくるようにするため。
 * メーカーの加工有効範囲図も「右上から 35・7」のように角基準で書かれている。
 */
export type AreaExclude = {
  /** 基準にする角 */
  anchor: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** 基準の角から矩形の近い側の辺までの距離(mm) */
  dx: number;
  dy: number;
  w: number;
  h: number;
  /** 何を避けているか（ボルトホルダー・接地端子など） */
  note?: string;
};

/**
 * 面1つぶんの加工有効範囲。
 *
 * メーカーの「加工有効範囲図」は**模式図で、寸法値どおりに図形が描かれていない**ため、
 * 図そのものを取り込む道はない。代わりに数値だけを型式ごとに1回登録して使い回す。
 * 端からの入り込みは W・H・D が変わっても同じ値なので、シリーズ単位で効く。
 */
export type FaceWorkArea = {
  /** 面の端からの入り込み(mm)。ここより内側だけが加工できる */
  inset: Sides;
  /** さらに除く矩形 */
  excludes: AreaExclude[];
};

/** 面ごとの加工有効範囲。登録が無い面は「面いっぱい使える」とみなす。 */
export type WorkArea = Partial<Record<FaceId, FaceWorkArea>>;

/** 盤（キャビネット）1台。外形と中板から6面の作図寸法を導く。 */
export type PanelSpec = {
  model: string;
  /** 盤の外形 */
  outer: { w: number; h: number; d: number };
  /** 中板(取付板)の有効寸法 */
  plate: { w: number; h: number };
  /**
   * 奥行きの内訳。**null は「まだ入れていない」**。
   *
   * メーカー図面の値が実物と合わないので、ここだけは前の案件の値を引き継がず
   * 毎回入れ直す。既定値を置くと「入っているから正しい」と読めてしまい、
   * 確認しないまま図面が出る。新規作成では null にして、入るまで先へ進ませない。
   */
  depth: {
    /**
     * 背面内側 → 中板上面 の距離。
     * メーカー図面の値が実物と合わないため手入力する。
     */
    backToPlate: number | null;
    /** 扉裏の突出量（ハンドル・扉面機器） */
    doorProjection: number | null;
  };
  /**
   * 面ごとの加工有効範囲。型式（シリーズ）ごとに1回登録して使い回す。
   * 未登録の面は面いっぱい使える扱い（判定しない）。
   */
  workArea?: WorkArea;
};

export type DuctLayoutId =
  | 'horizontal-rows'
  | 'horizontal-left'
  | 'horizontal-right'
  | 'perimeter'
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
 * ダクト1本ごとの調整。
 *
 * 人はダクトの本数で数えるので、機器の段ではなく**ダクトを単位**にして持つ。
 * above/below はそのダクトの上下にある機器との余白、left/right はそのダクトの
 * 左右の位置（面の端からの余白）。省いた項目は共通の設定を使う。
 */
export type DuctGap = {
  /** このダクトの上にある機器との余白 */
  above?: number;
  /** このダクトの下にある機器との余白 */
  below?: number;
  /** 面の左端からの位置 */
  left?: number;
  /** 面の右端からの位置 */
  right?: number;
  /** この1本だけ別の型式を使うときの指定。図の上でダブルクリックすると切り替わる */
  ductId?: string;
  /** ductId のダクト幅の控え。配置計算はマスタを持たないのでここに書き写す */
  width?: number;
};

/**
 * 配線ダクト1品種。部品と同じように型式で登録して選ぶ。
 * 数値を都度打ち込むと、実在しない寸法の組み合わせが図に出てしまうため。
 */
export type DuctSpec = {
  id: string;
  maker: string;
  /** 型式。BOM のキーになる */
  model: string;
  /** 幅(mm)。図では帯の太さになる */
  width: number;
  /** 高さ(mm)。中板からの立ち上がり。奥行きの目安に使う */
  height: number;
  /** 定尺(mm)。必要本数の計算に使う */
  stock: number;
};

export type DuctSettings = {
  layout: DuctLayoutId;
  /** 使うダクトの型式。ダクトマスタを引く */
  ductId: string;
  /** ダクト幅。ductId が見つからないときの控え */
  width: number;
  rowHeightMode: RowHeightMode;
  /** 機器行の数。equal のときだけ使う */
  rowCount: number;
  /** 面の端からの余白 */
  margin: Sides;
  /**
   * ダクトごとの調整。**上から数えたダクトの通し番号**をキーにする。
   * 指定がないダクトは上下が clearance.deviceToDuct、左右が margin。
   */
  ductGaps: Record<number, DuctGap>;
  /**
   * 縦ダクトごとの調整。**レイアウトの中での左からの順番**をキーにする。
   *
   * 横ダクトと通し番号を分けるのは、縦ダクトの番号が横ダクトの本数で動いてしまい、
   * 段を増やしただけで別のダクトの指定になってしまうため。左から何本目かは
   * レイアウトを変えない限り動かない。
   */
  vertGaps: Record<number, DuctGap>;
  /** ダクトを中板に留める穴 */
  fixing: FixingSettings;
};

/**
 * ダクト・DINレールを中板に留めるための穴。
 *
 * 実際の加工では「レール1本につき何か所、どのタップで」を先に決めてから
 * ピッチを割り付ける。ここもその順で持たせている。
 */
export type FixingSettings = {
  /** 1本あたりの固定か所 */
  points: number;
  /** 使うタップの呼び */
  tap: TapSize;
  /**
   * 穴のピッチ(mm)。0 なら「両端の余白を除いて等分」する。
   * 定尺の穴位置に合わせたいときだけ数値を入れる。
   */
  pitch: number;
  /** 端から最初の穴までの距離(mm) */
  endOffset: number;
};

/** DINレールの設定。長さの余長と固定穴。 */
export type RailSettings = {
  /** 機器の端からレール端までの余長(mm)。エンドストッパのぶん */
  endMargin: number;
  fixing: FixingSettings;
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

/**
 * AI 自動配置の接続先。
 *
 * ⚠ API キーは**ブラウザにだけ**置く。設定 JSON にも完了案件にも書き出さない。
 * 共有フォルダに置く HTML にキーを埋めると、フォルダを見られる全員が使えてしまう。
 * 人数が増えたら社内にプロキシを立てて、キーはそちらに持たせる運用にする。
 */
export type AiSettings = {
  /** 送信先。Anthropic 直か、社内プロキシの URL */
  endpoint: string;
  model: string;
  /** ブラウザに置く API キー。プロキシ運用なら空のまま */
  apiKey: string;
  /**
   * 不採用のときに書いてもらう「うちの作法」。
   *
   * ⚠ これはモデルを学習させるものではない（API 越しに学習はできない）。
   *    次からの依頼に**指示として毎回添える**もの。効き方は指示文と同じ。
   */
  houseRules?: string[];
  /** ブラウザから直に Anthropic を叩くときの許可ヘッダを付ける */
  directBrowser: boolean;
  maxTokens: number;
};

/** My設定ファイル（*.panelstudio.json）。schemaVersion は最初から入れる。 */
export type Profile = {
  schemaVersion: 1;
  profileName: string;
  duct: DuctSettings;
  rail: RailSettings;
  clearance: ClearanceSettings;
  bom: BomSettings;
};

export type Rect = { x: number; y: number; w: number; h: number };

/** 型式ID からダクト仕様を引く。登録が消えていても図が出せるよう控えを返す。 */
function ductSpecById(
  profile: Profile,
  ducts: DuctSpec[],
  perId: string | undefined,
  fallbackWidth: number,
): DuctSpec {
  const found = ducts.find((d) => d.id === (perId ?? profile.duct.ductId));
  return (
    found ?? {
      id: '',
      maker: '—',
      model: `配線ダクト 幅${fallbackWidth}`,
      width: fallbackWidth,
      height: fallbackWidth,
      stock: 2000,
    }
  );
}

/**
 * 横ダクトの仕様。ductIndex を渡すと、その1本だけの型式指定を優先する。
 */
export function ductSpecOf(profile: Profile, ducts: DuctSpec[], ductIndex?: number): DuctSpec {
  const per = ductIndex === undefined ? undefined : profile.duct.ductGaps?.[ductIndex]?.ductId;
  return ductSpecById(profile, ducts, per, ductWidthOf(profile, ductIndex));
}

/** 縦ダクトの仕様。vertIndex は左から何本目か。 */
export function ductSpecOfVert(profile: Profile, ducts: DuctSpec[], vertIndex: number): DuctSpec {
  const per = profile.duct.vertGaps?.[vertIndex]?.ductId;
  return ductSpecById(profile, ducts, per, vertWidthOf(profile, vertIndex));
}

/** その横ダクト1本の幅。1本だけ別の型式にしているならそちらを使う。 */
export function ductWidthOf(profile: Profile, ductIndex?: number): number {
  if (ductIndex === undefined) return profile.duct.width;
  return profile.duct.ductGaps?.[ductIndex]?.width ?? profile.duct.width;
}

/** その縦ダクト1本の幅（＝図の上では帯の太さ）。 */
export function vertWidthOf(profile: Profile, vertIndex: number): number {
  return profile.duct.vertGaps?.[vertIndex]?.width ?? profile.duct.width;
}

/** 図の上でダクトを1本名指しするときの指定。'all' は盤ぜんたい。 */
export type DuctTarget = number | 'all' | { vert: number };

/** そのダクトに効いている仕様を引く。横・縦・盤ぜんたいをまとめて扱う。 */
export function ductSpecAt(profile: Profile, ducts: DuctSpec[], target: DuctTarget): DuctSpec {
  if (target === 'all') return ductSpecOf(profile, ducts);
  if (typeof target === 'number') return ductSpecOf(profile, ducts, target);
  return ductSpecOfVert(profile, ducts, target.vert);
}

/** 機器を並べる1行。 */
export type DeviceRow = {
  index: number;
  /** 行の下端 Y と高さ */
  y: number;
  h: number;
};

export type Violation = {
  uid: string;
  kind: 'overflow' | 'depth' | 'clearance' | 'overlap' | 'cut-overlap' | 'out-of-area';
  message: string;
};

/**
 * 1本の配線ダクト。id は上から数えた通し番号で、
 * 途中のダクトを消しても他の番号がずれないようにしてある（消したダクトの記憶に使う）。
 *
 * 消したダクトも位置を保ったまま removed で残す。図の上に薄く出して、
 * 押せば元に戻せるようにするため（消したら二度と戻せない、を避ける）。
 */
export type Duct = Rect & {
  id: number;
  removed?: boolean;
  /**
   * 縦ダクトなら、レイアウトの中で左から何本目か。横ダクトでは付かない。
   * 太さや向きから縦横を当てにいくと、幅の広い縦ダクトで判定が裏返るため、
   * 作った側で明示する。
   */
  vert?: number;
};

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
  /**
   * 単価表を引くときの型番。model は「（必要長 3000mm）」のような但し書きが
   * 付くことがあるので、突き合わせ用に素の型番を別に持つ。
   */
  key?: string;
};

/**
 * 単価表の1件。型番をキーにして持つ。
 *
 * 部品マスタではなく型番の表にするのは、DINレール・ダクト・ネジのような
 * 派生部品にも値段が要るため（あれらは DeviceSpec ではない）。
 */
export type PriceEntry = {
  /** 単価(円) */
  unit: number;
  /** 仕入先。ミスミ以外もあるので文字列で持つ */
  supplier?: string;
  /** いつ時点の値か。見積は水物なので必ず出す */
  at?: string;
};

/** 型番 → 単価。 */
export type PriceBook = Record<string, PriceEntry>;
