import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode=single のときは JS/CSS を1つの HTML に埋め込む。
// 共有フォルダに置いてダブルクリックで開く配布用。
export default defineConfig(({ mode }) => {
  const single = mode === 'single';

  return {
    // file:// で開いても読み込めるよう相対パスにする
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: single
      ? {
          outDir: 'release',
          cssCodeSplit: false,
          assetsInlineLimit: 100_000_000,
          chunkSizeWarningLimit: 8000,
        }
      : {},
    server: { host: true, port: 5173 },
  };
});
