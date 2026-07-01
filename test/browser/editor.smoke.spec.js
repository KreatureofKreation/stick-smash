import { expect, test } from '@playwright/test';

test.describe('level editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor.html');
    await page.waitForSelector('#editor-toolbar button[data-tool="tile"]');
  });

  test('loads without console errors and paints the canvas', async ({ page }) => {
    const errors = collectErrors(page);
    await expect(page.locator('#editor-sidebar')).toContainText('Level');
    await expect(page.locator('#editor-sidebar')).toContainText('Brush');
    await expect(page.locator('#editor-status')).toContainText(/tiles/);

    const canvas = page.locator('#editor-canvas');
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(800);
    expect(box?.height).toBeGreaterThan(500);

    const paintedPixels = await countPaintedPixels(page);
    expect(paintedPixels).toBeGreaterThan(500);
    expect(errors()).toEqual([]);
  });

  test('places a tile and updates selection/inspector', async ({ page }) => {
    const errors = collectErrors(page);
    await page.locator('[data-tool="tile"]').click();
    await clickWorld(page, -14, 8);

    await expect(page.locator('#editor-status')).toContainText('tiles');
    await expect(page.locator('#editor-sidebar')).toContainText('Inspector');
    await expect(page.locator('[data-object-field="material"]')).toHaveValue('stone');

    const tileCount = await page.evaluate(() => window.editor.state.level.tiles.length);
    expect(tileCount).toBeGreaterThan(0);
    expect(errors()).toEqual([]);
  });

  test('drag-resizes a selected tile from canvas handles', async ({ page }) => {
    const errors = collectErrors(page);
    await page.locator('[data-tool="tile"]').click();
    await clickWorld(page, -14, 8);
    await page.locator('[data-tool="select"]').click();

    const before = await selectedTile(page);
    const start = { x: before.x + (before.w ?? 1) / 2, y: before.y - (before.h ?? 1) / 2 };
    const end = { x: before.x + 3, y: before.y - 2 };
    await dragWorld(page, start, end);

    const after = await selectedTile(page);
    expect(after.w).toBeGreaterThan(before.w ?? 1);
    expect(after.h).toBeGreaterThan(before.h ?? 1);
    await expect(page.locator('[data-object-field="w"]')).toHaveValue(String(after.w));
    expect(errors()).toEqual([]);
  });

  test('resize handles are hidden outside the select tool', async ({ page }) => {
    const errors = collectErrors(page);
    await page.locator('[data-tool="tile"]').click();
    await clickWorld(page, -14, 8);
    await page.locator('[data-tool="select"]').click();

    const tile = await selectedTile(page);
    const handle = { x: tile.x + (tile.w ?? 1) / 2, y: tile.y - (tile.h ?? 1) / 2 };
    await waitForHandlePixel(page, handle, true);

    await page.locator('[data-tool="tile"]').click();
    await waitForHandlePixel(page, handle, false);
    expect(errors()).toEqual([]);
  });

  test('advanced fields can be configured and exported', async ({ page }) => {
    const errors = collectErrors(page);
    await ensureDetailsOpen(page, 'level-advanced');
    await page.locator('[data-level-toggle="killBound"]').check();
    await ensureDetailsOpen(page, 'level-advanced');
    await page.locator('[data-level-path="killBound.x"]').fill('40');
    await page.locator('[data-level-path="killBound.x"]').blur();

    await page.locator('[data-tool="tile"]').click();
    await clickWorld(page, -14, 8);
    await ensureDetailsOpen(page, 'tile-advanced');
    await page.locator('[data-object-toggle="move"]').check();
    await ensureDetailsOpen(page, 'tile-advanced');
    await page.locator('[data-object-path="move.to"]').fill('12');
    await page.locator('[data-object-path="move.to"]').blur();
    await ensureDetailsOpen(page, 'tile-advanced');
    await page.locator('[data-object-toggle="suspend"]').check();
    await ensureDetailsOpen(page, 'tile-advanced');
    await page.locator('[data-object-path="suspend.y"]').fill('14');
    await page.locator('[data-object-path="suspend.y"]').blur();
    await page.locator('[data-object-field="breach"]').check();
    await ensureDetailsOpen(page, 'tile-advanced');
    await page.locator('[data-object-field="icicle"]').check();

    await page.locator('[data-tool="hazards"]').click();
    await clickWorld(page, -5, -4);
    await ensureDetailsOpen(page, 'hazard-advanced');
    await page.locator('[data-object-toggle="rise"]').check();
    await ensureDetailsOpen(page, 'hazard-advanced');
    await page.locator('[data-object-path="rise.height"]').fill('6');
    await page.locator('[data-object-path="rise.height"]').blur();

    await page.locator('[data-command="export-js"]').click();
    const text = await page.locator('#modal-text').inputValue();
    const parsed = await page.evaluate((source) => {
      const cleaned = source.replace(/^\/\/.*\n/, '');
      return Function(`"use strict"; return (${cleaned});`)();
    }, text);
    expect(parsed.killBound.x).toBe(40);
    const advancedTile = parsed.tiles.find(tile => tile.move && tile.suspend);
    expect(advancedTile.move.to).toBe(12);
    expect(advancedTile.suspend.y).toBe(14);
    expect(advancedTile.breach).toBe(true);
    expect(advancedTile.icicle).toBe(true);
    const risingLava = parsed.hazards.find(hazard => hazard.kind === 'lava' && hazard.rise);
    expect(risingLava.rise.height).toBe(6);
    expect(errors()).toEqual([]);
  });

  test('exports valid JavaScript level data', async ({ page }) => {
    const errors = collectErrors(page);
    await page.locator('[data-command="export-js"]').click();
    await expect(page.locator('#editor-modal')).toHaveClass(/open/);

    const text = await page.locator('#modal-text').inputValue();
    expect(text).toContain('Generated by Stick Smash Level Editor');
    expect(text).toContain('tiles');

    const parsed = await page.evaluate((source) => {
      const cleaned = source.replace(/^\/\/.*\n/, '');
      return Function(`"use strict"; return (${cleaned});`)();
    }, text);
    expect(parsed.id).toBeTruthy();
    expect(parsed.tiles.length).toBeGreaterThan(0);
    expect(parsed.spawns.length).toBeGreaterThanOrEqual(2);
    expect(errors()).toEqual([]);
  });

  test('playtest stores level and opens the game route', async ({ page, context }) => {
    const errors = collectErrors(page);
    const popupPromise = context.waitForEvent('page');
    await page.locator('[data-command="playtest"]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    expect(popup.url()).toContain('/index.html?playtestLevel=1&dev=1');
    const stored = await page.evaluate(() => localStorage.getItem('sticksmash.editor.playtestLevel'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    expect(parsed.tiles.length).toBeGreaterThan(0);
    expect(errors()).toEqual([]);
    await popup.close();
  });
});

function collectErrors(page) {
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.stack || error.message));
  return () => errors;
}

