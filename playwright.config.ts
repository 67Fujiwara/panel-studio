import { defineConfig } from '@playwright/test';

/**
 * 画面を通したテスト。ビルド済みの release/panel-studio.html を file:// で開いて操作する
 * （配布物そのものを試す。先に `npm run build:single` が要る）。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    viewport: { width: 1700, height: 1100 },
    actionTimeout: 15_000,
  },
});
