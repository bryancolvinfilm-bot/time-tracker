const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, readFile, rm, access } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('portable readiness is signaled after showing the app and ignores invalid marker names', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-startup-'));
  let application;
  const marker = path.join(directory, 'time-tracker-ready');
  const invalidMarker = path.join(directory, 'do-not-write');
  async function launch(readyFile) {
    const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory, TIME_TRACKER_PORTABLE_READY: readyFile };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await electron.launch(process.env.TIME_TRACKER_EXECUTABLE
      ? { executablePath: process.env.TIME_TRACKER_EXECUTABLE, args: [], env }
      : { args: [path.resolve(__dirname, '..')], env });
    const page = await application.firstWindow();
    await expect(page.locator('#storage-status')).toContainText('SQLite connected');
  }
  try {
    await launch(marker);
    await expect.poll(async () => { try { return await readFile(marker, 'utf8'); } catch { return ''; } }).toBe('ready');
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await application.close();
    application = null;
    await launch(invalidMarker);
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(access(invalidMarker)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
