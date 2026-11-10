/** マスタ（分類・部品・My部品・盤・ダクト・単価）。 */
import type { StateCreator } from 'zustand';
import { SAMPLE_DUCTS, SAMPLE_ENCLOSURES } from '../data/enclosures';
import { DEFAULT_CATEGORIES, DEFAULT_DEVICES } from '../data/devices';
import type { DeviceSpec, DuctGap } from '../types';
import { nextId } from './shared';
import type { ConfigSlice, State } from './types';


export const createConfigSlice: StateCreator<State, [], [], ConfigSlice> = (set) => ({

  categories: DEFAULT_CATEGORIES,

  devices: DEFAULT_DEVICES,

  owners: [],

  myDevices: [],

  enclosures: SAMPLE_ENCLOSURES,

  ducts: SAMPLE_DUCTS,

  prices: {},

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

  addOwner: (name) =>
    set((s) => (s.owners.includes(name) || !name.trim() ? s : { owners: [...s.owners, name] })),

  removeOwner: (name) =>
    set((s) => ({
      owners: s.owners.filter((o) => o !== name),
      myDevices: s.myDevices.filter((d) => d.owner !== name),
    })),

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

});
