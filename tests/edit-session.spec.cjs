const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const { openStorage } = require('../electron/storage.cjs');

async function fixture(clockIn, clockOut) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-edit-'));
  const storage = openStorage(directory);
  let user, source, target, foreign;
  try {
    user = storage.mutate('user:add', { name: 'Alice' }).result;
    source = storage.mutate('project:add', { userId: user, name: 'Original project' }).result;
    target = storage.mutate('project:add', { userId: user, name: 'Correct project' }).result;
    const otherUser = storage.mutate('user:add', { name: 'Bob' }).result;
    foreign = storage.mutate('project:add', { userId: otherUser, name: 'Correct project' }).result;
    storage.mutate('selection:set', { userId: user, projectId: source });
  } finally { storage.close(); }
  const id = 'a'.repeat(64);
  const database = new DatabaseSync(path.join(directory, 'time-tracker.sqlite'));
  try {
    database.prepare('INSERT INTO time_entries VALUES (?, ?, ?, ?, ?)').run(id, source, clockIn, clockOut, 'Preserve my notes');
  } finally { database.close(); }
  const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.TIME_TRACKER_EXECUTABLE
    ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env };
  return { directory, launchOptions, user, source, target, foreign, id };
}

test('stopped sessions edit times and duration, move within their owner, and persist without disturbing a running timer', async () => {
  const sunday = new Date(2026, 9, 11).getTime();
  const clockIn = sunday - 1_800_000 + 123;
  const clockOut = sunday + 1_800_000 + 456;
  const f = await fixture(clockIn, clockOut);
  let application;
  let page;
  const errors = [];
  const state = () => page.evaluate(() => window.timeTracker.getWorkspace());
  const row = () => page.locator(`[data-entry-id="${f.id}"]`);
  async function launch() {
    application = await electron.launch(f.launchOptions);
    page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date(2026, 9, 14, 12) });
    await page.clock.pauseAt(new Date(2026, 9, 14, 12, 0, 1));
    await page.reload();
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
  }
  const edit = () => row().getByRole('button', { name: 'Edit session', exact: true }).click();
  async function save() {
    await page.locator('#session-save').click();
    await expect(page.locator('#session-dialog')).not.toBeVisible();
  }
  try {
    await launch();
    const before = await state();
    await edit();
    const choices = await page.locator('#session-project option').evaluateAll(options => options.map(option => option.value));
    expect(choices.filter(Boolean).sort()).toEqual([f.source, f.target].sort());
    expect(choices).not.toContain(f.foreign);
    await expect(page.locator('#session-clock-in')).toHaveValue(/\.123$/);
    await expect(page.locator('#session-clock-out')).toHaveValue(/\.456$/);
    await expect(page.locator('#session-duration')).toHaveValue('01:00:00.333');
    await save();
    expect((await state()).entries).toEqual(before.entries);

    await edit();
    await page.locator('#session-duration').fill('00:45:00');
    await expect(page.locator('#session-clock-out')).toHaveValue(/T00:15:00\.123$/);
    await save();
    expect((await state()).entries[0].clock_out).toBe(clockIn + 2_700_000);
    await expect(page.locator('#project-total')).toHaveText('00:45:00');
    await expect(page.locator('#project-week-total')).toHaveText('00:15:00');

    await edit();
    await page.locator('#session-clock-in').fill('2026-10-10T23:00:00.123');
    await page.locator('#session-clock-out').fill('2026-10-11T02:00:00.456');
    await expect(page.locator('#session-duration')).toHaveValue('03:00:00.333');
    await save();
    await expect(page.locator('#project-total')).toHaveText('03:00:00');
    await expect(page.locator('#project-week-total')).toHaveText('02:00:00');
    const edited = (await state()).entries[0];
    expect(edited.id).toBe(f.id);
    expect(edited.notes).toBe('Preserve my notes');

    await edit();
    await page.locator('#session-clock-out').fill('2026-10-10T22:00');
    await page.locator('#session-save').click();
    await expect(page.locator('#session-error')).toContainText('at or after clock-in');
    expect((await state()).entries[0]).toEqual(edited);
    await page.locator('#session-duration').fill('01:60:00');
    await page.locator('#session-save').click();
    await expect(page.locator('#session-error')).toContainText('hours:minutes:seconds');
    await page.locator('#session-cancel').click();
    expect((await state()).entries[0]).toEqual(edited);

    await edit();
    await page.screenshot({ path: 'test-results/edit-session-light.png' });
    await page.locator('#session-cancel').click();
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.setViewportSize({ width: 900, height: 680 });
    await edit();
    await page.screenshot({ path: 'test-results/edit-session-dark-narrow.png' });
    expect(await page.locator('#session-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.locator('#session-project').selectOption(f.target);
    await save();
    await expect(row()).toHaveCount(0);
    await expect(page.locator('#project-total')).toHaveText('00:00:00');
    await expect(page.locator('#project-week-total')).toHaveText('00:00:00');
    await page.locator('#project-select').selectOption(f.target);
    await expect(row()).toBeVisible();
    await expect(page.locator('#project-total')).toHaveText('03:00:00');
    await expect(page.locator('#project-week-total')).toHaveText('02:00:00');
    expect((await state()).entries[0]).toEqual({ ...edited, project_id: f.target });

    await page.locator('#timer-notes').fill('Unrelated running session');
    await page.locator('#timer-button').click();
    await expect(page.locator('#timer-button')).toHaveText('Stop timer');
    const running = (await state()).entries.find(entry => entry.clock_out === null);
    await expect(page.locator(`[data-entry-id="${running.id}"]`).getByRole('button', { name: 'Edit session', exact: true })).toHaveCount(0);
    const rejected = await page.evaluate(input => window.timeTracker.updateWorkspace('entry:update', input), {
      id: running.id, projectId: f.target, clockIn: running.clock_in, durationMs: 1000,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('Stop this timer');
    await edit();
    await page.locator('#session-duration').fill('26:30:15');
    await save();
    const final = await state();
    expect(final.entries.find(entry => entry.id === running.id)).toEqual(running);
    expect(final.entries.find(entry => entry.id === f.id).clock_out).toBe(edited.clock_in + 95_415_000);

    await application.close();
    application = null;
    await launch();
    expect((await state()).entries).toEqual(final.entries);
    await expect(page.locator('#timer-button')).toHaveText('Stop timer');
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('session editing preserves repeated DST timestamps and uses elapsed duration across clock changes', async () => {
  const clockIn = Date.parse('2026-11-01T01:15:00.123-08:00');
  const clockOut = Date.parse('2026-11-01T01:45:00.456-08:00');
  const f = await fixture(clockIn, clockOut);
  let application;
  try {
    application = await electron.launch(f.launchOptions);
    const page = await application.firstWindow();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
    await page.reload();
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
    const state = () => page.evaluate(() => window.timeTracker.getWorkspace());
    const edit = () => page.getByRole('button', { name: 'Edit session', exact: true }).click();
    async function save() {
      await page.locator('#session-save').click();
      await expect(page.locator('#session-dialog')).not.toBeVisible();
    }
    await edit();
    await page.locator('#session-project').selectOption(f.target);
    await save();
    expect((await state()).entries[0]).toMatchObject({ clock_in: clockIn, clock_out: clockOut });
    await page.locator('#project-select').selectOption(f.target);
    await edit();
    await page.locator('#session-clock-in').fill('2026-11-01T00:30');
    await page.locator('#session-duration').fill('02:15:00');
    await expect(page.locator('#session-clock-out')).toHaveValue('2026-11-01T01:45');
    await page.locator('#session-clock-in').fill('2026-11-01T00:45');
    await expect(page.locator('#session-duration')).toHaveValue('02:00:00');
    await save();
    expect((await state()).entries[0].clock_out).toBe(Date.parse('2026-11-01T01:45:00-08:00'));
    const before = await state();
    await edit();
    await page.locator('#session-clock-in').fill('2026-03-08T02:30');
    await page.locator('#session-save').click();
    await expect(page.locator('#session-error')).toContainText('valid local clock-in');
    expect((await state()).entries).toEqual(before.entries);
    await page.locator('#session-clock-in').fill('2026-03-08T01:30');
    await page.locator('#session-clock-out').fill('2026-03-08T03:30');
    await expect(page.locator('#session-duration')).toHaveValue('01:00:00');
    await save();
    expect((await state()).entries[0].clock_out - (await state()).entries[0].clock_in).toBe(3_600_000);
  } finally {
    if (application) await application.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
