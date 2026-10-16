const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, protocol, session } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { openStorage } = require('./storage.cjs');

const APP_URL = 'app://tracker/index.html';
let storage;
let mainWindow;

app.setName('Time Tracker');
// A separate directory keeps automated checks away from real user preferences.
if (process.env.TIME_TRACKER_TEST_DATA) app.setPath('userData', process.env.TIME_TRACKER_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// A second process must not show an out-of-date timer or edit the same workspace.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
    if (process.platform !== 'darwin') mainWindow?.setTitleBarOverlay({ color: theme === 'dark' ? '#171b22' : '#f7f8fa', symbolColor: theme === 'dark' ? '#edf0f5' : '#536075' });
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
  dialog.showErrorBox('Time Tracker could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => storage?.close());