async function countPaintedPixels(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    const step = Math.max(4, Math.floor(Math.min(width, height) / 180));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 0 && (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20)) count++;
      }
    }
    return count;
  });
}

async function clickWorld(page, x, y) {
  const point = await page.evaluate(({ x: wx, y: wy }) => window.editor.worldToScreen(wx, wy), { x, y });
  await page.mouse.click(point.x, point.y);
}

async function dragWorld(page, from, to) {
  const a = await page.evaluate(({ x, y }) => window.editor.worldToScreen(x, y), from);
  const b = await page.evaluate(({ x, y }) => window.editor.worldToScreen(x, y), to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function selectedTile(page) {
  return page.evaluate(() => {
    const selected = window.editor.state.selectedObject();
    if (!selected || selected.type !== 'tiles') throw new Error('No tile selected');
    return { ...selected.item };
  });
}

async function ensureDetailsOpen(page, detail) {
  const locator = page.locator(`details[data-detail="${detail}"]`);
  if (!await locator.evaluate(el => el.open)) {
    await locator.locator('summary').click();
  }
}

async function waitForHandlePixel(page, world, expected) {
  await expect.poll(() => hasHandlePixelNearWorld(page, world), {
    timeout: 3000,
    message: expected ? 'resize handle should be visible' : 'resize handle should be hidden',
  }).toBe(expected);
}

async function hasHandlePixelNearWorld(page, world) {
  return page.evaluate(({ x, y }) => {
    const editor = window.editor;
    const canvas = document.getElementById('editor-canvas');
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const point = editor.worldToScreen(x, y);
    const dprX = canvas.width / rect.width;
    const dprY = canvas.height / rect.height;
    const cx = Math.round(point.x * dprX);
    const cy = Math.round(point.y * dprY);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let yy = Math.max(0, cy - 7); yy <= Math.min(height - 1, cy + 7); yy++) {
      for (let xx = Math.max(0, cx - 7); xx <= Math.min(width - 1, cx + 7); xx++) {
        const i = (yy * width + xx) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 220 && g > 170 && b < 120) return true;
      }
    }
    return false;
  }, world);
}
