// build:single のあと、出力された index.html を配布しやすい名前に変える。
import { copyFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = 'release';
const FILE_NAME = 'panel-studio.html';

await rename(join(OUT_DIR, 'index.html'), join(OUT_DIR, FILE_NAME));

// Windows のショートカット用アイコン（npm run icons で docs/ に作ったもの）も一緒に置く。
// タブのアイコンは HTML に埋め込み済みなので、これは無くてもアプリは動く
for (const name of ['panel-studio.ico', 'panel-studio.png']) {
  await copyFile(join('docs', name), join(OUT_DIR, name)).catch(() => {});
}

// 埋め込み済みで不要になった空フォルダ（assets など）を片付ける
for (const entry of await readdir(OUT_DIR)) {
  if (entry === FILE_NAME) continue;
  const path = join(OUT_DIR, entry);
  const info = await stat(path);
  if (info.isDirectory() && (await readdir(path)).length === 0) {
    await rm(path, { recursive: true });
  }
}

const { size } = await stat(join(OUT_DIR, FILE_NAME));
console.log(`\n✓ ${OUT_DIR}/${FILE_NAME} を作成しました（${(size / 1024).toFixed(0)} KB）`);
console.log('  このファイル1つを共有フォルダに置き、ダブルクリックで開けます。\n');
