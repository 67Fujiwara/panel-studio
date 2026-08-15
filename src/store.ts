import { create } from 'zustand';
import {
  BLANK_PANEL,
  DEFAULT_PROFILE,
  DUCT_LAYOUT_LABEL,
  SAMPLE_DUCTS,
  SAMPLE_ENCLOSURES,
} from './data/enclosures';
import { DEFAULT_AI } from './lib/ai';
import type { AiPlan } from './lib/ai';
import { DEFAULT_CATEGORIES, DEFAULT_DEVICES } from './data/devices';
import { FACE_BY_ID } from './data/faces';
import type {
  AiSettings,
  BomSettings,
  CategoryDef,
  ClearanceSettings,
  DeviceShape,
  DeviceSpec,
  DuctSettings,
  DuctSpec,
  DuctTarget,
  FaceId,
  PriceBook,
  Machining,
  MachiningDraft,
  MountType,
  PanelSpec,
  PlacedDevice,
  DuctGap,
  Profile,
  RailSettings,
  Rotation,
} from './types';
import type { LayoutItem } from './lib/layout';
import { rotatedSize } from './types';

let seq = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

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
};

/** 過去案件のファイル。共有フォルダに置いて全員で見る想定。 */
export type ProjectFile = { schemaVersion: 1; projects: Project[] };

const PROJECT_KEY = 'panel-studio.projects';

/**
 * 過去案件はブラウザにも残す。閉じたら消えるのでは「振り返る」用途を満たせないため。
 * file:// で開くと保存できない環境があるので、失敗しても黙って続ける
 * （JSON 書き出しが本命の受け渡し手段）。
 */
function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    const data = raw ? (JSON.parse(raw) as ProjectFile) : null;
    return data?.schemaVersion === 1 ? data.projects : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ schemaVersion: 1, projects }));
  } catch {
    /* 保存できない環境では JSON 書き出しを使ってもらう */
  }
}

/**
 * AI の接続先はブラウザにだけ置く。
 * 設定 JSON に混ぜると、共有フォルダ経由で API キーが配られてしまう。
 */
const AI_KEY = 'panel-studio.ai';

function loadAi(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_KEY);
    return raw ? { ...DEFAULT_AI, ...(JSON.parse(raw) as AiSettings) } : DEFAULT_AI;
  } catch {
    return DEFAULT_AI;
  }
}

function saveAi(s: AiSettings) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境では毎回入れてもらう */
  }
}

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

