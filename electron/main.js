// webPod desktop shell (Electron). Serves the web app from a private app:// origin
// (so IndexedDB, fetch() and storage behave like a normal website) and adds a few
// desktop niceties: single instance, remembered window size, media keys, menu.
const { app, BrowserWindow, Menu, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { rewriteHtml } = require('./rewrite');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const ORIGIN = 'app://webpod';
const START_URL = ORIGIN + '/webpod.html';
const ALLOWED = /^(index\.html|webpod\.html|other\/|tools\/|assets\/|vendor\/)/;

protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// Let music start without a click, and enable hardware media keys (play/pause/next/prev)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.setAppUserModelId('com.webpod.player');

let win = null;

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
}

// ---- remember window position/size ------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
    try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveWindowState() {
    if (!win || win.isDestroyed()) return;
    try {
        const b = win.getNormalBounds();
        fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch (e) { /* ignore */ }
}

// ---- app:// protocol -----------------------------------------------------------
function registerAppProtocol() {
    protocol.handle('app', async (request) => {
        try {
            const url = new URL(request.url);
            let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (!rel || rel.endsWith('/')) rel += 'index.html';
            const full = path.normalize(path.join(ROOT, rel));
            if (!full.startsWith(ROOT + path.sep) || !ALLOWED.test(path.relative(ROOT, full).split(path.sep).join('/'))) {
                return new Response('Forbidden', { status: 403 });
            }
            if (full.toLowerCase().endsWith('.html')) {
                const html = rewriteHtml(await fs.promises.readFile(full, 'utf8'), VENDOR, ORIGIN);
                return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
            }
            return await net.fetch(pathToFileURL(full).toString());
        } catch (e) {
            return new Response('Not found', { status: 404 });
        }
    });
}

// ---- window ---------------------------------------------------------------------
function createWindow() {
    const saved = loadWindowState();
    const iconPath = path.join(ROOT, 'build', 'icon.ico');
    win = new BrowserWindow({
        width: saved.width || 1280,
        height: saved.height || 820,
        x: saved.x, y: saved.y,
        minWidth: 900, minHeight: 640,
        backgroundColor: '#020617',
        title: 'webPod',
        autoHideMenuBar: true,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    });
    if (saved.maximized) win.maximize();
    win.loadURL(START_URL);

    // external links open in the normal browser, never inside the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(ORIGIN + '/')) {
            e.preventDefault();
            if (/^https?:/i.test(url)) shell.openExternal(url);
        }
    });

    win.on('close', saveWindowState);
    win.on('closed', () => { win = null; });
}

function buildMenu() {
    const go = (p) => () => win && win.loadURL(ORIGIN + p);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'webPod', submenu: [
            { label: 'Player', click: go('/webpod.html') },
            { label: 'Home', click: go('/index.html') },
            { type: 'separator' },
            { label: 'Caption Studio', click: go('/tools/captions.html') },
            { label: 'SyncMaster', click: go('/tools/captionsync.html') },
            { label: 'Backup Manager', click: go('/tools/manager.html') },
            { type: 'separator' },
            { role: 'quit' }
        ] },
        { label: 'View', submenu: [
            { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' },
            { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
            { role: 'toggleDevTools' }
        ] }
    ]));
}

app.whenReady().then(() => {
    registerAppProtocol();
    // the app needs no special permissions (camera, location, ...)
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
