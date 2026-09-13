// docs/icon.svg から Windows のショートカット用 .ico と .png を作る（npm run icons）
// PNG は Chromium で描いて撮る。ICO は PNG をそのまま入れる形式（Vista 以降の Windows が読める）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Playwright は開発機に入っているものを使う（プロジェクトの依存には足さない。実行時に要らないので）。
// プロジェクト → グローバル（npm -g）の順に探す
const require = createRequire(import.meta.url);
const chromium = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try {
      return require(p).chromium;
    } catch {
      /* 次の候補へ */
    }
  }
  throw new Error('playwright が見つかりません。npm i -g playwright && npx playwright install chromium');
})();

const root = path.resolve(new URL('..', import.meta.url).pathname);
const svg = fs.readFileSync(path.join(root, 'docs/icon.svg'), 'utf8');
const sizes = [16, 32, 48, 256];

const browser = await chromium.launch();
const pngs = {};
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="${s}" height="${s}" style="display:block"></body></html>`,
  );
  pngs[s] = await page.screenshot({ omitBackground: true, type: 'png' });
  await page.close();
}
await browser.close();

// 置き場所は docs/。release/ はビルドのたびに空になるので、finish-single がそこから写す
fs.writeFileSync(path.join(root, 'docs/panel-studio.png'), pngs[256]);

// ICO: ヘッダ(6) + エントリ(16×n) + 各 PNG
const n = sizes.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(n, 4);
const entries = [];
const bodies = [];
let offset = 6 + 16 * n;
for (const s of sizes) {
  const data = pngs[s];
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // 256 は 0 と書く決まり
  e.writeUInt8(s === 256 ? 0 : s, 1);
  e.writeUInt8(0, 2); // パレット無し
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  bodies.push(data);
  offset += data.length;
}
fs.writeFileSync(path.join(root, 'docs/panel-studio.ico'), Buffer.concat([header, ...entries, ...bodies]));
console.log(`✓ docs/panel-studio.ico (${sizes.join('/')} px) と docs/panel-studio.png (256px) を作りました`);
console.log('  build:single のたびに release/ へも写されます');