type State = {
  screen: Screen;
  face: FaceId;
  panel: PanelSpec;
  profile: Profile;

  categories: CategoryDef[];
  devices: DeviceSpec[];
  owners: string[];
  myDevices: DeviceSpec[];
  /** 盤マスタ。設定画面で登録し、盤サイズ画面の「型式から選ぶ」に出る */
  enclosures: PanelSpec[];
  /** ダクトマスタ。設定画面で登録し、中板画面のプルダウンに出る */
  ducts: DuctSpec[];
  /** 設計完了した案件 */
  projects: Project[];
  /** AI 自動配置の接続先。ブラウザにだけ持つ */
  ai: AiSettings;

  items: LayoutItem[];
  machining: Machining[];
  pinned: PlacedDevice[];
  selectedUid: string | null;
  /** 手動で追加した加工の選択。キャンバス上で強調するのに使う */
  selectedCut: string | null;
  /** 選択中のダクトの通し番号。Delete キーで消すのに使う */
  selectedDuct: number | null;
  /** 面ごとに消したダクトの通し番号。下に余ったダクトを外すのに使う */
  removedDucts: Partial<Record<FaceId, number[]>>;
  /** 面ごとの下敷き。DXF から取り込んだ図をキャンバスの背景に敷く */
  underlays: Partial<Record<FaceId, DeviceShape>>;

  go: (screen: Screen) => void;
  /**
   * 新規作成。盤・機器・加工・下敷きを白紙に戻して盤サイズ画面へ。
   * マスタ（盤・ダクト・部品）と設定、完了案件は残す。
   */
  newDesign: () => void;
  setUnderlay: (face: FaceId, shape: DeviceShape | undefined) => void;
  openFace: (face: FaceId) => void;

  setPanel: (patch: Partial<PanelSpec>) => void;
  setOuter: (patch: Partial<PanelSpec['outer']>) => void;
  setPlate: (patch: Partial<PanelSpec['plate']>) => void;
  setDepth: (patch: Partial<PanelSpec['depth']>) => void;
  setDuct: (patch: Partial<DuctSettings>) => void;
  setRail: (patch: Partial<RailSettings>) => void;
  setClearance: (patch: Partial<ClearanceSettings>) => void;
  setBom: (patch: Partial<BomSettings>) => void;

  addCategory: () => void;
  updateCategory: (id: string, patch: Partial<CategoryDef>) => void;
  removeCategory: (id: string) => void;

  addPart: (source: 'config' | 'my', category: string, owner?: string) => string;
  updatePart: (id: string, patch: Partial<DeviceSpec>) => void;
  removePart: (id: string) => void;

  addOwner: (name: string) => void;
  removeOwner: (name: string) => void;

  /** 設計完了。いまの状態を完了案件として残す */
  completeDesign: (v: {
    company: string;
    jobNo: string;
    owner: string;
    completedAt: string;
    note: string;
  }) => void;
  /** 完了案件をいまの設計として読み込む（複製） */
  repeatProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => void;
  loadProjectFile: (f: ProjectFile) => void;

  setAi: (patch: Partial<AiSettings>) => void;
  /**
   * AI が出した段割りを今の面に反映する。
   * 座標は決めさせず、並び順と段だけを書き換えて詰め込みに任せる。
   */
  /**
   * AI の案を当てる。
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
  /**
   * まだ採否を決めていない AI の案。
   * 画面を移っても消えないよう、部品側ではなくストアに置く
   * （面を見に行って戻ったら採用・不採用が消えている、を防ぐ）。
   */
  aiReview: AiReview | null;
  setAiReview: (r: AiReview | null) => void;
  /** 採否の欄に書きかけの指摘。これも画面を移っても残す */
  aiFeedback: string;
  setAiFeedback: (t: string) => void;

  /** 盤マスタ。今の盤の寸法をそのまま型式として登録する */
  addEnclosure: (from?: PanelSpec) => void;
  updateEnclosure: (index: number, patch: Partial<PanelSpec>) => void;
  removeEnclosure: (index: number) => void;

  /** ダクトマスタ */
  addDuct: () => void;
  updateDuct: (id: string, patch: Partial<DuctSpec>) => void;
  removeDuct: (id: string) => void;
  /** 使うダクトを選ぶ。幅も控えとして書き写す */
  selectDuctSpec: (id: string) => void;
  /**
   * ダクト1本の型式を決める（図の上でダブルクリックして選ぶ）。
   * 横ダクトは上からの通し番号、縦ダクトは `{ vert: 左から何本目 }`、
   * 'all' で盤ぜんたい。id を空にすると指定を外して盤ぜんたいの型式に戻す。
   */
  setDuctSpecAt: (target: DuctTarget, id: string) => void;

  /** 単価表。型番をキーに持つ。ミスミの一括見積 CSV から取り込む */
  prices: PriceBook;
  /** 取り込んだぶんを重ねる。既にある型番は上書き（新しい見積を正とする） */
  mergePrices: (book: PriceBook) => void;
  clearPrices: () => void;

  loadConfig: (f: ConfigFile) => void;
  loadMyConfig: (f: MyConfigFile) => void;

  addDevice: (specId: string, qty: number) => void;
  removeDevice: (specId: string) => void;
  setMount: (specId: string, mount: MountType) => void;
  /** その面のその型式を何段目に置くか。undefined で自動 */
  setItemRow: (specId: string, row: number | undefined) => void;
  /** 選択中の機器またはダクトを消す（Delete キー用） */
  removeSelected: () => void;
  /** 消したダクトを戻す。id を省くとその面のぶんを全部戻す */
  restoreDucts: (id?: number) => void;
  /** ダクト1本ぶんの調整。上から数えた通し番号で指定する */
  setDuctGap: (ductIndex: number, gap: DuctGap | undefined) => void;
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
  ) => void;

  addMachining: (m: MachiningDraft) => void;
  updateMachining: (id: string, patch: Partial<Machining>) => void;
  removeMachining: (id: string) => void;

  pin: (placed: PlacedDevice) => void;
  /** 機器の中心座標を指定して置く（中板以外の面で使う） */
  setCenter: (placed: PlacedDevice, size: { w: number; h: number }, cx: number, cy: number) => void;
  resetLayout: () => void;
};

