const { app, BrowserWindow, ipcMain, session, dialog, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let headers = { ua: null, ref: null };

const customFile = () => path.join(app.getPath('userData'), 'custom.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = { key: '', region: '', lang: 'en-US', usageMonth: '', usageSec: 0 };

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    let key = '';
    if (s.keyEnc) {
      try { key = safeStorage.decryptString(Buffer.from(s.keyEnc, 'base64')); } catch (e) { key = ''; }
    } else if (s.keyPlain) {
      key = s.keyPlain;
    }
    return {
      key: key,
      region: s.region || '',
      lang: s.lang || 'en-US',
      usageMonth: s.usageMonth || '',
      usageSec: Number(s.usageSec) || 0
    };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(st) {
  const out = {
    region: st.region || '',
    lang: st.lang || 'en-US',
    usageMonth: st.usageMonth || '',
    usageSec: Number(st.usageSec) || 0
  };
  if (st.key) {
    if (safeStorage.isEncryptionAvailable()) out.keyEnc = safeStorage.encryptString(st.key).toString('base64');
    else out.keyPlain = st.key;
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out), 'utf8');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 780,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'IPTV Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  // apply the per-channel User-Agent / Referer to every outgoing media request
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    if (/^https?:/i.test(details.url)) {
      if (headers.ua) h['User-Agent'] = headers.ua;
      if (headers.ref) {
        h['Referer'] = headers.ref;
        try { h['Origin'] = new URL(headers.ref).origin; } catch (e) { /* ignore */ }
      }
    }
    callback({ requestHeaders: h });
  });

  ipcMain.handle('load-builtin', () => {
    try { return fs.readFileSync(path.join(__dirname, 'iptv.m3u'), 'utf8'); } catch (e) { return ''; }
  });

  ipcMain.handle('load-custom', () => {
    try { return JSON.parse(fs.readFileSync(customFile(), 'utf8')); } catch (e) { return []; }
  });

  ipcMain.handle('save-custom', (_evt, list) => {
    try {
      fs.mkdirSync(path.dirname(customFile()), { recursive: true });
      fs.writeFileSync(customFile(), JSON.stringify(list), 'utf8');
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-settings', () => readSettings());

  ipcMain.handle('save-settings', (_evt, st) => {
    try { writeSettings(st || {}); return true; } catch (e) { return false; }
  });

  ipcMain.handle('set-headers', (_evt, ua, ref) => {
    headers = { ua: ua || null, ref: ref || null };
    return true;
  });

  ipcMain.handle('fetch-playlist', async (_evt, url) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await net.fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      return { ok: true, text: await res.text() };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('open-playlist-file', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Playlist', extensions: ['m3u', 'm3u8', 'txt'] }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    try { return { ok: true, text: fs.readFileSync(r.filePaths[0], 'utf8') }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
