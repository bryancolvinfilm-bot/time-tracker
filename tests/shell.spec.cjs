const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('desktop shell connects to SQLite, navigates, and persists appearance across launches', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'time-tracker-test-'));
  const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.TIME_TRACKER_EXECUTABLE
    ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env };
  let application;
  try {
    application = await electron.launch(launchOptions);
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page).toHaveTitle('Time Tracker');
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    const header = await readFile(path.join(directory, 'time-tracker.sqlite'));
    expect(header.subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
    for (const section of ['users', 'projects', 'settings', 'today']) {
      await page.locator(`[data-page="${section}"]`).click();
      await expect(page.locator(`#page-${section}`)).toBeVisible();
    }
    await page.setViewportSize({ width: 900, height: 680 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1240, height: 850 });
    await page.screenshot({ path: 'test-results/time-tracker-light.png' });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/time-tracker-dark.png' });
    const invalidThemeRejected = await page.evaluate(async () => {
      try { await window.timeTracker.setTheme('invalid'); return false; }
      catch { return true; }
    });
    expect(invalidThemeRejected).toBe(true);
    expect(errors).toEqual([]);
    await application.close();
    application = await electron.launch(launchOptions);
    const reopenedPage = await application.firstWindow();
    await expect(reopenedPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await reopenedPage.locator('[data-page="settings"]').click();
    await expect(reopenedPage.locator('[data-theme-choice="dark"]')).toHaveAttribute('aria-pressed', 'true');
    await reopenedPage.locator('[data-theme-choice="light"]').click();
    await expect(reopenedPage.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
