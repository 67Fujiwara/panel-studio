import { create } from 'zustand';
import { DEFAULT_PROFILE, SAMPLE_ENCLOSURES } from './data/enclosures';
import { DEVICE_BY_ID } from './data/devices';
import type {
  ClearanceSettings,
  DrawingSettings,
  DuctSettings,
  PanelSpec,
  PlacedDevice,
  Profile,
} from './types';
import type { LayoutItem } from './lib/layout';

let seq = 0;
const nextUid = () => `d${++seq}`;

type State = {
  panel: PanelSpec;
  profile: Profile;
  items: LayoutItem[];
  /** 人が手で動かした機器。再配置しても座標を保持する */
  pinned: PlacedDevice[];
  selectedUid: string | null;

  setPanel: (patch: Partial<PanelSpec>) => void;
  setPlate: (patch: Partial<PanelSpec['plate']>) => void;
  setDepth: (patch: Partial<PanelSpec['depth']>) => void;
  setDuct: (patch: Partial<DuctSettings>) => void;
  setClearance: (patch: Partial<ClearanceSettings>) => void;
  setLayer: (key: keyof DrawingSettings['layers'], name: string) => void;
  setTextHeight: (v: number) => void;

  addDevice: (specId: string, qty: number) => void;
  removeDevice: (specId: string) => void;
  setMount: (specId: string, mount: PlacedDevice['mount']) => void;
  select: (uid: string | null) => void;

  pin: (placed: PlacedDevice) => void;
  /** 手動調整をすべて捨てて自動配置に戻す */
  resetLayout: () => void;

  loadProfile: (profile: Profile) => void;
};

export const useStore = create<State>((set) => ({
  panel: SAMPLE_ENCLOSURES[1]!,
  profile: DEFAULT_PROFILE,
  items: [],
  pinned: [],
  selectedUid: null,

  setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),
  setPlate: (patch) => set((s) => ({ panel: { ...s.panel, plate: { ...s.panel.plate, ...patch } } })),
  setDepth: (patch) => set((s) => ({ panel: { ...s.panel, depth: { ...s.panel.depth, ...patch } } })),

  setDuct: (patch) =>
    set((s) => ({ profile: { ...s.profile, duct: { ...s.profile.duct, ...patch } } })),
  setClearance: (patch) =>
    set((s) => ({ profile: { ...s.profile, clearance: { ...s.profile.clearance, ...patch } } })),

  setLayer: (key, name) =>
    set((s) => ({
      profile: {
        ...s.profile,
        drawing: { ...s.profile.drawing, layers: { ...s.profile.drawing.layers, [key]: name } },
      },
    })),

  setTextHeight: (textHeight) =>
    set((s) => ({ profile: { ...s.profile, drawing: { ...s.profile.drawing, textHeight } } })),

  addDevice: (specId, qty) =>
    set((s) => {
      const spec = DEVICE_BY_ID.get(specId);
      if (!spec) return s;
      const mount = spec.mount[0]!;
      const added: LayoutItem[] = Array.from({ length: qty }, () => ({
        uid: nextUid(),
        specId,
        mount,
      }));
      return { items: [...s.items, ...added] };
    }),

  removeDevice: (specId) =>
    set((s) => {
      const idx = s.items.map((i) => i.specId).lastIndexOf(specId);
      if (idx < 0) return s;
      const removed = s.items[idx]!;
      return {
        items: s.items.filter((_, i) => i !== idx),
        pinned: s.pinned.filter((p) => p.uid !== removed.uid),
      };
    }),

  setMount: (specId, mount) =>
    set((s) => ({
      items: s.items.map((i) => (i.specId === specId ? { ...i, mount } : i)),
      // 取付方式が変わると奥行きが変わるので、その機器の手動配置は解除する
      pinned: s.pinned.filter((p) => p.specId !== specId),
    })),

  select: (uid) => set({ selectedUid: uid }),

  pin: (placed) =>
    set((s) => ({
      pinned: [...s.pinned.filter((p) => p.uid !== placed.uid), { ...placed, pinned: true }],
    })),

  resetLayout: () => set({ pinned: [] }),

  loadProfile: (profile) => set({ profile, pinned: [] }),
}));
