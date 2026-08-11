import { create } from 'zustand';
import { DEFAULT_PROFILE, SAMPLE_ENCLOSURES } from './data/enclosures';
import { DEFAULT_CATEGORIES, DEFAULT_DEVICES } from './data/devices';
import { FACE_BY_ID } from './data/faces';
import type {
  BomSettings,
  CategoryDef,
  ClearanceSettings,
  DeviceShape,
  DeviceSpec,
  DuctSettings,
  FaceId,
  Machining,
  MachiningDraft,
  MountType,
  PanelSpec,
  PlacedDevice,
  Profile,
} from './types';
import type { LayoutItem } from './lib/layout';

let seq = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

export type Screen = 'start' | 'faces' | 'layout' | 'config' | 'myconfig';

/** ConfigFile 画面が読み書きするファイルの中身。 */
export type ConfigFile = {
  schemaVersion: 1;
  categories: CategoryDef[];
  devices: DeviceSpec[];
  profile: Profile;
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

  items: LayoutItem[];
  machining: Machining[];
  pinned: PlacedDevice[];
  selectedUid: string | null;
  /** 手動で追加した加工の選択。キャンバス上で強調するのに使う */
  selectedCut: string | null;
  /** 面ごとの下敷き。DXF から取り込んだ図をキャンバスの背景に敷く */
  underlays: Partial<Record<FaceId, DeviceShape>>;

  go: (screen: Screen) => void;
  setUnderlay: (face: FaceId, shape: DeviceShape | undefined) => void;
  openFace: (face: FaceId) => void;

  setPanel: (patch: Partial<PanelSpec>) => void;
  setOuter: (patch: Partial<PanelSpec['outer']>) => void;
  setPlate: (patch: Partial<PanelSpec['plate']>) => void;
  setDepth: (patch: Partial<PanelSpec['depth']>) => void;
  setDuct: (patch: Partial<DuctSettings>) => void;
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

  loadConfig: (f: ConfigFile) => void;
  loadMyConfig: (f: MyConfigFile) => void;

  addDevice: (specId: string, qty: number) => void;
  removeDevice: (specId: string) => void;
  setMount: (specId: string, mount: MountType) => void;
  /** その面のその型式を何段目に置くか。undefined で自動 */
  setItemRow: (specId: string, row: number | undefined) => void;
  /** 選択中の機器を1台消す（Delete キー用） */
  removeSelected: () => void;
  setRowGap: (row: number, gap: { top: number; bottom: number } | undefined) => void;
  select: (uid: string | null) => void;
  selectCut: (id: string | null) => void;
  /**
   * 機器の並び順を入れ替える。beforeUid の直前へ移す（null なら末尾）。
   * 図の上でドラッグしたときに、他の機器の間へ入れ込むために使う。
   */
  moveItem: (uid: string, beforeUid: string | null) => void;

  addMachining: (m: MachiningDraft) => void;
  updateMachining: (id: string, patch: Partial<Machining>) => void;
  removeMachining: (id: string) => void;

  pin: (placed: PlacedDevice) => void;
  /** 機器の中心座標を指定して置く（中板以外の面で使う） */
  setCenter: (placed: PlacedDevice, size: { w: number; h: number }, cx: number, cy: number) => void;
  resetLayout: () => void;
};

export const useStore = create<State>((set) => ({
  screen: 'start',
  face: 'plate',
  panel: SAMPLE_ENCLOSURES[1]!,
  profile: DEFAULT_PROFILE,

  categories: DEFAULT_CATEGORIES,
  devices: DEFAULT_DEVICES,
  owners: [],
  myDevices: [],

  items: [],
  machining: [],
  pinned: [],
  selectedUid: null,
  selectedCut: null,
  underlays: {},

  go: (screen) => set({ screen, selectedUid: null }),
  setUnderlay: (face, shape) =>
    set((s) => ({ underlays: { ...s.underlays, [face]: shape } })),
  openFace: (face) => set({ face, screen: 'layout', selectedUid: null }),

  setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),
  setOuter: (patch) => set((s) => ({ panel: { ...s.panel, outer: { ...s.panel.outer, ...patch } } })),
  setPlate: (patch) => set((s) => ({ panel: { ...s.panel, plate: { ...s.panel.plate, ...patch } } })),
  setDepth: (patch) => set((s) => ({ panel: { ...s.panel, depth: { ...s.panel.depth, ...patch } } })),

  setDuct: (patch) =>
    set((s) => ({ profile: { ...s.profile, duct: { ...s.profile.duct, ...patch } } })),
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

  loadConfig: (f) =>
    set({ categories: f.categories, devices: f.devices, profile: f.profile }),
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
      return { items: [...s.items, ...added] };
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
      if (!s.selectedUid) return s;
      return {
        items: s.items.filter((i) => i.uid !== s.selectedUid),
        pinned: s.pinned.filter((p) => p.uid !== s.selectedUid),
        selectedUid: null,
      };
    }),

  setRowGap: (row, gap) =>
    set((s) => {
      const next = { ...s.profile.duct.rowGaps };
      if (gap) next[row] = gap;
      else delete next[row];
      return { profile: { ...s.profile, duct: { ...s.profile.duct, rowGaps: next } } };
    }),

  select: (uid) => set({ selectedUid: uid, selectedCut: null }),
  selectCut: (id) => set({ selectedCut: id, selectedUid: null }),

  moveItem: (uid, beforeUid) =>
    set((s) => {
      const from = s.items.findIndex((i) => i.uid === uid);
      if (from < 0) return s;
      const rest = s.items.filter((i) => i.uid !== uid);
      const item = s.items[from]!;
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
