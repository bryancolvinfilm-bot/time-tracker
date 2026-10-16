const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(action, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error('Portable launch check timed out.', { cause: lastError });
}

(async () => {
  if (process.platform !== 'win32') throw new Error('Portable launcher verification runs on Windows.');
  const { version } = require('../package.json');
  const executable = process.env.TIME_TRACKER_PORTABLE_EXECUTABLE || path.resolve(__dirname, `../release/Time Tracker ${version}.exe`);
  const directory = await mkdtemp(path.join(tmpdir(), 'tracker-portable-'));
  const log = path.join(directory, 'startup.log');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, TIME_TRACKER_TEST_DATA: directory, TIME_TRACKER_STARTUP_TEST_LOG: log };
  delete env.ELECTRON_RUN_AS_NODE;
  let child;
  let browser;
  try {
    child = spawn(executable, [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
    const exit = new Promise((resolve, reject) => { child.once('exit', (code) => resolve(code)); child.once('error', reject); });
    console.log('Testing the real portable EXE; waiting for its native unpacking window...');
    const firstLog = await waitUntil(async () => {
      const text = await readFile(log, 'utf8');
      return text.includes('unpacking') && text;
    });
    assert.match(firstLog, /unpacking visible=1 marquee=8/);
    console.log('Verified: native startup window is visible and marquee animation is enabled.');
    await waitUntil(async () => (await readFile(log, 'utf8')).includes('ready hidden'));
    assert.match(await readFile(log, 'utf8'), /ready hidden visible=0/);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await waitUntil(async () => browser.contexts()[0]?.pages().find(page => page.url().startsWith('app://tracker/')));
    await page.locator('#storage-status').filter({ hasText: 'SQLite connected' }).waitFor();
    const workspace = await page.evaluate(() => window.timeTracker.getWorkspace());
    assert.equal(workspace.users.length, 0);
    const info = await page.evaluate(() => window.timeTracker.getAppInfo());
    assert.equal(info.storage.path, path.join(directory, 'time-tracker.sqlite'));
    assert.equal(info.version, version);
    console.log('Verified: status window hides when the app is ready, with isolated SQLite storage.');
    await page.evaluate(() => window.close());
    const exitCode = await Promise.race([exit, delay(10_000).then(() => { throw new Error('Portable launcher did not exit after app close.'); })]);
    assert.equal(exitCode, 0);
    assert.match(await readFile(log, 'utf8'), /finished/);
    console.log('Verified: portable launcher exits cleanly after the app closes.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) {
      await new Promise(resolve => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).once('exit', resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
