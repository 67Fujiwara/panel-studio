/**
 * ストアの形。中身は 5 つのスライスに分けてある（index.ts で 1 つに合わせる）。
 *
 *  - LayoutSlice   いま机に出している設計（盤・機器・加工・選択）と、その操作
 *  - ConfigSlice   マスタ（分類・部品・My部品・盤・ダクト・単価）
 *  - ProjectSlice  完了案件と作業中案件（机のしまい方・切り替え）
 *  - SettingsSlice 設定（profile: ダクト・レール・クリアランス・BOM・冷却）
 *  - AiSlice       AI 自動配置の接続先と案の採否
 */
import type { AiPlan } from '../lib/ai';
import type { CoolingConsts, CoolingInput } from '../lib/cooling';
import type { LayoutItem } from '../lib/layout';
import type {
  AiSettings,
  BomSettings,
  CategoryDef,
  ClearanceSettings,
  DeviceShape,
  DeviceSpec,
  DuctGap,
  DuctSettings,
  DuctSpec,
  DuctTarget,
  FaceId,
  Machining,
  MachiningDraft,
  MountSide,
  MountType,
  PanelSpec,
  PlacedDevice,
  PriceBook,
  Profile,
  RailSettings,
} from '../types';

export type Screen = 'start' | 'faces' | 'layout' | 'config' | 'myconfig' | 'projects';

/**
 * 設計完了した案件1件。
 *
 * 過去案件を振り返ったり、似た盤をリピートで作り直したりするための記録。
 * 図を作り直せるだけの情報（盤・設定・機器・加工）をまるごと持つ。
 */
export type Project = {
  id: string;
  /** 会社名（納入先） */
  company: string;
  /** 案件番号 */
  jobNo: string;
  /** 担当者 */
  owner: string;
  /** 設計完了日 (YYYY-MM-DD) */
  completedAt: string;
  note: string;
  panel: PanelSpec;
  profile: Profile;
  items: LayoutItem[];
  pinned: PlacedDevice[];
  machining: Machining[];
  removedDucts: Partial<Record<FaceId, number[]>>;
  underlays: Partial<Record<FaceId, DeviceShape>>;
  /**
   * 完了時点の部品（その案件で使ったものだけ）と分類。
   *
   * 記録は**その時に出した図そのもの**でなければ意味がない。マスタを参照すると、
   * あとで部品の寸法や離隔を直したときに、納品済みの案件の図と BOM まで
   * 変わってしまう。完了時に写しを持たせて、以後は動かないようにする。
   * 古い案件には無いので、そのときは現行マスタで読む。
   */
  devices?: DeviceSpec[];
  categories?: CategoryDef[];
  /** 完了時点のダクトマスタ（使ったものだけ） */
  ducts?: DuctSpec[];
};

/**
 * 作業中の案件1件（一時保存）。
 *
 * 設計完了までは机の上に出しっぱなしになるが、実務では
 * 「A の途中で B を急ぎで見てくれ」が普通に起きる。そのたびに
 * 完了させたり書き出したりせずに済むよう、**途中の机ごと**しまっておく。
 *
 * 中身は完了案件（Project）と同じ7点セット。違うのは「まだ完了していない」ことと、
 * 開いていた面まで覚えて戻れることだけ。
 */
export type Draft = {
  id: string;
  /** 表示名。案件番号や会社名を入れて見分ける */
  name: string;
  /** 最後にしまった時刻（ISO） */
  savedAt: string;
  /** しまったときに開いていた面。戻したらそこから続けられる */
  face: FaceId;
  panel: PanelSpec;
  profile: Profile;
  items: LayoutItem[];
  pinned: PlacedDevice[];
  machining: Machining[];
  removedDucts: Partial<Record<FaceId, number[]>>;
  underlays: Partial<Record<FaceId, DeviceShape>>;
  /** 盤サイズを確定済みか（古い案件には無い。無ければ奥行きの内訳が入っていれば確定済みとみなす） */
  sizeLocked?: boolean;
};

/**
 * 過去案件のファイル。共有フォルダに置いて全員で見る想定。
 * 作業中の案件も同じファイルに入れる（バックアップ1つで机ごと持ち運べるように）。
 */
export type ProjectFile = { schemaVersion: 1; projects: Project[]; drafts?: Draft[] };

/** ConfigFile 画面が読み書きするファイルの中身。 */
export type ConfigFile = {
  schemaVersion: 1;
  categories: CategoryDef[];
  devices: DeviceSpec[];
  profile: Profile;
  /** 盤マスタ。古いファイルには無いので任意 */
  enclosures?: PanelSpec[];
  /** ダクトマスタ。古いファイルには無いので任意 */
  ducts?: DuctSpec[];
  /** 単価表（型番→単価）。古いファイルには無いので任意 */
  prices?: PriceBook;
};

