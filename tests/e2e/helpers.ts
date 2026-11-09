import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** 配布物。file:// で開く（共有フォルダから開くのと同じ条件） */
export const APP_URL = `file://${path.resolve(here, '../../release/panel-studio.html')}`;

/** 新規作成から中板のレイアウト画面まで進める */
export async function openPlate(page: Page) {
  page.on('dialog', (d) => d.accept());
  await page.goto(APP_URL);
  await page.waitForSelector('.start');
  const depth = page.locator('.start .grid3').last().locator('input[type=number]');
  await depth.nth(0).fill('70');
  await depth.nth(1).fill('170');
  await page.getByRole('button', { name: 'この寸法で進む' }).click();
  await page.locator('.ufcell', { hasText: '中板' }).click();
  await page.waitForSelector('.plate');
}

/** 部品の検索欄で型式を引き、＋ を n 回押す */
export async function addDevice(page: Page, query: string, model: string, n: number) {
  const search = page.locator('input.search').first();
  await search.fill(query);
  const leaf = page.locator('li.dev', { has: page.locator('strong', { hasText: model }) }).first();
  for (let i = 0; i < n; i++) await leaf.locator('button[aria-label="増やす"]').click();
  await search.fill('');
  await page.waitForTimeout(150);
}

/** 図の上の機器の矩形（SVG 座標） */
export async function devices(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('svg .device')].map((g) => {
      const r = g.querySelector('rect')!;
      return {
        x: +r.getAttribute('x')!,
        y: +r.getAttribute('y')!,
        w: +r.getAttribute('width')!,
        h: +r.getAttribute('height')!,
        selected: g.classList.contains('selected'),
      };
    }),
  );
}

/** 図の上のレール（SVG 座標） */
export async function rails(page: Page) {
  return page.locator('svg rect.rail').evaluateAll((els) =>
    els.map((el) => ({ x: +el.getAttribute('x')!, w: +el.getAttribute('width')!, y: +el.getAttribute('y')! })),
  );
}

/** SVG 座標 → 画面座標 の変換を作る */
export async function toScreen(page: Page) {
  const svg = page.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const vb = (await svg.getAttribute('viewBox'))!.split(' ').map(Number) as [number, number, number, number];
  const scale = Math.max(vb[2] / box.width, vb[3] / box.height);
  const offX = (box.width - vb[2] / scale) / 2;
  const offY = (box.height - vb[3] / scale) / 2;
  return {
    x: (x: number) => box.x + offX + (x - vb[0]) / scale,
    y: (y: number) => box.y + offY + (y - vb[1]) / scale,
  };
}

/** 機器をつかんで画面座標 (tx, ty) まで少しずつ動かして放す */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12, { steps: 2 });
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export { expect };
