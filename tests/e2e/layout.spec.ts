import { test } from '@playwright/test';
import { addDevice, devices, drag, expect, openPlate, rails, toScreen } from './helpers';

test.describe('中板のレイアウト操作', () => {
  test('矢印キーで機器を 1mm（Shift で 10mm）動かせる', async ({ page }) => {
    await openPlate(page);
    await addDevice(page, 'NF63', 'NF63-SV 3P 60A', 2);
    const before = await devices(page);
    await page.locator('svg .device').first().click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const after = (await devices(page)).find((d) => d.selected)!;
    const was = before.find((d) => Math.abs(d.y - after.y) < 0.01 && Math.abs(d.x + 11 - after.x) < 0.01);
    expect(was).toBeTruthy();
  });

  test('端子台を隣の端子台の近くへドラッグすると隙間なく並ぶ', async ({ page }) => {
    await openPlate(page);
    await addDevice(page, 'UT 2.5', 'UT 2.5', 6);
    const s = await toScreen(page);
    const tbs = (await devices(page)).sort((a, b) => a.x - b.x);
    const src = tbs[0]!;
    const dst = tbs[tbs.length - 1]!;
    // 先頭の 1 台を末尾の 3mm 右へ
    await drag(
      page,
      { x: s.x(src.x + src.w / 2), y: s.y(src.y + src.h / 2) },
      { x: s.x(dst.x + dst.w + 3 + src.w / 2), y: s.y(dst.y + dst.h / 2) },
    );
    const after = (await devices(page)).sort((a, b) => a.x - b.x);
    for (let i = 1; i < after.length; i++) expect(after[i]!.x - after[i - 1]!.x - after[i - 1]!.w).toBeCloseTo(0, 5);
    await expect(page.locator('button.on.primary', { hasText: '座標で置く' })).toHaveCount(0);
  });

  test('端子台を離れた空き場所へドラッグするとそこに置かれ、レールは面の外へ出ない', async ({ page }) => {
    await openPlate(page);
    await addDevice(page, 'UT 2.5', 'UT 2.5', 4);
    const s = await toScreen(page);
    const tbs = (await devices(page)).sort((a, b) => a.x - b.x);
    const last = tbs[tbs.length - 1]!;
    await drag(page, { x: s.x(last.x + last.w / 2), y: s.y(last.y + last.h / 2) }, { x: s.x(400), y: s.y(last.y + last.h / 2) });
    const moved = (await devices(page)).find((d) => d.selected)!;
    expect(moved.x).toBeGreaterThan(380);
    await expect(page.locator('button.on.primary', { hasText: '座標で置く' })).toHaveCount(1);
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight');
    for (const r of await rails(page)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(540.01);
    }
  });

  test('DINレールの端を選んで ← → で伸び縮みでき、機器より内側には縮まない', async ({ page }) => {
    await openPlate(page);
    await addDevice(page, 'NF63', 'NF63-SV 3P 60A', 2);
    const before = (await rails(page))[0]!;
    await page.locator('svg rect.rail-grip').nth(1).click();
    await expect(page.locator('svg rect.rail.selected')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect((await rails(page))[0]!.w).toBeCloseTo(before.w + 11, 5);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    // 機器 2 台 = 150mm まで
    expect((await rails(page))[0]!.w).toBeCloseTo(150, 5);
    await expect(page.locator('.nudge-note')).toContainText('縮められません');
  });
});

test.describe('面選択画面', () => {
  test('展開図の機器に載せると型式と品名の吹き出しが出て、離すと消える', async ({ page }) => {
    await openPlate(page);
    await addDevice(page, 'FX5U', 'FX5U-32MT/ES', 1);
    await page.getByRole('button', { name: '← 面選択' }).click();
    const hit = page.locator('svg.unfold .ufdev, svg.unfold .ufhit').first();
    await hit.hover();
    await expect(page.locator('svg.unfold .ufhover text')).toHaveText(/FX5U-32MT\/ES/);
    await page.mouse.move(5, 5);
    await expect(page.locator('svg.unfold .ufhover')).toHaveCount(0);
  });
});