/** MyConfig 画面が読み書きするファイルの中身。共有フォルダに置いて全員で見る。 */
export type MyConfigFile = {
  schemaVersion: 1;
  owners: string[];
  devices: DeviceSpec[];
};

/** 採否待ちの案1件。 */
export type AiReview = {
  /** 1面だけか、全面まとめてか */
  scope: 'face' | 'all';
  /** scope === 'face' のときの対象面 */
  face?: FaceId;
  /** 見出しに出す一言 */
  msg: string;
  /** AI が書いた理由 */
  notes: string[];
  /** 全面まとめてのときの面ごとの結果 */
  results?: { face: FaceId; ok: boolean; text: string }[];
};

/**
 * バックアップの全部入り1ファイル。3種のファイルをそのまま入れ子にする。
 * 自動バックアップも一括書き出しもこれ1つ — ファイルが3つも4つもあると、
 * どれを持っていけばいいのか分からなくなる。
 */
export type BackupBundle = {
  schemaVersion: 1;
  kind: 'bundle';
  /** 書いた時刻（ISO）。別の PC で書かれた新しいものかを見分ける。古いファイルには無い */
  savedAt?: string;
  config: ConfigFile;
  my: MyConfigFile;
  projects: ProjectFile;
};

// ---------------------------------------------------------------------------
// スライス
// ---------------------------------------------------------------------------

