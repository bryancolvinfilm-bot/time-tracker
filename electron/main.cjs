const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, protocol, screen, session } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { openStorage } = require('./storage.cjs');

const APP_URL = 'app://tracker/index.html';
let storage;
let mainWindow;
let miniMode = false;
let windowChanging = false;
let normalWindow;

function signalPortableReady() {
  const marker = process.env.TIME_TRACKER_PORTABLE_READY;
  if (!marker) return;
  const relative = path.relative(tmpdir(), path.resolve(marker));
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(marker) !== 'time-tracker-ready') return;
  try { writeFileSync(marker, 'ready'); } catch { /* Status feedback must not block startup. */ }
}

function windowState() {
  return { mini: miniMode, alwaysOnTop: mainWindow.isAlwaysOnTop() };
}

function updateTitleBar() {
  if (process.platform === 'darwin') return;
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow?.setTitleBarOverlay({ color: dark ? '#171b22' : '#f7f8fa', symbolColor: dark ? '#edf0f5' : '#536075', height: miniMode ? 28 : 44 });
}

function restoreWindowBounds(bounds) {
  mainWindow.setBounds(bounds);
  // Fractional Windows DPI scaling can round a restored size up by a pixel.
  // Compensate for small read-back differences so repeated toggles do not grow it.
  const actual = mainWindow.getBounds();
  const corrected = { ...bounds };
  let needsCorrection = false;
  for (const key of ['x', 'y', 'width', 'height']) {
    const difference = actual[key] - bounds[key];
    if (difference && Math.abs(difference) <= 4) {
      corrected[key] -= difference;
      needsCorrection = true;
    }
  }
  if (needsCorrection) mainWindow.setBounds(corrected);
}

async function setMiniMode(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid mini mode setting.');
  if (windowChanging) throw new Error('The window is changing modes. Please try again.');
  if (enabled === miniMode) return windowState();
  windowChanging = true;
  try {
    if (enabled) {
      normalWindow = { bounds: mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() };
      if (normalWindow.fullscreen) {
        await new Promise((resolve) => { mainWindow.once('leave-full-screen', resolve); mainWindow.setFullScreen(false); });
      }
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      mainWindow.setMinimumSize(0, 0);
      mainWindow.setMaximizable(false);
      mainWindow.setResizable(false);
      miniMode = true;
      updateTitleBar();
      mainWindow.setContentSize(640, 160);
      const bounds = mainWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      mainWindow.setPosition(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)));
    } else {
      mainWindow.setAlwaysOnTop(false);
      miniMode = false;
      updateTitleBar();
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);
      mainWindow.setMinimumSize(900, 680);
      restoreWindowBounds(normalWindow.bounds);
      if (normalWindow.maximized) mainWindow.maximize();
      if (normalWindow.fullscreen) mainWindow.setFullScreen(true);
    }
    return windowState();
  } finally { windowChanging = false; }
}

app.setName('Time Tracker');
// A separate directory keeps automated checks away from real user preferences.
if (process.env.TIME_TRACKER_TEST_DATA) app.setPath('userData', process.env.TIME_TRACKER_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// A second process must not show an out-of-date timer or edit the same workspace.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) { signalPortableReady(); app.quit(); }
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== APP_URL) {
    throw new Error('Untrusted application request.');
  }
}

function createWindow() {
  miniMode = false;
  normalWindow = null;
  mainWindow = new BrowserWindow({
    title: 'Time Tracker', width: 1240, height: 850, minWidth: 900, minHeight: 680,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171b22' : '#f7f8fa',
    show: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? '#171b22' : '#f7f8fa', symbolColor: nativeTheme.shouldUseDarkColors ? '#edf0f5' : '#536075', height: 44 },
    trafficLightPosition: { x: 18, y: 15 },
    icon: path.join(__dirname, '../src/assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); signalPortableReady(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(APP_URL);
}

if (hasLock) app.whenReady().then(() => {
  storage = openStorage(app.getPath('userData'));
  nativeTheme.themeSource = storage.getTheme();
  app.setAppUserModelId('app.timetracker.desktop');
  const assets = new Map([
    ['/index.html', ['index.html', 'text/html']],
    ['/styles.css', ['styles.css', 'text/css']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/time-utils.js', ['time-utils.js', 'text/javascript']],
    ['/assets/icon.svg', ['assets/icon.svg', 'image/svg+xml']],
  ]);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const asset = url.hostname === 'tracker' && assets.get(url.pathname);
    if (!asset || request.method !== 'GET') return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(path.join(__dirname, '../src', asset[0])), { headers: { 'Content-Type': asset[1], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
    } catch { return new Response('Unable to load asset', { status: 500 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle('app:info', (event) => {
    trusted(event);
    return { version: app.getVersion(), platform: process.platform, theme: storage.getTheme(), storage: { engine: 'SQLite', path: storage.file, ready: true } };
  });
  ipcMain.handle('workspace:get', (event) => {
    trusted(event);
    return storage.snapshot();
  });
  ipcMain.handle('window:state', (event) => { trusted(event); return windowState(); });
  ipcMain.handle('window:mini', (event, enabled) => { trusted(event); return setMiniMode(enabled); });
  ipcMain.handle('window:top', (event, enabled) => {
    trusted(event);
    if (typeof enabled !== 'boolean' || !miniMode) throw new Error('Always on top is available in mini mode only.');
    mainWindow.setAlwaysOnTop(enabled);
    return windowState();
  });
  ipcMain.handle('workspace:update', (event, operation, input) => {
    trusted(event);
    try { return { ok: true, workspace: storage.mutate(operation, input) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('settings:theme', (event, theme) => {
    trusted(event);
    if (!['light', 'dark'].includes(theme)) throw new Error('Invalid theme.');
    storage.setTheme(theme);
    nativeTheme.themeSource = theme;
    updateTitleBar();
    return theme;
  });
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('Time Tracker startup failed:', error);
  signalPortableReady();
  dialog.showErrorBox('Time Tracker could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => storage?.close());
