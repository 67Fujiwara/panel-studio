/**
 * 図の操作の「戻す／やり直す」（Ctrl+Z / Ctrl+Y）。
 *
 * 間違えて機器を動かした・消した・加工を足した、を1手ずつ戻せるようにする。
 * ストアの中身（机の上）を丸ごと控えるやり方にしてある。操作ごとに逆操作を書くより
 * 漏れが無く、机の上は数十 KB なので 50 手ぶん持っても重くない。
 *
 * - 控えるのは机の上だけ（置いた機器・座標・加工・消したダクト・下敷き・段の設定）。
 *   部品表や完了案件は対象にしない（それらは図の操作ではない）
 * - ドラッグ中は 1 ピクセル動くたびにストアが変わるので、**つかんでから放すまでを1手**にまとめる
 *   （beginGroup / endGroup）。矢印キーの連打なども、短い間隔の変更は1手にまとめる
 * - 面を移る・画面を移る・案件を切り替えると履歴は捨てる。別の面の変更が黙って戻るのを防ぐ
 */
import { create } from 'zustand';
import type { State } from '../store';
import { useStore } from '../store';

type Snap = Pick<State, 'items' | 'pinned' | 'machining' | 'removedDucts' | 'underlays' | 'profile'>;
const KEYS: (keyof Snap)[] = ['items', 'pinned', 'machining', 'removedDucts', 'underlays', 'profile'];
const MAX = 50;
/** これより短い間隔で続く変更は1手にまとめる(ms) */
const COALESCE_MS = 300;

const pick = (s: State): Snap => ({
  items: s.items,
  pinned: s.pinned,
  machining: s.machining,
  removedDucts: s.removedDucts,
  underlays: s.underlays,
  profile: s.profile,
});

let past: Snap[] = [];
let future: Snap[] = [];
let restoring = false;
let grouping = false;
/** いまのグループで既に控えを取ったか */
let groupHasEntry = false;
let lastChangeAt = 0;

/** 画面のボタン用の件数。履歴そのものは置かない（描画のたびに配列を触らせない） */
export const useUndoCounts = create<{ past: number; future: number }>(() => ({ past: 0, future: 0 }));
const publish = () => useUndoCounts.setState({ past: past.length, future: future.length });

function clear() {
  if (past.length === 0 && future.length === 0) return;
  past = [];
  future = [];
  publish();
}

/** ドラッグの始まり。放すまでの変更を1手にまとめる */
export function beginUndoGroup() {
  grouping = true;
  groupHasEntry = false;
}

export function endUndoGroup() {
  grouping = false;
  groupHasEntry = false;
}

export function undo(): boolean {
  const prev = past.pop();
  if (!prev) return false;
  const s = useStore.getState();
  future.push(pick(s));
  restoring = true;
  useStore.setState({ ...prev, selectedUid: null, selectedCut: null, selectedDuct: null });
  restoring = false;
  lastChangeAt = 0;
  publish();
  return true;
}

export function redo(): boolean {
  const next = future.pop();
  if (!next) return false;
  const s = useStore.getState();
  past.push(pick(s));
  restoring = true;
  useStore.setState({ ...next, selectedUid: null, selectedCut: null, selectedDuct: null });
  restoring = false;
  lastChangeAt = 0;
  publish();
  return true;
}

/** 起動時に1回。ストアを見張って控えを取る */
export function startUndoTracking() {
  useStore.subscribe((now, before) => {
    if (restoring) return;
    // 面や画面を移ったら履歴は捨てる（別の面の変更が黙って戻らないように）
    if (now.screen !== before.screen || now.face !== before.face || now.currentDraftId !== before.currentDraftId) {
      // 机を自動でしまうと currentDraftId が null → id になるが、机の中身は変わらないので履歴は残す
      const deskSame = KEYS.every((k) => now[k] === before[k]);
      if (!(deskSame && now.screen === before.screen && now.face === before.face)) clear();
      if (deskSame) return;
    }
    if (now.screen !== 'layout') return;
    if (KEYS.every((k) => now[k] === before[k])) return;
    const t = Date.now();
    const merge = grouping ? groupHasEntry : t - lastChangeAt < COALESCE_MS && past.length > 0;
    lastChangeAt = t;
    if (merge) return;
    past.push(pick(before));
    if (past.length > MAX) past.shift();
    future = [];
    if (grouping) groupHasEntry = true;
    publish();
  });
}
