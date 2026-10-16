const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const { openStorage } = require('../electron/storage.cjs');

test('project and Sunday–Saturday totals include live time, isolate projects, and retain dated clock stamps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-summary-'));
  const now = new Date(2026, 9, 14, 12).getTime();
  const sunday = new Date(2026, 9, 11).getTime();
  const hour = 3_600_000;
  let application;
  try {
    const storage = openStorage(directory);
    let user, project, otherUser, otherProject;
    try {
      user = storage.mutate('user:add', { name: 'Alice' }).result;
      project = storage.mutate('project:add', { userId: user, name: 'Website launch' }).result;
      otherUser = storage.mutate('user:add', { name: 'Bob' }).result;
      otherProject = storage.mutate('project:add', { userId: otherUser, name: 'Research' }).result;
      storage.mutate('selection:set', { userId: user, projectId: project });
    } finally { storage.close(); }
    const database = new DatabaseSync(path.join(directory, 'time-tracker.sqlite'));
    try {
      database.exec('PRAGMA foreign_keys = ON');
      const insert = database.prepare('INSERT INTO time_entries (id, project_id, clock_in, clock_out, notes) VALUES (?, ?, ?, ?, ?)');
      insert.run('a'.repeat(64), project, sunday - 3 * hour, sunday - 2 * hour, 'Previous week');
      insert.run('b'.repeat(64), project, sunday - hour, sunday + hour, 'Crosses Sunday midnight');
      insert.run('c'.repeat(64), project, sunday + 25 * hour, sunday + 27 * hour, 'Monday work');
      insert.run('d'.repeat(64), project, now - 300_000, null, 'Current session');
      insert.run('e'.repeat(64), otherProject, sunday + 30 * hour, sunday + 38 * hour, 'Different user and project');
    } finally { database.close(); }
    const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    const launchOptions = process.env.TIME_TRACKER_EXECUTABLE
      ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
      : { args: [path.resolve(__dirname, '..')], env };
    application = await electron.launch(launchOptions);
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now + 1000);
    await page.reload();
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
    await expect(page.locator('#project-total')).toHaveText('05:05:01');
    await expect(page.locator('#project-week-total')).toHaveText('03:05:01');
    await expect(page.locator('#project-week-range')).toContainText('2026');
    const runningClockIn = page.locator(`[data-entry-id="${'d'.repeat(64)}"] time[datetime]`);
    await expect(runningClockIn).toHaveAttribute('datetime', new Date(now - 300_000).toISOString());
    const stoppedEntry = page.locator(`[data-entry-id="${'c'.repeat(64)}"] time[datetime]`);
    await expect(stoppedEntry).toHaveCount(2);
    await expect(stoppedEntry.nth(0)).toHaveAttribute('datetime', new Date(sunday + 25 * hour).toISOString());
    await expect(stoppedEntry.nth(1)).toHaveAttribute('datetime', new Date(sunday + 27 * hour).toISOString());
    await expect(stoppedEntry.nth(0)).toContainText('2026');
    await expect(stoppedEntry.nth(1)).toContainText('2026');
    await page.clock.runFor(5000);
    await expect(page.locator('#project-total')).toHaveText('05:05:06');
    await expect(page.locator('#project-week-total')).toHaveText('03:05:06');
    await expect(page.locator('#timer-display')).toHaveText('00:05:06');
    await page.locator('[data-page="projects"]').click();
    await expect(page.locator('#projects-list [data-project-total]')).toContainText('05:05:06 total');
    await page.locator('[data-page="today"]').click();
    await page.locator('#user-select').selectOption(otherUser);
    await expect(page.locator('#project-total')).toHaveText('08:00:00');
    await expect(page.locator('#project-week-total')).toHaveText('08:00:00');
    await expect(page.locator('#timer-button')).toBeDisabled();
    await page.locator('#show-running').click();
    await expect(page.locator('#project-week-total')).toHaveText('03:05:06');
    await page.screenshot({ path: 'test-results/weekly-summary-light.png' });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/weekly-summary-dark.png' });
    await page.setViewportSize({ width: 900, height: 680 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#project-week-total')).fontSize) > parseFloat(getComputedStyle(document.querySelector('#project-total')).fontSize))).toBe(true);
    await page.screenshot({ path: 'test-results/weekly-summary-narrow.png' });
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
