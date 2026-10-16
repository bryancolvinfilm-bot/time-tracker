const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { openStorage } = require('../electron/storage.cjs');

test('mini widget resizes the native window, shares timers and notes, pins only in mini, and restores normal mode', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-mini-'));
  let application;
  let page;
  const errors = [];
  const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.TIME_TRACKER_EXECUTABLE
    ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env };
  const state = () => page.evaluate(() => window.timeTracker.getWorkspace());
  function expectMiniSize(size) {
    // Windows DPI/frame rounding can add a couple of device-independent pixels.
    expect(Math.abs(size[0] - 640)).toBeLessThanOrEqual(4);
    expect(Math.abs(size[1] - 160)).toBeLessThanOrEqual(4);
  }
  const nativeWindow = () => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { bounds: window.getBounds(), content: window.getContentSize(), top: window.isAlwaysOnTop(), resizable: window.isResizable(), maximized: window.isMaximized() };
  });
  async function launch() {
    application = await electron.launch(launchOptions);
    page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
  }
  try {
    const storage = openStorage(directory);
    let user, project, bob, research, firstSession;
    try {
      user = storage.mutate('user:add', { name: 'Alice' }).result;
      project = storage.mutate('project:add', { userId: user, name: 'Website launch' }).result;
      bob = storage.mutate('user:add', { name: 'Bob' }).result;
      research = storage.mutate('project:add', { userId: bob, name: 'Research' }).result;
      firstSession = storage.mutate('timer:start', { userId: user, projectId: project, notes: 'Original\nsecond line' }).result;
    } finally { storage.close(); }
    await launch();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 1100, height: 760 }));
    const original = await nativeWindow();
    await page.locator('#timer-notes').fill('Unsaved draft\nwith two lines');
    await page.getByRole('button', { name: 'Mini mode', exact: true }).click();
    await expect(page.locator('#mini-widget')).toBeVisible();
    await expect(page.locator('.app-layout')).not.toBeVisible();
    expectMiniSize((await nativeWindow()).content);
    expect((await nativeWindow()).resizable).toBe(false);
    await expect(page.locator('#mini-user-select')).toHaveValue(user);
    await expect(page.locator('#mini-project-select')).toHaveValue(project);
    await expect(page.locator('#mini-user-select')).toBeDisabled();
    await expect(page.locator('#mini-notes')).toHaveValue('Unsaved draft\nwith two lines');
    await expect(page.locator('#mini-notes')).toHaveAttribute('maxlength', '255');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    expect(await page.locator('#mini-widget').evaluate(widget => [...widget.querySelectorAll('button,select,textarea,input')].every(control => {
      const box = control.getBoundingClientRect();
      return box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    }))).toBe(true);
    await page.locator('#mini-always-on-top').check();
    expect((await nativeWindow()).top).toBe(true);
    await page.locator('#mini-always-on-top').uncheck();
    expect((await nativeWindow()).top).toBe(false);
    await page.locator('#mini-save-notes').click();
    await expect(page.locator('#mini-notes-status')).toHaveText('Notes saved');
    expect((await state()).entries.find(entry => entry.id === firstSession).notes).toBe('Unsaved draft\nwith two lines');
    await page.screenshot({ path: 'test-results/mini-light.png' });
    await page.locator('#mini-notes').fill('Draft carried back to full mode');
    await page.locator('#mini-always-on-top').check();
    await page.getByRole('button', { name: 'Exit mini', exact: false }).click();
    await expect(page.locator('#mini-widget')).not.toBeVisible();
    const restored = await nativeWindow();
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(restored.bounds[key] - original.bounds[key])).toBeLessThanOrEqual(2);
    expect(restored.resizable).toBe(true);
    expect(restored.top).toBe(false);
    await expect(page.locator('#timer-notes')).toHaveValue('Draft carried back to full mode');
    for (let repeat = 0; repeat < 4; repeat++) {
      await page.locator('#enter-mini').click();
      await page.locator('#exit-mini').click();
    }
    const afterRepeatedSwitches = await nativeWindow();
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(afterRepeatedSwitches.bounds[key] - original.bounds[key])).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.locator('#enter-mini').click();
    await expect(page.locator('#mini-always-on-top')).not.toBeChecked();
    await page.screenshot({ path: 'test-results/mini-dark.png' });
    await page.locator('#mini-timer-button').click();
    await expect(page.locator('#mini-timer-button')).toHaveText('Start');
    let snapshot = await state();
    expect(snapshot.entries.find(entry => entry.id === firstSession).clock_out).not.toBeNull();
    expect(snapshot.entries.find(entry => entry.id === firstSession).notes).toBe('Draft carried back to full mode');
    await expect(page.locator('#mini-project-select')).toBeEnabled();
    await page.locator('#mini-user-select').selectOption(bob);
    await expect(page.locator('#mini-project-select')).toHaveValue(research);
    await page.locator('#mini-notes').fill('A new session from the widget');
    await page.locator('#mini-timer-button').click();
    await expect(page.locator('#mini-timer-button')).toHaveText('Stop');
    snapshot = await state();
    const second = snapshot.entries.find(entry => entry.clock_out === null);
    expect(second.id).not.toBe(firstSession);
    expect(second.project_id).toBe(research);
    expect(second.notes).toBe('A new session from the widget');
    const elapsed = await page.locator('#mini-timer-display').textContent();
    await expect(page.locator('#mini-timer-display')).not.toHaveText(elapsed, { timeout: 4000 });
    expect(await page.evaluate(() => document.querySelector('#mini-week-total').textContent === document.querySelector('#project-week-total').textContent)).toBe(true);
    await page.locator('#exit-mini').click();
    await page.locator('#user-select').selectOption(user);
    await page.locator('#enter-mini').click();
    await expect(page.locator('#mini-user-select')).toHaveValue(bob);
    await expect(page.locator('#mini-project-select')).toHaveValue(research);
    await page.locator('#exit-mini').click();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await expect.poll(async () => (await nativeWindow()).maximized).toBe(true);
    await page.locator('#enter-mini').click();
    await expect(page.locator('#mini-widget')).toBeVisible();
    expectMiniSize((await nativeWindow()).content);
    await page.locator('#exit-mini').click();
    await expect.poll(async () => (await nativeWindow()).maximized).toBe(true);
    const invalidRejected = await page.evaluate(async () => {
      try { await window.timeTracker.setMiniMode('yes'); return false; } catch { return true; }
    });
    expect(invalidRejected).toBe(true);
    expect(await page.evaluate(async () => {
      try { await window.timeTracker.setAlwaysOnTop(true); return false; } catch { return true; }
    })).toBe(true);
    await page.locator('#enter-mini').click();
    await page.locator('#mini-always-on-top').check();
    await application.close();
    application = null;
    await launch();
    await expect(page.locator('#mini-widget')).not.toBeVisible();
    expect((await nativeWindow()).top).toBe(false);
    expect((await state()).entries.find(entry => entry.clock_out === null).id).toBe(second.id);
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
