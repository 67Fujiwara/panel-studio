import { create } from 'zustand';
import { DEFAULT_PROFILE, SAMPLE_ENCLOSURES } from './data/enclosures';
import { DEVICE_BY_ID } from './data/devices';
import { FACE_BY_ID } from './data/faces';
import type {
  BomSettings,
  ClearanceSettings,
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
const nextId = (p: string) => `${p}${++seq}`;

type Screen = 'faces' | 'layout';

type State = {
  screen: Screen;
  face: FaceId;
  panel: PanelSpec;
  profile: Profile;
  items: LayoutItem[];
  machining: Machining[];
  /** 人が手で動かした機器。再配置しても座標を保持する */
  pinned: PlacedDevice[];
  selectedUid: string | null;

  openFace: (face: FaceId) => void;
  backToFaces: () => void;

  setPanel: (patch: Partial<PanelSpec>) => void;
  setOuter: (patch: Partial<PanelSpec['outer']>) => void;
  setPlate: (patch: Partial<PanelSpec['plate']>) => void;
  setDepth: (patch: Partial<PanelSpec['depth']>) => void;
  setDuct: (patch: Partial<DuctSettings>) => void;
  setClearance: (patch: Partial<ClearanceSettings>) => void;
  setBom: (patch: Partial<BomSettings>) => void;

  addDevice: (specId: string, qty: number) => void;
  removeDevice: (specId: string) => void;
  setMount: (specId: string, mount: MountType) => void;
  countOnFace: (specId: string, face: FaceId) => number;
  select: (uid: string | null) => void;

  addMachining: (m: MachiningDraft) => void;
  updateMachining: (id: string, patch: Partial<Machining>) => void;
  removeMachining: (id: string) => void;

  pin: (placed: PlacedDevice) => void;
  /** 手動調整をすべて捨てて自動配置に戻す（現在の面のみ） */
  resetLayout: () => void;

  loadProfile: (profile: Profile) => void;
};

export const useStore = create<State>((set, get) => ({
  screen: 'faces',
  face: 'plate',
  panel: SAMPLE_ENCLOSURES[1]!,
  profile: DEFAULT_PROFILE,
  items: [],
  machining: [],
  pinned: [],
  selectedUid: null,

  openFace: (face) => set({ face, screen: 'layout', selectedUid: null }),
  backToFaces: () => set({ screen: 'faces', selectedUid: null }),

  setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),
  setOuter: (patch) => set((s) => ({ panel: { ...s.panel, outer: { ...s.panel.outer, ...patch } } })),
  setPlate: (patch) => set((s) => ({ panel: { ...s.panel, plate: { ...s.panel.plate, ...patch } } })),
  setDepth: (patch) => set((s) => ({ panel: { ...s.panel, depth: { ...s.panel.depth, ...patch } } })),

  setDuct: (patch) =>
    set((s) => ({ profile: { ...s.profile, duct: { ...s.profile.duct, ...patch } } })),
  setClearance: (patch) =>
    set((s) => ({ profile: { ...s.profile, clearance: { ...s.profile.clearance, ...patch } } })),
  setBom: (patch) => set((s) => ({ profile: { ...s.profile, bom: { ...s.profile.bom, ...patch } } })),

  addDevice: (specId, qty) =>
    set((s) => {
      const spec = DEVICE_BY_ID.get(specId);
      const allowed = FACE_BY_ID.get(s.face)?.mounts ?? [];
      if (!spec) return s;
      // その面で使える取付方式のうち、機器が対応しているものを既定にする
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
      // 取付方式が変わると奥行きが変わるので、その機器の手動配置は解除する
      pinned: s.pinned.filter((p) => !(p.specId === specId && p.face === s.face)),
    })),

  countOnFace: (specId, face) =>
    get().items.filter((i) => i.specId === specId && i.face === face).length,

  select: (uid) => set({ selectedUid: uid }),

  addMachining: (m) =>
    set((s) => ({
      machining: [...s.machining, { ...m, id: nextId('m'), face: s.face } as Machining],
    })),

  updateMachining: (id, patch) =>
    set((s) => ({
      machining: s.machining.map((m) => (m.id === id ? ({ ...m, ...patch } as Machining) : m)),
    })),

  removeMachining: (id) => set((s) => ({ machining: s.machining.filter((m) => m.id !== id) })),

  pin: (placed) =>
    set((s) => ({
      pinned: [...s.pinned.filter((p) => p.uid !== placed.uid), { ...placed, pinned: true }],
    })),

  resetLayout: () => set((s) => ({ pinned: s.pinned.filter((p) => p.face !== s.face) })),

  loadProfile: (profile) => set({ profile, pinned: [] }),
}));
