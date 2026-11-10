/** AI 自動配置。接続先はブラウザにだけ持ち、案は取り消せる。 */
import type { StateCreator } from 'zustand';
import { DUCT_LAYOUT_LABEL } from '../data/enclosures';
import { DEFAULT_AI } from '../lib/ai';
import type { LayoutItem } from '../lib/layout';
import { rotatedSize } from '../types';
import type { AiSettings, Machining, PlacedDevice, Profile } from '../types';
import { deviceLookup, nextId } from './shared';
import type { AiSlice, State } from './types';


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

export const createAiSlice: StateCreator<State, [], [], AiSlice> = (set) => ({

  ai: loadAi(),

  aiReview: null,

  aiFeedback: '',

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
    set({ ...back, selectedUid: null });
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

});
