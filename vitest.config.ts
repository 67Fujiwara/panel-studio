import { defineConfig } from 'vitest/config';

/**
 * 単体テスト（Vitest）。対象は画面を持たない純粋な計算（配置・レール・冷却・CSV・DXF）。
 * 画面を通したテストは tests/e2e（Playwright）で、ビルド済みの release/panel-studio.html を開いて行う。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
