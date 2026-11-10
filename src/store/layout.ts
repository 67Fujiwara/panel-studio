/** いま机に出している設計（盤・機器・加工・選択）と、図の上の操作。 */
import type { StateCreator } from 'zustand';
import { FACE_BY_ID } from '../data/faces';
import { autoLayout, planDuctNudge, planVertNudge } from '../lib/layout';
import type { LayoutItem } from '../lib/layout';
import { hasTapCuts } from '../types';
import type { Machining, MountType, Rotation } from '../types';
import { deviceLookup, nextId } from './shared';
import type { LayoutSlice, State } from './types';
import { BLANK_PANEL } from '../data/enclosures';


export const createLayoutSlice: StateCreator<State, [], [], LayoutSlice> = (set) => ({

  screen: 'start',

  face: 'plate',

  panel: structuredClone(BLANK_PANEL),

  items: [],

  machining: [],

  pinned: [],

  selectedUid: null,

  selectedCut: null,

  selectedDuct: null, selectedRail: null,

  nudgeNote: null,

  removedDucts: {},

  underlays: {},

  sizeLocked: false,

  go: (screen) => set({ screen, selectedUid: null, nudgeNote: null }),

  confirmSize: () => set({ sizeLocked: true, screen: 'faces', selectedUid: null }),

  setUnderlay: (face, shape) =>
    set((s) => ({ underlays: { ...s.underlays, [face]: shape } })),

  openFace: (face) => set({ face, screen: 'layout', selectedUid: null, selectedDuct: null, selectedRail: null }),

  setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),

  setOuter: (patch) => set((s) => ({ panel: { ...s.panel, outer: { ...s.panel.outer, ...patch } } })),

  setPlate: (patch) => set((s) => ({ panel: { ...s.panel, plate: { ...s.panel.plate, ...patch } } })),

  setDepth: (patch) => set((s) => ({ panel: { ...s.panel, depth: { ...s.panel.depth, ...patch } } })),

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

  nudgeDuct: (target, dx, dy, edge) =>
    set((s) => {
      // どこまで動かせるかは lib/layout/nudge.ts が決める。ここは答えを書くだけ
      const duct = s.profile.duct;
      if (typeof target !== 'number') {
        if (target === 'all') return s;
        const step = planVertNudge(s.panel, s.face, s.profile, target.vert, dx);
        if (!step) return s;
        const gaps = { ...duct.vertGaps };
        const cur = gaps[target.vert] ?? {};
        gaps[target.vert] = { ...cur, dx: (cur.dx ?? 0) + step };
        return { profile: { ...s.profile, duct: { ...duct, vertGaps: gaps } }, nudgeNote: null };
      }
      const lookup = deviceLookup(s.devices, s.myDevices);
      // 上下の判定だけ配置が要る（その段の機器の離隔を見る）
      const lay = dy
        ? autoLayout(s.panel, s.profile, s.face, s.items, s.pinned, lookup, s.removedDucts[s.face] ?? [])
        : { rows: [], ducts: [], placed: [], violations: [] };
      const plan = planDuctNudge(s.profile, lay, lookup, target, dx, dy, edge);
      if (!plan.patch) return plan.note ? { nudgeNote: plan.note } : s;
      const gaps = { ...duct.ductGaps };
      gaps[target] = { ...(gaps[target] ?? {}), ...plan.patch };
      return { profile: { ...s.profile, duct: { ...duct, ductGaps: gaps } }, nudgeNote: null };
    }),

  selectRail: (sel) =>
    set({
      selectedRail: sel ? { key: sel.key, end: sel.end } : null,
      selectedUid: null,
      selectedCut: null,
      selectedDuct: null,
      nudgeNote: sel
        ? `DINレール ${sel.row + 1} 段目の${sel.end === 'left' ? '左端' : '右端'}を選びました。← → で 1mm（Shift で 10mm）伸び縮みします。反対の端はレールのそちら側の半分を押して選びます`
        : null,
    }),

  noteNudge: (note) => set({ nudgeNote: note }),

  nudgeRail: (key, end, delta, note) =>
    set((s) => {
      if (!delta) return { nudgeNote: note };
      const adjust = { ...s.profile.rail.adjust };
      const cur = adjust[key] ?? {};
      adjust[key] = { ...cur, [end]: (cur[end] ?? 0) + delta };
      return { profile: { ...s.profile, rail: { ...s.profile.rail, adjust } }, nudgeNote: null };
    }),

  setDuctGap: (ductIndex, gap) =>
    set((s) => {
      const next = { ...s.profile.duct.ductGaps };
      if (gap) next[ductIndex] = gap;
      else delete next[ductIndex];
      return { profile: { ...s.profile, duct: { ...s.profile.duct, ductGaps: next } } };
    }),

  addDevice: (specId, qty) =>
    set((s) => {
      const spec = [...s.devices, ...s.myDevices].find((d) => d.id === specId);
      const allowed = FACE_BY_ID.get(s.face)?.mounts ?? [];
      if (!spec) return s;
      // タップ穴加工付きの部品は中板専用（ボタン側も灰色にしてあるが、二重に守る）
      if (s.face !== 'plate' && hasTapCuts(spec)) return s;
      // タップ付きの部品はネジ止め前提なので、両対応でも既定を直付けにする。
      // DIN のままだと追加加工（直付けのとき）が出ず、「タップが出ない」に見える
      const mount =
        hasTapCuts(spec) && spec.mount.includes('direct') && allowed.includes('direct')
          ? 'direct'
          : spec.mount.find((m) => allowed.includes(m));
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

  setItemOpts: (uid, opts) =>
    set((s) => {
      const item = s.items.find((i) => i.uid === uid);
      if (!item) return s;
      const lookup = deviceLookup(s.devices, s.myDevices);
      const spec = lookup.get(item.specId);
      /*
       * OP に DINレール取付品（アタッチメント）が入ったら、その1台は DIN 取付として
       * 扱う — レールに座り、取付穴のケガキも出なくなる。直付け機器を DIN 化する
       * アタッチメントの用途そのもの。全部外したら部品本来の取付方式へ戻す。
       */
      const optDin = opts.some((id) => lookup.get(id)?.mount.includes('din'));
      let mount: MountType = item.mount;
      let mountBeforeOp = item.mountBeforeOp;
      if (optDin && item.mount !== 'din') {
        // 切り替える前の方式を覚えておく。外したときに元へ戻すため
        mountBeforeOp = item.mount;
        mount = 'din';
      } else if (!optDin) {
        if (mountBeforeOp && spec?.mount.includes(mountBeforeOp)) mount = mountBeforeOp;
        else if (spec && !spec.mount.includes(mount)) mount = spec.mount[0] ?? mount;
        mountBeforeOp = undefined;
      }
      const norm = opts.length > 0 ? opts : undefined;
      return {
        items: s.items.map((i) => (i.uid === uid ? { ...i, opts: norm, mount, mountBeforeOp } : i)),
        pinned: s.pinned.map((p) => (p.uid === uid ? { ...p, opts: norm, mount } : p)),
      };
    }),

  setItemRow: (specId, row) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.specId === specId && i.face === s.face ? { ...i, row } : i,
      ),
      pinned: s.pinned.filter((p) => !(p.specId === specId && p.face === s.face)),
    })),

  setItemSide: (uid, side) =>
    set((s) => ({
      items: s.items.map((i) => (i.uid === uid ? { ...i, side: side === 'out' ? undefined : side } : i)),
    })),

  setItemShowOn: (uid, faces) =>
    set((s) => ({
      items: s.items.map((i) => (i.uid === uid ? { ...i, showOn: faces } : i)),
    })),

  removeSelected: () =>
    set((s) => {
      if (s.selectedDuct !== null) {
        const cur = s.removedDucts[s.face] ?? [];
        return {
          removedDucts: { ...s.removedDucts, [s.face]: [...cur, s.selectedDuct] },
          selectedDuct: null, selectedRail: null,
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
      selectedDuct: null, selectedRail: null,
    })),

  select: (uid) => set({ selectedUid: uid, selectedCut: null, selectedDuct: null, selectedRail: null, nudgeNote: null }),

  selectCut: (id) => set({ selectedCut: id, selectedUid: null, selectedDuct: null, selectedRail: null }),

  selectDuct: (id) => set({ selectedDuct: id, selectedUid: null, selectedCut: null, nudgeNote: null }),

  rotateItem: (uid) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.uid === uid ? { ...i, rot: (((i.rot ?? 0) + 90) % 360) as Rotation } : i,
      ),
      // 回すと外形が変わるので、手で固定していた座標は捨てて置き直す
      pinned: s.pinned.filter((p) => p.uid !== uid),
    })),

  moveItem: (uid, beforeUid, row, currentRows, zone) =>
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
      // 上下に動かしたときだけ段を指定し直す。左右に動かしただけなら「自動」のまま残す。
      // ゾーン分割では、区画をまたいだときにその区画を覚える（分類の既定より優先される）
      const item = {
        ...moved,
        ...(row !== undefined ? { row } : {}),
        ...(zone !== undefined ? { zone } : {}),
      };
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

  unpin: (uid) => set((s) => ({ pinned: s.pinned.filter((p) => p.uid !== uid) })),

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

});