/**
 * AI の案を押す前の控え。1回ぶんだけ持つ。
 * ストアの状態に入れないのは、バックアップの書き出し対象に混ぜたくないため。
 */
let aiUndo: {
  items: LayoutItem[];
  pinned: PlacedDevice[];
  machining: Machining[];
  profile: Profile;
} | null = null;

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

export const useStore = create<State>((set) => ({
  screen: 'start',
  face: 'plate',
  panel: structuredClone(BLANK_PANEL),
  profile: DEFAULT_PROFILE,

  categories: DEFAULT_CATEGORIES,
  devices: DEFAULT_DEVICES,
  owners: [],
  myDevices: [],
  enclosures: SAMPLE_ENCLOSURES,
  ducts: SAMPLE_DUCTS,
  prices: {},
  projects: loadProjects(),
  ai: loadAi(),

  aiReview: null,
  aiFeedback: '',

  items: [],
  machining: [],
  pinned: [],
  selectedUid: null,
  selectedCut: null,
  selectedDuct: null,
  removedDucts: {},
  underlays: {},

  go: (screen) => set({ screen, selectedUid: null }),

  newDesign: () =>
    set((s) => ({
      // 案件ごとに選ぶもの（ダクトの引き方・段ごとの余白）は初期値へ戻す。
      // 登録した幅や固定穴は「うちはこう作る」の決め事なので残す
      profile: {
        ...s.profile,
        duct: {
          ...s.profile.duct,
          layout: DEFAULT_PROFILE.duct.layout,
          rowHeightMode: DEFAULT_PROFILE.duct.rowHeightMode,
          ductGaps: {},
          vertGaps: {},
        },
      },
      panel: structuredClone(BLANK_PANEL),
      items: [],
      pinned: [],
      machining: [],
      underlays: {},
      removedDucts: {},
      selectedUid: null,
      selectedCut: null,
      selectedDuct: null,
      aiReview: null,
      aiFeedback: '',
      face: 'plate' as FaceId,
      screen: 'start' as Screen,
    })),

  setUnderlay: (face, shape) =>
    set((s) => ({ underlays: { ...s.underlays, [face]: shape } })),
  openFace: (face) => set({ face, screen: 'layout', selectedUid: null, selectedDuct: null }),

  setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),
  setOuter: (patch) => set((s) => ({ panel: { ...s.panel, outer: { ...s.panel.outer, ...patch } } })),
  setPlate: (patch) => set((s) => ({ panel: { ...s.panel, plate: { ...s.panel.plate, ...patch } } })),
  setDepth: (patch) => set((s) => ({ panel: { ...s.panel, depth: { ...s.panel.depth, ...patch } } })),

  setDuct: (patch) =>
    set((s) => ({ profile: { ...s.profile, duct: { ...s.profile.duct, ...patch } } })),
  setRail: (patch) =>
    set((s) => ({ profile: { ...s.profile, rail: { ...s.profile.rail, ...patch } } })),
  setClearance: (patch) =>
    set((s) => ({ profile: { ...s.profile, clearance: { ...s.profile.clearance, ...patch } } })),
  setBom: (patch) => set((s) => ({ profile: { ...s.profile, bom: { ...s.profile.bom, ...patch } } })),

  // --- ConfigFile: カテゴリ ---
  addCategory: () =>
    set((s) => ({
      categories: [
        ...s.categories,
        { id: nextId('cat'), label: '新しい分類', color: '#7d8894' },
      ],
    })),
  updateCategory: (id, patch) =>
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  removeCategory: (id) =>
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
      // 分類を消しても部品は消さず、「その他」相当へ寄せる
      devices: s.devices.map((d) => (d.category === id ? { ...d, category: 'other' } : d)),
      myDevices: s.myDevices.map((d) => (d.category === id ? { ...d, category: 'other' } : d)),
    })),

  // --- 部品 ---
  addPart: (source, category, owner) => {
    const id = nextId('p');
    set((s) => {
      const part: DeviceSpec = {
        id,
        maker: '',
        model: '新規部品',
        name: '',
        category,
        source,
        owner,
        size: { w: 50, h: 50, d: 50 },
        mount: ['direct'],
      };
      return source === 'my'
        ? { myDevices: [...s.myDevices, part] }
        : { devices: [...s.devices, part] };
    });
    return id;
  },
  updatePart: (id, patch) =>
    set((s) => ({
      devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      myDevices: s.myDevices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
  removePart: (id) =>
    set((s) => ({
      devices: s.devices.filter((d) => d.id !== id),
      myDevices: s.myDevices.filter((d) => d.id !== id),
      items: s.items.filter((i) => i.specId !== id),
      pinned: s.pinned.filter((p) => p.specId !== id),
    })),

  // --- MyConfig: 担当者 ---
  addOwner: (name) =>
    set((s) => (s.owners.includes(name) || !name.trim() ? s : { owners: [...s.owners, name] })),
  removeOwner: (name) =>
    set((s) => ({
      owners: s.owners.filter((o) => o !== name),
      myDevices: s.myDevices.filter((d) => d.owner !== name),
    })),

  // --- 過去案件 ---
  completeDesign: (v) =>
    set((s) => {
      const project: Project = {
        id: nextId('prj'),
        company: v.company.trim(),
        jobNo: v.jobNo.trim(),
        owner: v.owner.trim(),
        completedAt: v.completedAt || new Date().toISOString().slice(0, 10),
        note: v.note.trim(),
        // あとで書き換わらないよう、その時点の中身を複製して持つ
        panel: structuredClone(s.panel),
        profile: structuredClone(s.profile),
        items: structuredClone(s.items),
        pinned: structuredClone(s.pinned),
        machining: structuredClone(s.machining),
        removedDucts: structuredClone(s.removedDucts),
        underlays: structuredClone(s.underlays),
      };
      const projects = [project, ...s.projects];
      saveProjects(projects);
      // 完了したら机の上を片付ける。前の案件の盤や機器が残っていると
      // 次の設計に混ざり込むため、盤サイズと面選択を白紙に戻す
      return {
        projects,
        profile: {
          ...s.profile,
          duct: {
            ...s.profile.duct,
            layout: DEFAULT_PROFILE.duct.layout,
            rowHeightMode: DEFAULT_PROFILE.duct.rowHeightMode,
            ductGaps: {},
            vertGaps: {},
          },
        },
        panel: structuredClone(BLANK_PANEL),
        items: [],
        pinned: [],
        machining: [],
        underlays: {},
        removedDucts: {},
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null,
        face: 'plate' as FaceId,
        screen: 'projects' as Screen,
      };
    }),

  repeatProject: (id) =>
    set((s) => {
      const p = s.projects.find((q) => q.id === id);
      if (!p) return s;
      return {
        panel: structuredClone(p.panel),
        profile: structuredClone(p.profile),
        items: structuredClone(p.items),
        pinned: structuredClone(p.pinned),
        machining: structuredClone(p.machining),
        removedDucts: structuredClone(p.removedDucts),
        underlays: structuredClone(p.underlays),
        selectedUid: null,
        selectedCut: null,
        selectedDuct: null,
        screen: 'faces' as Screen,
      };
    }),

  updateProject: (id, patch) =>
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
      saveProjects(projects);
      return { projects };
    }),

  removeProject: (id) =>
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      saveProjects(projects);
      return { projects };
    }),

  loadProjectFile: (f) =>
    set((s) => {
      // 同じ案件を二重に持たないよう、id が重なるものは読み込んだほうで置き換える
      const ids = new Set(f.projects.map((p) => p.id));
      const projects = [...f.projects, ...s.projects.filter((p) => !ids.has(p.id))];
      saveProjects(projects);
      return { projects };
    }),

  // --- AI 自動配置 ---
  setAi: (patch) =>
    set((s) => {
      const ai = { ...s.ai, ...patch };
      saveAi(ai);
      return { ai };
    }),

  applyAiPlan: (plan, opts) =>
    set((s) => {
      const face = opts?.face ?? s.face;
      // 不採用のときに戻せるよう、押す前をまるごと控えておく。
      // 「AI に任せてみる」の心理的な敷居は、取り消せるかどうかで決まる。
      // 全面まとめて回すときは最初の1回だけ控え、まとめて戻せるようにする
      if (!(opts?.keepUndo && aiUndo)) {
        aiUndo = {
          items: s.items,
          pinned: s.pinned,
          machining: s.machining,
          profile: s.profile,
        };
      }
      const rot = plan.rotate ?? {};
      const mine = s.items.filter((i) => i.face === face);
      const others = s.items.filter((i) => i.face !== face);
      const lookup = deviceLookup(s.devices, s.myDevices);

      // 足す加工。中板以外ではタップを受け取らない（板の裏にナットを当てられないため）
      const cuts: Machining[] = (plan.cuts ?? []).map((c) =>
        c.kind === 'notch'
          ? { ...c, id: nextId('m'), face }
          : { ...c, tap: face === 'plate' ? c.tap : undefined, id: nextId('m'), face },
      );
      const machining = [...s.machining, ...cuts];

      if (Array.isArray(plan.places)) {
        // ダクトも段も無い面。AI が出した中心座標をそのまま置き、
        // 図の上では pinned として扱う（詰め込みに動かされないようにする）
        const rotOf = (i: (typeof mine)[number]) => rot[i.uid] ?? i.rot;
        const pinned = s.pinned.filter((p) => p.face !== face);
        for (const at of plan.places) {
          const item = mine.find((i) => i.uid === at.uid);
          const spec = item ? lookup.get(item.specId) : undefined;
          if (!item || !spec) continue;
          const size = rotatedSize(spec.size, rotOf(item));
          // 中心で来るので左下に直す。段の無い面なので row は -1
          pinned.push({
            uid: at.uid,
            specId: item.specId,
            face,
            mount: item.mount,
            rot: rotOf(item),
            x: at.x - size.w / 2,
            y: at.y - size.h / 2,
            row: -1,
            pinned: true,
          });
        }
        return {
          items: [...others, ...mine.map((i) => ({ ...i, rot: rot[i.uid] ?? i.rot }))],
          pinned,
          machining,
          selectedUid: null,
        };
      }

      // 中板。段割りだけ受け取り、座標は既存の詰め込みに出させる
      const order = new Map<string, { row: number; at: number }>();
      (plan.rows ?? []).forEach((r, ri) =>
        r.uids.forEach((uid, ui) => order.set(uid, { row: r.index >= 0 ? r.index : ri, at: ui })),
      );

      const updated = mine.map((i) => {
        const at = order.get(i.uid);
        return at ? { ...i, row: at.row, rot: rot[i.uid] ?? i.rot } : i;
      });
      // 段 → 段の中の位置、の順に並べ替える。詰め込みはこの順に流し込む
      updated.sort((a, b) => {
        const pa = order.get(a.uid);
        const pb = order.get(b.uid);
        if (!pa || !pb) return 0;
        return pa.row - pb.row || pa.at - pb.at;
      });

      // ダクトの引き方も案の一部。指定が来たときだけ差し替える
      const d = plan.duct;
      const duct = d
        ? {
            ...s.profile.duct,
            ...(d.layout && DUCT_LAYOUT_LABEL[d.layout] ? { layout: d.layout } : {}),
            ...(d.rowCount && d.rowCount > 0 ? { rowCount: d.rowCount } : {}),
          }
        : s.profile.duct;

      return {
        items: [...others, ...updated],
        profile: { ...s.profile, duct },
        machining,
        // 段割りが変わるので、手で固定していた座標は捨てる
        pinned: s.pinned.filter((p) => p.face !== face),
        selectedUid: null,
      };
    }),

  setAiReview: (r) => set({ aiReview: r }),
  setAiFeedback: (t) => set({ aiFeedback: t }),

  undoAiPlan: () => {
    if (!aiUndo) return false;
    const back = aiUndo;
    aiUndo = null;
    useStore.setState({ ...back, selectedUid: null });
    return true;
  },

  addHouseRule: (text) =>
    set((s) => {
      const t = text.trim();
      if (!t) return s;
      const rules = [...(s.ai.houseRules ?? []), t];
      const ai = { ...s.ai, houseRules: rules };
      saveAi(ai);
      return { ai };
    }),

  // --- 盤マスタ ---
  addEnclosure: (from) =>
    set((s) => {
      const base = from ?? s.panel;
      // 同じ型式名が並ぶと選べないので、重なったら連番を足す
      let model = base.model || '新しい盤';
      for (let n = 2; s.enclosures.some((e) => e.model === model); n++) {
        model = `${base.model || '新しい盤'} (${n})`;
      }
      return { enclosures: [...s.enclosures, { ...base, model }] };
    }),
  updateEnclosure: (index, patch) =>
    set((s) => ({
      enclosures: s.enclosures.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    })),
  removeEnclosure: (index) =>
    set((s) => ({ enclosures: s.enclosures.filter((_, i) => i !== index) })),

  // --- ダクトマスタ ---
  addDuct: () =>
    set((s) => ({
      ducts: [
        ...s.ducts,
        { id: nextId('dt'), maker: '', model: '新しいダクト', width: 50, height: 50, stock: 2000 },
      ],
    })),
  updateDuct: (id, patch) =>
    set((s) => {
      const ducts = s.ducts.map((d) => (d.id === id ? { ...d, ...patch } : d));
      // 使用中のダクトの幅を変えたら、控えの幅も追従させる（全体と1本ごとの両方）
      const cur = ducts.find((d) => d.id === s.profile.duct.ductId);
      const follow = (src: Record<number, DuctGap> | undefined) => {
        const out = { ...src };
        for (const [k, g] of Object.entries(out)) {
          const d = ducts.find((q) => q.id === g.ductId);
          if (d) out[Number(k)] = { ...g, width: d.width };
        }
        return out;
      };
      return {
        ducts,
        profile: {
          ...s.profile,
          duct: {
            ...s.profile.duct,
            width: cur?.width ?? s.profile.duct.width,
            ductGaps: follow(s.profile.duct.ductGaps),
            vertGaps: follow(s.profile.duct.vertGaps),
          },
        },
      };
    }),
  removeDuct: (id) => set((s) => ({ ducts: s.ducts.filter((d) => d.id !== id) })),

  selectDuctSpec: (id) =>
    set((s) => {
      const d = s.ducts.find((q) => q.id === id);
      return {
        profile: {
          ...s.profile,
          duct: { ...s.profile.duct, ductId: id, width: d?.width ?? s.profile.duct.width },
        },
      };
    }),

  setDuctSpecAt: (target, id) =>
    set((s) => {
      const duct = s.profile.duct;
      const next = s.ducts.find((d) => d.id === id);

      if (target === 'all') {
        if (!next) return s;
        return {
          profile: { ...s.profile, duct: { ...duct, ductId: next.id, width: next.width } },
        };
      }

      // 横ダクトは上からの通し番号、縦ダクトは左から何本目かで、別の帳簿に書く
      const vertical = typeof target !== 'number';
      const key = vertical ? target.vert : target;
      const gaps = { ...(vertical ? duct.vertGaps : duct.ductGaps) };
      const cur = gaps[key];
      if (!next) {
        // 「盤ぜんたいと同じ」に戻す。位置の調整は残す
        if (cur) {
          const { ductId: _id, width: _w, ...rest } = cur;
          gaps[key] = rest;
        }
      } else {
        // 幅は配置計算で使うので控えを書き写しておく（計算側はマスタを持たない）
        gaps[key] = { ...cur, ductId: next.id, width: next.width };
      }
      return {
        profile: {
          ...s.profile,
          duct: vertical ? { ...duct, vertGaps: gaps } : { ...duct, ductGaps: gaps },
        },
      };
    }),

  mergePrices: (book) => set((s) => ({ prices: { ...s.prices, ...book } })),
  clearPrices: () => set({ prices: {} }),

  loadConfig: (f) =>
    set((s) => ({
      categories: f.categories,
      devices: f.devices,
      profile: f.profile,
      enclosures: f.enclosures ?? s.enclosures,
      ducts: f.ducts ?? s.ducts,
      prices: f.prices ?? s.prices,
    })),
  loadMyConfig: (f) => set({ owners: f.owners, myDevices: f.devices }),

  // --- レイアウト ---
  addDevice: (specId, qty) =>
    set((s) => {
      const spec = [...s.devices, ...s.myDevices].find((d) => d.id === specId);
      const allowed = FACE_BY_ID.get(s.face)?.mounts ?? [];
      if (!spec) return s;
      const mount = spec.mount.find((m) => allowed.includes(m));
      if (!mount) return s;
      const added: LayoutItem[] = Array.from({ length: qty }, () => ({
        uid: nextId('d'),
        specId,
        face: s.face,
        mount,
      }));
      // いま足した1台を選んだ状態にする。座標表の青い行がそこへ移り、
      // 続けて座標を打ち込める（足した機器を目で探して選び直す手間をなくす）
      return { items: [...s.items, ...added], selectedUid: added.at(-1)?.uid ?? s.selectedUid };
    }),

  removeDevice: (specId) =>
    set((s) => {
      const idx = s.items.reduce(
        (found, it, i) => (it.specId === specId && it.face === s.face ? i : found),
        -1,
      );
      if (idx < 0) return s;
      const removed = s.items[idx]!;
      return {
        items: s.items.filter((_, i) => i !== idx),
        pinned: s.pinned.filter((p) => p.uid !== removed.uid),
      };
    }),

  setMount: (specId, mount) =>
    set((s) => ({
      items: s.items.map((i) => (i.specId === specId && i.face === s.face ? { ...i, mount } : i)),
      pinned: s.pinned.filter((p) => !(p.specId === specId && p.face === s.face)),
    })),

  setItemRow: (specId, row) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.specId === specId && i.face === s.face ? { ...i, row } : i,
      ),
      pinned: s.pinned.filter((p) => !(p.specId === specId && p.face === s.face)),
    })),

  removeSelected: () =>
    set((s) => {
      if (s.selectedDuct !== null) {
        const cur = s.removedDucts[s.face] ?? [];
        return {
          removedDucts: { ...s.removedDucts, [s.face]: [...cur, s.selectedDuct] },
          selectedDuct: null,
        };
      }
      if (!s.selectedUid) return s;
      return {
        items: s.items.filter((i) => i.uid !== s.selectedUid),
        pinned: s.pinned.filter((p) => p.uid !== s.selectedUid),
        selectedUid: null,
      };
    }),

  restoreDucts: (id) =>
    set((s) => ({
      removedDucts: {
        ...s.removedDucts,
        [s.face]: id === undefined ? [] : (s.removedDucts[s.face] ?? []).filter((d) => d !== id),
      },
      selectedDuct: null,
    })),

  setDuctGap: (ductIndex, gap) =>
    set((s) => {
      const next = { ...s.profile.duct.ductGaps };
      if (gap) next[ductIndex] = gap;
      else delete next[ductIndex];
      return { profile: { ...s.profile, duct: { ...s.profile.duct, ductGaps: next } } };
    }),

  select: (uid) => set({ selectedUid: uid, selectedCut: null, selectedDuct: null }),
  selectCut: (id) => set({ selectedCut: id, selectedUid: null, selectedDuct: null }),
  selectDuct: (id) => set({ selectedDuct: id, selectedUid: null, selectedCut: null }),

  rotateItem: (uid) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.uid === uid ? { ...i, rot: (((i.rot ?? 0) + 90) % 360) as Rotation } : i,
      ),
      // 回すと外形が変わるので、手で固定していた座標は捨てて置き直す
      pinned: s.pinned.filter((p) => p.uid !== uid),
    })),

  moveItem: (uid, beforeUid, row, currentRows) =>
    set((s) => {
      const from = s.items.findIndex((i) => i.uid === uid);
      if (from < 0) return s;
      const moved = s.items[from]!;

      // 段をまたぐときは、他の機器を今いる段に固定してから動かす。
      // そうしないと空いた場所へ下の段の機器が繰り上がってきて、
      // 1台動かしただけのつもりが盤全体の並びが変わってしまう。
      const freeze = (i: LayoutItem): LayoutItem => {
        if (row === undefined || !currentRows) return i;
        if (i.uid === uid || i.face !== moved.face || i.row !== undefined) return i;
        const at = currentRows.get(i.uid);
        return at === undefined ? i : { ...i, row: at };
      };

      const rest = s.items.filter((i) => i.uid !== uid).map(freeze);
      // 上下に動かしたときだけ段を指定し直す。左右に動かしただけなら「自動」のまま残す
      const item = row === undefined ? moved : { ...moved, row };
      const to = beforeUid ? rest.findIndex((i) => i.uid === beforeUid) : -1;
      const next = [...rest];
      next.splice(to < 0 ? next.length : to, 0, item);
      // 並べ替えたら手動で固定していた座標は捨てる（自動配置に戻す）
      return { items: next, pinned: s.pinned.filter((p) => p.uid !== uid) };
    }),

  addMachining: (m) =>
    set((s) => ({ machining: [...s.machining, { ...m, id: nextId('m'), face: s.face }] })),
  updateMachining: (id, patch) =>
    set((s) => ({
      machining: s.machining.map((m) => (m.id === id ? ({ ...m, ...patch } as Machining) : m)),
    })),
  removeMachining: (id) => set((s) => ({ machining: s.machining.filter((m) => m.id !== id) })),

  pin: (placed) =>
    set((s) => ({
      pinned: [...s.pinned.filter((p) => p.uid !== placed.uid), { ...placed, pinned: true }],
    })),

  setCenter: (placed, size, cx, cy) =>
    set((s) => ({
      pinned: [
        ...s.pinned.filter((p) => p.uid !== placed.uid),
        { ...placed, x: cx - size.w / 2, y: cy - size.h / 2, pinned: true },
      ],
    })),

  resetLayout: () => set((s) => ({ pinned: s.pinned.filter((p) => p.face !== s.face) })),
}));

/** 共通の部品表と My部品をまとめた検索用 Map。 */
export function deviceLookup(devices: DeviceSpec[], myDevices: DeviceSpec[]) {
  return new Map([...devices, ...myDevices].map((d) => [d.id, d]));
}