/** いま机に出している設計と、図の上の操作。 */
export type LayoutSlice = {
  screen: Screen;
  face: FaceId;
  panel: PanelSpec;

  items: LayoutItem[];
  machining: Machining[];
  pinned: PlacedDevice[];
  selectedUid: string | null;
  /** 手動で追加した加工の選択。キャンバス上で強調するのに使う */
  selectedCut: string | null;
  /** 選択中のダクトの通し番号。Delete キーで消すのに使う */
  selectedDuct: number | null;
  /**
   * 選択中の DINレールの端。矢印キー ←→ でその端を伸び縮みさせる。
   * key は RailRun.key（段番号:何本目）。レールの左半分を押せば left、右半分なら right
   */
  selectedRail: { key: string; end: 'left' | 'right' } | null;
  /**
   * 矢印キーでダクトが動かせなかった理由。図の下の案内欄に出す。
   * 動かせたとき・別の操作をしたときに消える（保存しない）
   */
  nudgeNote: string | null;
  /** 面ごとに消したダクトの通し番号。下に余ったダクトを外すのに使う */
  removedDucts: Partial<Record<FaceId, number[]>>;
  /** 面ごとの下敷き。DXF から取り込んだ図をキャンバスの背景に敷く */
  underlays: Partial<Record<FaceId, DeviceShape>>;
  /**
   * 盤サイズを確定したか。「この寸法で進む」で true になり、盤サイズ画面の入力が
   * グレーアウトする。設計完了・案件の削除・新規作成のどれかでしか戻らない。
   * 設計の途中で寸法が動くと、並べた機器・加工がずれたまま図が出てしまうため。
   */
  sizeLocked: boolean;

  go: (screen: Screen) => void;
  /** 盤サイズを確定して面選択へ。以後、盤サイズ画面の入力は触れなくなる */
  confirmSize: () => void;
  setUnderlay: (face: FaceId, shape: DeviceShape | undefined) => void;
  openFace: (face: FaceId) => void;

  setPanel: (patch: Partial<PanelSpec>) => void;
  setOuter: (patch: Partial<PanelSpec['outer']>) => void;
  setPlate: (patch: Partial<PanelSpec['plate']>) => void;
  setDepth: (patch: Partial<PanelSpec['depth']>) => void;

  /** 使うダクトを選ぶ。幅も控えとして書き写す */
  selectDuctSpec: (id: string) => void;
  /**
   * ダクト1本の型式を決める（図の上でダブルクリックして選ぶ）。
   * 横ダクトは上からの通し番号、縦ダクトは `{ vert: 左から何本目 }`、
   * 'all' で盤ぜんたい。id を空にすると指定を外して盤ぜんたいの型式に戻す。
   */
  setDuctSpecAt: (target: DuctTarget, id: string) => void;
  /**
   * ダクト 1 本を矢印キーで微調整する。どこまで動かせるかは lib/layout/nudge.ts が決める。
   * - 横ダクト ←→: 左右の余白を同時に動かして全体をずらす（面の外へは出さない）
   * - 横ダクト ↑↓: 上の余白と下の余白を付け替えてダクトだけ動かす（下の段は動かない）。
   *   `edge: 'bottom'`（最下段のダクト）は上の余白だけ。いちばん上のダクトは面の上端で決まるので呼ばない
   * - 縦ダクト ←→: 帯ごとずらす（機器はよけ直す）
   */
  nudgeDuct: (target: DuctTarget, dx: number, dy: number, edge?: 'bottom') => void;
  /** DINレールの端を選ぶ（null で解除）。選ぶと案内欄に操作の説明を出す */
  selectRail: (sel: { key: string; end: 'left' | 'right'; row: number } | null) => void;
  /**
   * 選択中のレールの端を外へ delta mm 伸ばす（負なら縮める）。範囲内に丸めたあとの値を渡すこと。
   * 動かせなかったときは note（理由）だけを案内欄に出す
   */
  nudgeRail: (key: string, end: 'left' | 'right', delta: number, note: string | null) => void;
  /** 図の下の案内欄に理由を出す（矢印キーで動かせなかったときなど）。null で消す */
  noteNudge: (note: string | null) => void;
  /** ダクト1本ぶんの調整。上から数えた通し番号で指定する */
  setDuctGap: (ductIndex: number, gap: DuctGap | undefined) => void;

  addDevice: (specId: string, qty: number) => void;
  removeDevice: (specId: string) => void;
  setMount: (specId: string, mount: MountType) => void;
  /** その1台の OP（重ね付け部品）を入れ替える。DIN アタッチメントなら取付方式も切り替わる */
  setItemOpts: (uid: string, opts: string[]) => void;
  /** その面のその型式を何段目に置くか。undefined で自動 */
  setItemRow: (specId: string, row: number | undefined) => void;
  /** その1台を面の外側に付けるか内側に付けるか（キャビネットの面だけ） */
  setItemSide: (uid: string, side: MountSide) => void;
  /** その1台を、付けた面のほかにどの面の図にも出すか */
  setItemShowOn: (uid: string, faces: FaceId[]) => void;
  /** 選択中の機器またはダクトを消す（Delete キー用） */
  removeSelected: () => void;
  /** 消したダクトを戻す。id を省くとその面のぶんを全部戻す */
  restoreDucts: (id?: number) => void;
  select: (uid: string | null) => void;
  selectCut: (id: string | null) => void;
  selectDuct: (id: number | null) => void;
  /** 機器を 90° ずつ回す（図の上でダブルクリック） */
  rotateItem: (uid: string) => void;
  /**
   * 機器の並び順を入れ替える。beforeUid の直前へ移す（null なら末尾）。
   * row を渡すとその機器だけ段を指定する（図の上で上下へ動かしたとき）。
   * 図の上でドラッグしたときに、他の機器の間へ入れ込むために使う。
   *
   * currentRows には「今どの機器がどの段にいるか」を渡す。段をまたいで動かすとき、
   * 段が「自動」のままの機器を今いる段に固定するのに使う。空いた場所へ
   * 下の段の機器が繰り上がってくるのを止めるため。
   */
  moveItem: (
    uid: string,
    beforeUid: string | null,
    row?: number,
    currentRows?: Map<string, number>,
    /** ゾーン分割のときの区画指定（0=左）。渡されたときだけ付け替える */
    zone?: number,
  ) => void;
  /** 座標取付をやめて段割りへ戻す（pinned から外す） */
  unpin: (uid: string) => void;

  addMachining: (m: MachiningDraft) => void;
  updateMachining: (id: string, patch: Partial<Machining>) => void;
  removeMachining: (id: string) => void;

  pin: (placed: PlacedDevice) => void;
  /** 機器の中心座標を指定して置く（中板以外の面で使う） */
  setCenter: (placed: PlacedDevice, size: { w: number; h: number }, cx: number, cy: number) => void;
  resetLayout: () => void;
};

/** マスタ（分類・部品・My部品・盤・ダクト・単価）。 */
export type ConfigSlice = {
  categories: CategoryDef[];
  devices: DeviceSpec[];
  owners: string[];
  myDevices: DeviceSpec[];
  /** 盤マスタ。設定画面で登録し、盤サイズ画面の「型式から選ぶ」に出る */
  enclosures: PanelSpec[];
  /** ダクトマスタ。設定画面で登録し、中板画面のプルダウンに出る */
  ducts: DuctSpec[];
  /** 単価表。型番をキーに持つ。ミスミの一括見積 CSV から取り込む */
  prices: PriceBook;

  addCategory: () => void;
  updateCategory: (id: string, patch: Partial<CategoryDef>) => void;
  removeCategory: (id: string) => void;

  addPart: (source: 'config' | 'my', category: string, owner?: string) => string;
  updatePart: (id: string, patch: Partial<DeviceSpec>) => void;
  removePart: (id: string) => void;

  addOwner: (name: string) => void;
  removeOwner: (name: string) => void;

  /** 盤マスタ。今の盤の寸法をそのまま型式として登録する */
  addEnclosure: (from?: PanelSpec) => void;
  updateEnclosure: (index: number, patch: Partial<PanelSpec>) => void;
  removeEnclosure: (index: number) => void;

  /** ダクトマスタ */
  addDuct: () => void;
  updateDuct: (id: string, patch: Partial<DuctSpec>) => void;
  removeDuct: (id: string) => void;

  /** 取り込んだぶんを重ねる。既にある型番は上書き（新しい見積を正とする） */
  mergePrices: (book: PriceBook) => void;
  clearPrices: () => void;

  loadConfig: (f: ConfigFile) => void;
  loadMyConfig: (f: MyConfigFile) => void;
};

