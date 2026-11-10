/** 設定（profile）。ダクト・レール・クリアランス・BOM・冷却の書き換え。 */
import type { StateCreator } from 'zustand';
import { DEFAULT_PROFILE } from '../data/enclosures';
import type { SettingsSlice, State } from './types';


export const createSettingsSlice: StateCreator<State, [], [], SettingsSlice> = (set) => ({

  profile: DEFAULT_PROFILE,

  setDuct: (patch) =>
    set((s) => ({ profile: { ...s.profile, duct: { ...s.profile.duct, ...patch } } })),

  setRail: (patch) =>
    set((s) => ({ profile: { ...s.profile, rail: { ...s.profile.rail, ...patch } } })),

  setClearance: (patch) =>
    set((s) => ({ profile: { ...s.profile, clearance: { ...s.profile.clearance, ...patch } } })),

  setBom: (patch) => set((s) => ({ profile: { ...s.profile, bom: { ...s.profile.bom, ...patch } } })),

  setCooling: (patch) =>
    set((s) => ({
      profile: { ...s.profile, cooling: { ...s.profile.cooling, input: { ...s.profile.cooling?.input, ...patch } } },
    })),

  setCoolingConsts: (patch) =>
    set((s) => ({
      profile: { ...s.profile, cooling: { ...s.profile.cooling, consts: { ...s.profile.cooling?.consts, ...patch } } },
    })),

});
