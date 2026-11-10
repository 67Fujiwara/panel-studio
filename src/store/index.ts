/**
 * ストアの入口。5 つのスライスを 1 つの zustand ストアに合わせる。
 * 他のファイルからは今までどおり '../store' を import する。
 */
import { create } from 'zustand';
import { markBackupSeen } from '../lib/backup';
import { createAiSlice } from './ai';
import { createConfigSlice } from './config';
import { createLayoutSlice } from './layout';
import { createProjectSlice } from './projects';
import { createSettingsSlice } from './settings';
import type { BackupBundle, State } from './types';

export { deviceLookup } from './shared';
export type {
  AiReview,
  AiSlice,
  BackupBundle,
  ConfigFile,
  ConfigSlice,
  Draft,
  LayoutSlice,
  MyConfigFile,
  Project,
  ProjectFile,
  ProjectSlice,
  Screen,
  SettingsSlice,
  State,
} from './types';

export const useStore = create<State>()((...a) => ({
  ...createLayoutSlice(...a),
  ...createConfigSlice(...a),
  ...createProjectSlice(...a),
  ...createSettingsSlice(...a),
  ...createAiSlice(...a),
}));

/** いまのストアの中身から全部入りバックアップを作る。 */
export function makeBundle(): BackupBundle {
  const s = useStore.getState();
  return {
    schemaVersion: 1,
    kind: 'bundle',
    savedAt: new Date().toISOString(),
    config: {
      schemaVersion: 1,
      categories: s.categories,
      devices: s.devices,
      profile: s.profile,
      enclosures: s.enclosures,
      ducts: s.ducts,
      prices: s.prices,
    },
    my: { schemaVersion: 1, owners: s.owners, devices: s.myDevices },
    // 作業中の案件も入れる。バックアップ1つで掛け持ちの机ごと持ち運べるように
    projects: { schemaVersion: 1, projects: s.projects, drafts: s.drafts },
  };
}

/** 全部入りバックアップをストアへ読み込む。完了案件が空なら既存を消さない。 */
export function loadBundle(b: BackupBundle): void {
  const s = useStore.getState();
  // 手で編集された・壊れたファイルでも、読める部分だけは読む
  if (b.config) s.loadConfig(b.config);
  if (b.my) s.loadMyConfig(b.my);
  if (b.projects && (b.projects.projects.length > 0 || (b.projects.drafts ?? []).length > 0))
    s.loadProjectFile(b.projects);
  markBackupSeen(b.savedAt);
}

/** 全部入りバックアップの形をしているか（ファイルの中身で判定する） */
export function isBundle(v: unknown): v is BackupBundle {
  const d = v as Record<string, unknown> | null;
  return Boolean(d && d.schemaVersion === 1 && d.kind === 'bundle' && d.config && d.my);
}
