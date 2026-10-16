const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
};

test('users, projects, recoverable timers, notes, entry controls, totals, and cascading deletion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-workflow-'));
  const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.TIME_TRACKER_EXECUTABLE
    ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env };
  let application;
  let page;
  const errors = [];
  async function launch() {
    application = await electron.launch(launchOptions);
    page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
  }
  const state = () => page.evaluate(() => window.timeTracker.getWorkspace());
  const nav = (section) => page.locator(`[data-page="${section}"]`).click();
  async function addUser(name) {
    await nav('users');
    await page.locator('#user-name').fill(name);
    await page.getByRole('button', { name: 'Add user', exact: true }).click();
    await expect(page.locator('#users-list h2').filter({ hasText: name })).toBeVisible();
    await page.locator('#users-list .manager-row').filter({ hasText: name }).getByRole('button', { name: 'View projects' }).click();
    return (await state()).users.find((user) => user.name === name).id;
  }
  async function addProject(name) {
    await page.locator('#project-name').fill(name);
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    await expect(page.locator('#projects-list h2').filter({ hasText: name })).toBeVisible();
    await page.locator('#projects-list .manager-row').filter({ hasText: name }).getByRole('button', { name: 'Track time' }).click();
    return (await state()).projects.find((project) => project.name === name).id;
  }
  async function start(notes = '') {
    await page.locator('#timer-notes').fill(notes);
    await page.getByRole('button', { name: 'Start timer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop timer', exact: true })).toBeVisible();
  }
  async function stop() {
    await page.getByRole('button', { name: 'Stop timer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  }
  async function confirm(name) {
    await expect(page.locator('#action-dialog')).toBeVisible();
    await page.locator('#action-dialog').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#action-dialog')).not.toBeVisible();
  }
  try {
    await launch();
    const alice = await addUser('Alice');
    const project = await addProject('Client website');
    await start('Initial planning');
    let snapshot = await state();
    const session = snapshot.entries[0];
    expect(session.id).toMatch(/^[a-f0-9]{64}$/);
    expect(session.clock_out).toBeNull();
    await expect(page.locator('#project-total')).toHaveText('00:00:00');

    // Simulate time spent with the app closed, without waiting an hour in the test.
    await application.close();
    application = null;
    const database = new DatabaseSync(path.join(directory, 'time-tracker.sqlite'));
    const startTime = Date.now() - 3_723_000;
    database.prepare('UPDATE time_entries SET clock_in = ? WHERE id = ?').run(startTime, session.id);
    database.close();
    await launch();
    await expect(page.locator('#timer-display')).toHaveText(/^01:02:\d{2}$/);
    await expect(page.locator('#timer-notes')).toHaveValue('Initial planning');
    await expect(page.locator('#running-banner')).toContainText('Alice / Client website');
    snapshot = await state();
    expect(snapshot.entries[0].id).toBe(session.id);
    expect(snapshot.entries[0].clock_in).toBe(startTime);
    await page.locator('#timer-notes').fill('Planning and implementation');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.locator('#notes-status')).toHaveText('Notes saved');
    await stop();
    snapshot = await state();
    const expectedTotal = snapshot.entries[0].clock_out - startTime;
    await expect(page.locator('#project-total')).toHaveText(formatDuration(expectedTotal));
    await expect(page.locator('.entry-notes')).toHaveText('Planning and implementation');
    await page.screenshot({ path: 'test-results/tracking-completed.png', fullPage: true });

    await nav('projects');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.locator('#dialog-value').fill('Website launch');
    await confirm('Save');
    await expect(page.locator('#projects-list h2')).toHaveText('Website launch');
    await page.locator('#projects-list').getByRole('button', { name: 'Track time', exact: true }).click();
    await page.getByRole('button', { name: 'Edit notes', exact: true }).click();
    await page.locator('#dialog-value').fill('x'.repeat(255));
    await confirm('Save');
    await expect(page.locator('.entry-notes')).toHaveText('x'.repeat(255));
    await page.getByRole('button', { name: 'Remove clock-out', exact: true }).click();
    await confirm('Remove clock-out');
    await expect(page.getByRole('button', { name: 'Stop timer', exact: true })).toBeVisible();
    await expect(page.locator('#project-total')).toHaveText('00:00:00');
    snapshot = await state();
    expect(snapshot.entries[0].id).toBe(session.id);
    expect(snapshot.entries[0].clock_in).toBe(startTime);
    expect(snapshot.entries[0].notes).toHaveLength(255);
    await page.setViewportSize({ width: 900, height: 680 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/tracking-narrow.png', fullPage: true });
    await page.setViewportSize({ width: 1240, height: 850 });
    await stop();
    await page.getByRole('button', { name: 'Delete entry', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.entry-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Delete entry', exact: true }).click();
    await confirm('Delete entry');
    await expect(page.locator('.entry-row')).toHaveCount(0);
    await expect(page.locator('#project-total')).toHaveText('00:00:00');

    const bob = await addUser('Bob');
    const bobProject = await addProject('Research');
    await start('Reading');
    await page.locator('#user-select').selectOption(alice);
    await expect(page.locator('#project-select')).toHaveValue(project);
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeDisabled();
    const rejected = await page.evaluate(({ userId, projectId }) => window.timeTracker.updateWorkspace('timer:start', { userId, projectId, notes: '' }), { userId: alice, projectId: project });
    expect(rejected.ok).toBe(false);
    await page.getByRole('button', { name: 'Go to timer' }).click();
    await expect(page.locator('#user-select')).toHaveValue(bob);
    await expect(page.locator('#project-select')).toHaveValue(bobProject);
    await page.screenshot({ path: 'test-results/tracking-running.png', fullPage: true });
    await nav('users');
    await page.locator('#users-list .manager-row').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await confirm('Delete user');
    snapshot = await state();
    expect(snapshot.users.map((user) => user.id)).toEqual([alice]);
    expect(snapshot.projects.map((item) => item.id)).toEqual([project]);
    expect(snapshot.entries).toHaveLength(0);
    await expect(page.locator('#running-banner')).not.toBeVisible();

    await nav('today');
    await start('First pair');
    await stop();
    await start('Running entry to delete with project');
    await nav('projects');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await confirm('Delete project');
    snapshot = await state();
    expect(snapshot.projects).toHaveLength(0);
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.users).toHaveLength(1);
    await expect(page.locator('#running-banner')).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
