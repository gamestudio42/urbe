import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { pinE2ELocale, startCity } from './helpers';

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 412, height: 915 },
  { width: 915, height: 412 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
] as const;

async function emulateCoarsePointer(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await client.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  return client;
}

async function touchDrag(
  client: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const steps = 8;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 0 }],
  });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
          id: 0,
        },
      ],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('touch and small screens', () => {
  test.use({
    viewport: { width: 915, height: 412 },
    hasTouch: true,
    isMobile: true,
  });

  test('the menu reaches Found city and targets are at least 44px', async ({ page }) => {
    await emulateCoarsePointer(page);
    await pinE2ELocale(page);
    await page.goto('/');
    await page.getByTestId('main-menu').waitFor();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const start = page.getByTestId('start-city');
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport();
      const box = await start.boundingBox();
      expect(box, `${viewport.width}x${viewport.height}`).toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    }

    await page.setViewportSize({ width: 360, height: 740 });
    const sound = await page.getByTestId('menu-sound').boundingBox();
    expect(sound!.width).toBeGreaterThanOrEqual(44);
    expect(sound!.height).toBeGreaterThanOrEqual(44);
    const language = await page.locator('.menu-locale .locale-trigger').boundingBox();
    expect(language!.height).toBeGreaterThanOrEqual(44);
    const name = await page.getByTestId('city-name-input').boundingBox();
    expect(name!.height).toBeGreaterThanOrEqual(44);
    const seed = await page.getByTestId('seed-input').boundingBox();
    expect(seed!.height).toBeGreaterThanOrEqual(44);
  });

  test('one finger pans, a tap selects, and a pinch zooms', async ({ page }) => {
    await emulateCoarsePointer(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await startCity(page, 'touch');
    await expect(page.getByTestId('tutorial')).toBeHidden();

    const tool = await page.getByTestId('tool-select').boundingBox();
    expect(tool!.width).toBeGreaterThanOrEqual(44);
    expect(tool!.height).toBeGreaterThanOrEqual(44);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const label = page.locator('.hud-label', { hasText: 'População' });
      await expect(label).toBeVisible();
      const box = await label.boundingBox();
      expect(box, `${viewport.width}x${viewport.height}`).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      const clipped = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped, `${viewport.width}x${viewport.height}`).toBe(false);
      await expect(page.getByTestId('open-system')).toBeInViewport();
    }

    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => window.__cityDebug?.centerOnTile(40, 40));
    const client = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => window.__cityDebug?.tileToClient(40, 40));
    expect(before).toBeTruthy();
    await touchDrag(client, { x: 240, y: 460 }, { x: 240, y: 300 });
    const after = await page.evaluate(() => window.__cityDebug?.tileToClient(40, 40));
    expect(after).toBeTruthy();
    expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(40);
    await expect.poll(() => page.evaluate(() => window.__cityDebug?.getSelected())).toBeNull();

    const separation = () =>
      page.evaluate(() => {
        const a = window.__cityDebug?.tileToClient(36, 36);
        const b = window.__cityDebug?.tileToClient(42, 42);
        if (!a || !b) return 0;
        return Math.hypot(a.x - b.x, a.y - b.y);
      });
    const near = await separation();
    // Land the second finger on its own touchStart. A single event that introduces two
    // fingers is dropped by Chrome after another touch injector has run.
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 200, y: 480, id: 0 }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 200, y: 480, id: 0 },
        { x: 250, y: 480, id: 1 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 150, y: 480, id: 0 },
        { x: 310, y: 480, id: 1 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const far = await separation();
    expect(far).toBeGreaterThan(near * 1.2);

    await page.evaluate(() => window.__cityDebug?.centerOnTile(40, 40));
    const point = await page.evaluate(() => window.__cityDebug?.tileToClient(40, 40));
    expect(point).toBeTruthy();
    await page.touchscreen.tap(point!.x, point!.y);
    await expect
      .poll(() => page.evaluate(() => window.__cityDebug?.getSelected()))
      .toEqual({ x: 40, y: 40 });
  });

  test('the tutorial uses gesture wording and hides shortcuts', async ({ page }) => {
    await emulateCoarsePointer(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await startCity(page, 'touch-tutorial', { tutorial: true });
    const tutorial = page.getByTestId('tutorial');
    await expect(tutorial).toContainText('Arraste com um dedo');
    await expect(tutorial).toContainText('dois dedos');
    await expect(tutorial).not.toContainText('botão direito');
    await expect(tutorial).not.toContainText('roda do mouse');
    await expect(tutorial).not.toContainText('(R)');
    await page.getByTestId('open-system').click();
    const help = page.getByTestId('system-panel');
    await expect(help).toContainText('Arraste com um dedo');
    await expect(help).not.toContainText('Atalhos:');
    await page.getByTestId('speed-0').click();
    await expect(page.getByTestId('pause-overlay')).toContainText('Toque em ▶');
    await expect(page.getByTestId('pause-overlay')).not.toContainText('P ou');
  });
});

test('a mouse still sees the keyboard tutorial wording', async ({ page }) => {
  await pinE2ELocale(page);
  await page.addInitScript(() => localStorage.removeItem('cityBuilder.tutorialDone'));
  await page.goto('/');
  await page.getByTestId('main-menu').waitFor();
  await page.getByTestId('seed-input').fill('mouse-tutorial');
  await page.getByTestId('start-city').click();
  await page.waitForFunction(() => window.__cityDebug?.isReady() === true);
  const tutorial = page.getByTestId('tutorial');
  await expect(tutorial).toContainText('botão direito');
  await expect(tutorial).toContainText('roda do mouse');
  await expect(tutorial).not.toContainText('um dedo');
});