/** 完了案件と作業中案件。机のしまい方と切り替え。 */
export type ProjectSlice = {
  /** 設計完了した案件 */
  projects: Project[];
  /** 作業中の案件（一時保存）。掛け持ちのために机ごとしまっておく */
  drafts: Draft[];
  /** いま机に出している作業中案件。まだ一度もしまっていなければ null */
  currentDraftId: string | null;

  /**
   * 新規作成。盤・機器・加工・下敷きを白紙に戻して盤サイズ画面へ。
   * マスタ（盤・ダクト・部品）と設定、完了案件は残す。
   */
  newDesign: () => void;
  /**
   * いまの設計を作業中案件としてしまう。名前を省くと、いまの名前
   * （初回は盤の型式か「無題の設計」）を使う。
   */
  saveDraft: (name?: string) => void;
  /** 別の作業中案件へ切り替える。いまの机は自動でしまわれる */
  switchDraft: (id: string) => void;
  /** いまの机を作業中案件へしまう（自動保存用。白紙なら何もしない） */
  autoStash: () => void;
  /** いまの机をしまってから、白紙の案件を始める */
  newDraft: () => void;
  renameDraft: (id: string, name: string) => void;
  removeDraft: (id: string) => void;

  /** 設計完了。いまの状態を完了案件として残す */
  completeDesign: (v: { company: string; jobNo: string; owner: string; completedAt: string; note: string }) => void;
  /** 完了案件をいまの設計として読み込む（複製） */
  repeatProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => void;
  loadProjectFile: (f: ProjectFile) => void;
};

/** 設定（profile）。案件ごとに動かすものと決め事の両方。 */
export type SettingsSlice = {
  profile: Profile;
  setDuct: (patch: Partial<DuctSettings>) => void;
  setRail: (patch: Partial<RailSettings>) => void;
  setClearance: (patch: Partial<ClearanceSettings>) => void;
  setBom: (patch: Partial<BomSettings>) => void;
  /** ファン／クーラー選定の入力（案件ごと）を書き換える */
  setCooling: (patch: Partial<CoolingInput>) => void;
  /** ファン／クーラー選定の定数（決め事）を書き換える */
  setCoolingConsts: (patch: Partial<CoolingConsts>) => void;
};

/** AI 自動配置。接続先はブラウザにだけ持つ。 */
export type AiSlice = {
  /** AI 自動配置の接続先。ブラウザにだけ持つ */
  ai: AiSettings;
  /**
   * まだ採否を決めていない AI の案。
   * 画面を移っても消えないよう、部品側ではなくストアに置く
   * （面を見に行って戻ったら採用・不採用が消えている、を防ぐ）。
   */
  aiReview: AiReview | null;
  /** 採否の欄に書きかけの指摘。これも画面を移っても残す */
  aiFeedback: string;

  setAi: (patch: Partial<AiSettings>) => void;
  /**
   * AI の案を当てる。座標は決めさせず、並び順と段だけを書き換えて詰め込みに任せる。
   * face を渡すとその面に当てる（全面まとめて回すとき。画面は切り替えない）。
   * keepUndo を立てると控えを上書きしない＝まとめて1回で戻せる。
   */
  applyAiPlan: (plan: AiPlan, opts?: { face?: FaceId; keepUndo?: boolean }) => void;
  /**
   * AI の案を取り消して、押す前の状態に戻す。
   * 戻せる控えが無ければ false（同じ案を2回取り消せないようにする）。
   */
  undoAiPlan: () => boolean;
  /** 不採用のときに書いてもらった作法を足す。次からの依頼に指示として添える */
  addHouseRule: (text: string) => void;
  setAiReview: (r: AiReview | null) => void;
  setAiFeedback: (t: string) => void;
};

export type State = LayoutSlice & ConfigSlice & ProjectSlice & SettingsSlice & AiSlice;
