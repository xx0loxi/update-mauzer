// ============================================================
// MAUZER BROWSER — Main Process (v2.0 — 103 Features)
// ============================================================

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog, nativeImage, screen, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { autoUpdater } = require('electron-updater');
const { isGoogleLoginUrl, readJSON, writeJSON, normalizeVersion, compareVersions } = require('./src/main/utils');
const importer = require('./src/main/importer');

function loadEnvFile(p) {
  try {
    if (fs.existsSync(p)) {
      fs.readFileSync(p, 'utf-8').split('\n').forEach(line => {
        const l = line.trim();
        if (l && !l.startsWith('#') && l.includes('=')) {
          const [key, ...vals] = l.split('=');
          process.env[key.trim()] = vals.join('=').trim();
        }
      });
    }
  } catch (e) { }
}
try {
  const envFiles = [
    path.join(app.getPath('userData'), 'mauzer-data', '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
  ];
  envFiles.forEach(loadEnvFile);
} catch (e) { }

// --- Fingerprint Evasion ---
const CHROME_VERSION = '120.0.0.0'; // As requested: Chrome 120
const SPOOFED_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

// Strip Electron/Mauzer from the default user agent at the app level
// This is critical for Google login — Google checks the UA and blocks Electron apps
app.userAgentFallback = SPOOFED_UA;

// --- CRITICAL: Disable Automation Control ---
// This flag is the #1 reason Google blocks Electron logins.
// It tells websites that the browser is being controlled by automation (like Selenium).
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Other helpful flags for stealth
// WebAuthentication,WebAuth,WebAuthn - kills "Windows Security" popup
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,WebAuthentication,WebAuth,WebAuthn,NetworkService'); 
app.commandLine.appendSwitch('disable-site-isolation-trials');

// --- Globals ---
let mainWindow = null;
let windows = [];
const GITHUB_OWNER = 'xx0loxi';
const GITHUB_REPO = 'update-mauzer';

// --- Pulse Stats ---
let pulseStats = {
  adsBlocked: 0,
  trackersBlocked: 0,
  requestsTotal: 0,
  dataSavedKB: 0,
  sessionStart: Date.now()
};

// --- Data Storage ---
const DATA_DIR = () => path.join(app.getPath('userData'), 'mauzer-data');

function ensureDataDir() {
  const dir = DATA_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dataPath(file) {
  return path.join(ensureDataDir(), file);
}

function sendUpdateStatus(payload) {
  windows.forEach(w => {
    if (w && !w.isDestroyed()) {
      w.webContents.send('update-status', payload);
    }
  });
}

function fetchGithubReleases(useAuth = true) {
  return new Promise((resolve, reject) => {
    const meta = readJSON('update_meta.json', {});
    const etag = meta.etag || '';
    const lastModified = meta.lastModified || '';
    const token = useAuth ? (process.env.GITHUB_TOKEN || '') : '';
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mauzer',
        'Accept': 'application/vnd.github+json',
        ...(etag ? { 'If-None-Match': etag } : {}),
        ...(lastModified ? { 'If-Modified-Since': lastModified } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 304) {
          resolve({ status: 304, releases: [] });
          return;
        }
        let json = [];
        try {
          json = JSON.parse(data || '[]');
        } catch (e) { }

        if (res.statusCode === 401 && useAuth && token) {
          fetchGithubReleases(false).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode >= 400) {
          console.log('[UPDATE] GitHub API Error:', res.statusCode, json);
          resolve({ status: res.statusCode, releases: [] });
          return;
        }

        try {
          const releases = Array.isArray(json) ? json : [];
          const newMeta = {
            etag: res.headers?.etag || etag || '',
            lastModified: res.headers?.['last-modified'] || lastModified || '',
          };
          writeJSON('update_meta.json', newMeta);
          resolve({ status: res.statusCode || 200, releases });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let lastFallbackCheck = 0;
const fallbackMinIntervalMs = 5 * 60 * 1000;
async function checkGithubFallback(currentVersion) {
  const now = Date.now();
  if (now - lastFallbackCheck < fallbackMinIntervalMs) return;
  lastFallbackCheck = now;
  try {
    const r = await fetchGithubReleases();
    if (r && r.status === 304) return;
    const list = Array.isArray(r) ? r : (r?.releases || []);
    const latest = list.find(r => !r?.draft);
    if (!latest) return;
    const version = normalizeVersion(latest.tag_name || latest.name || '');
    if (!version) return;
    if (compareVersions(version, currentVersion) <= 0) return;
    const assets = Array.isArray(latest.assets) ? latest.assets : [];
    const exe = assets.find(a => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.exe')) || assets[0];
    const manualUrl = exe?.browser_download_url || latest.html_url || '';
    if (!manualUrl) return;
    sendUpdateStatus({ status: 'available', info: { version, manualUrl, manual: true } });
  } catch (e) { }
}

// ============================================================
// SETTINGS
// ============================================================
const DEFAULT_SETTINGS = {
  language: 'ru',
  theme: 'dark',
  accentColor: '#808080',
  searchEngine: 'google',
  homePage: 'mauzer://newtab',
  newtabBackground: 'default',
  newtabCustomBg: '',
  fontSize: 'medium',
  density: 'comfortable',
  sidebarPosition: 'left',
  showBookmarksBar: false,
  restoreSession: false,
  smoothScroll: true,
  forceDarkMode: false,
  httpsOnly: false,
  fingerprintProtection: true,
  doNotTrack: true,
  clearOnExit: false,
  trackingProtection: 'basic',
  popupBlocking: true,
  tabCountWarning: 50,
  lowRamMode: false,
  frostEnabled: true,
  frostTimeout: 30000,
  alwaysOnTop: false,
  lastIntroVersion: '',
};

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON('settings.json', {}) };
}

function saveSettings(data) {
  writeJSON('settings.json', data);
}

// ============================================================
// HISTORY
// ============================================================
function getHistory() {
  return readJSON('history.json', []);
}

function addHistoryEntry(entry) {
  const history = getHistory();
  history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url: entry.url,
    title: entry.title || entry.url,
    favicon: entry.favicon || '',
    timestamp: Date.now(),
  });
  // Keep last 5000 entries
  if (history.length > 5000) history.length = 5000;
  writeJSON('history.json', history);
}

function clearHistory() {
  writeJSON('history.json', []);
}

function removeHistoryEntry(id) {
  const history = getHistory();
  const filtered = history.filter(h => h.id !== id);
  writeJSON('history.json', filtered);
}

function searchHistory(query) {
  const history = getHistory();
  if (!query) return history.slice(0, 200);
  const q = query.toLowerCase();
  return history.filter(h =>
    h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)
  ).slice(0, 200);
}

// ============================================================
// DOWNLOADS
// ============================================================
let downloads = [];

function getDownloads() {
  return readJSON('downloads.json', []);
}

function addDownload(item) {
  const dl = getDownloads();
  dl.unshift(item);
  if (dl.length > 500) dl.length = 500;
  writeJSON('downloads.json', dl);
  return dl;
}

function clearDownloads() {
  writeJSON('downloads.json', []);
}

// ============================================================
// BOOKMARKS
// ============================================================
function getBookmarks() {
  return readJSON('bookmarks.json', []);
}

function addBookmark(bm) {
  const bookmarks = getBookmarks();
  // Check duplicate
  if (bookmarks.some(b => b.url === bm.url)) return bookmarks;
  bookmarks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url: bm.url,
    title: bm.title || bm.url,
    favicon: bm.favicon || '',
    folder: bm.folder || '',
    timestamp: Date.now(),
  });
  writeJSON('bookmarks.json', bookmarks);
  return bookmarks;
}

function removeBookmark(id) {
  let bookmarks = getBookmarks();
  bookmarks = bookmarks.filter(b => b.id !== id);
  writeJSON('bookmarks.json', bookmarks);
  return bookmarks;
}

// ============================================================
// SESSIONS
// ============================================================
function getSessions() {
  return readJSON('sessions.json', []);
}

function saveSession(name, tabs) {
  const sessions = getSessions();
  sessions.unshift({
    id: Date.now().toString(36),
    name,
    tabs,
    timestamp: Date.now(),
  });
  if (sessions.length > 20) sessions.length = 20;
  writeJSON('sessions.json', sessions);
  return sessions;
}

function deleteSession(id) {
  let sessions = getSessions();
  sessions = sessions.filter(s => s.id !== id);
  writeJSON('sessions.json', sessions);
  return sessions;
}

// ============================================================
// QUICK LINKS (newtab)
// ============================================================
function getQuickLinks() {
  const links = readJSON('quicklinks.json', [
    { url: 'https://www.google.com', title: 'Google' },
    { url: 'https://www.youtube.com', title: 'YouTube' },
    { url: 'https://reddit.com', title: 'Reddit' },
    { url: 'https://twitter.com', title: 'X (Twitter)' },
  ]);
  const blocked = new Set(['google.com', 'www.google.com', 'reddit.com', 'www.reddit.com', 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'github.com', 'www.github.com']);
  return links.filter(link => {
    try {
      return !blocked.has(new URL(link.url).hostname);
    } catch (e) {
      return true;
    }
  });
}

function saveQuickLinks(links) {
  writeJSON('quicklinks.json', links);
}

// ============================================================
// TOP SITES
// ============================================================
function getTopSites() {
  const history = getHistory();
  const counts = {};
  history.forEach(h => {
    try {
      const host = new URL(h.url).hostname;
      if (!counts[host]) counts[host] = { url: h.url, title: h.title, favicon: h.favicon, count: 0 };
      counts[host].count++;
    } catch (e) { }
  });
  return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8);
}

// ============================================================
// SITE PERMISSIONS
// ============================================================
function getSitePermissions() {
  return readJSON('permissions.json', {});
}

function setSitePermission(site, permission, value) {
  const perms = getSitePermissions();
  if (!perms[site]) perms[site] = {};
  perms[site][permission] = value;
  writeJSON('permissions.json', perms);
  return perms;
}

// ============================================================
// NOTES
// ============================================================
function getNotes() {
  return readJSON('notes.json', []);
}

function saveNote(note) {
  const notes = getNotes();
  const existing = notes.findIndex(n => n.id === note.id);
  if (existing >= 0) {
    notes[existing] = { ...notes[existing], ...note, updatedAt: Date.now() };
  } else {
    notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: note.text,
      site: note.site || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  writeJSON('notes.json', notes);
  return notes;
}

function deleteNote(id) {
  let notes = getNotes();
  notes = notes.filter(n => n.id !== id);
  writeJSON('notes.json', notes);
  return notes;
}

// ============================================================
// READING LIST
// ============================================================
function getReadingList() {
  return readJSON('readinglist.json', []);
}

function addToReadingList(item) {
  const list = getReadingList();
  if (list.some(l => l.url === item.url)) return list;
  list.unshift({
    id: Date.now().toString(36),
    url: item.url,
    title: item.title || item.url,
    favicon: item.favicon || '',
    timestamp: Date.now(),
  });
  writeJSON('readinglist.json', list);
  return list;
}

function removeFromReadingList(id) {
  let list = getReadingList();
  list = list.filter(l => l.id !== id);
  writeJSON('readinglist.json', list);
  return list;
}

// ============================================================
// CLIPBOARD HISTORY
// ============================================================
let clipboardHistory = [];

function addToClipboard(text) {
  if (!text || text.trim() === '') return;
  clipboardHistory = clipboardHistory.filter(c => c !== text);
  clipboardHistory.unshift(text);
  if (clipboardHistory.length > 10) clipboardHistory.length = 10;
}

// ============================================================
// FLAGS (experimental)
// ============================================================
function getFlags() {
  return readJSON('flags.json', {
    splitView: true,
    readerMode: true,
    focusMode: true,
    pipMode: true,
    colorPicker: true,
    forceSmooth: true,
    tabPreview: false,
    adaptiveTitlebar: true,
    breathingTab: true,
    videoDownload: true,
  });
}

function saveFlags(flags) {
  writeJSON('flags.json', flags);
}

// ============================================================
// USAGE STATS
// ============================================================
function getUsageStats() {
  return readJSON('usage.json', { sites: {}, totalTime: 0 });
}

function trackUsage(url, seconds) {
  try {
    const host = new URL(url).hostname;
    const stats = getUsageStats();
    if (!stats.sites[host]) stats.sites[host] = 0;
    stats.sites[host] += seconds;
    stats.totalTime += seconds;
    writeJSON('usage.json', stats);
  } catch (e) { }
}

// ============================================================
// AD & TRACKER BLOCKER
// ============================================================
const BLOCKED_DOMAINS = [
  // Google
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com', 'ads.google.com',
  // Facebook
  'connect.facebook.net', 'pixel.facebook.com', 'an.facebook.com', 'analytics.facebook.com',
  // Ad Networks
  'adnxs.com', 'adsrvr.org', 'adform.net', 'adcolony.com',
  'amazon-adsystem.com', 'media.net', 'outbrain.com', 'taboola.com',
  'criteo.com', 'criteo.net', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'casalemedia.com', 'indexww.com', 'bidswitch.net',
  'smartadserver.com', 'yieldmo.com', 'sharethrough.com', 'triplelift.com',
  'quantserve.com', 'scorecardresearch.com', 'bluekai.com',
  'exelator.com', 'demdex.net', 'krxd.net', 'liadm.com', 'tapad.com',
  'moatads.com', 'doubleverify.com', 'adsafeprotected.com',
  'serving-sys.com', 'sizmek.com', 'flashtalking.com',
  'popads.net', 'popcash.net', 'propellerads.com',
  'revcontent.com', 'mgid.com', 'addthis.com', 'sharethis.com',
  'ads.yahoo.com', 'advertising.com', 'ad.doubleclick.net',
  'adtech.de', 'adtech.com', 'adtechus.com',
  'teads.tv', 'zedo.com', 'gumgum.com', 'sovrn.com',
  // RU/CIS Ad Networks
  'an.yandex.ru', 'yandexadexchange.net', 'mc.yandex.ru', 'bs.yandex.ru',
  'ad.mail.ru', 'target.my.com', 'top-fwz1.mail.ru', 'counter.yadro.ru',
  'tns-counter.ru', 'rambler.ru', 'begun.ru', 'sape.ru',
  // Yandex Distribution / Hijackers
  'browser.yandex.ru', 'dl.browser.yandex.ru', 'downloader.yandex.ru',
  'distribution.yandex.ru', 'soft.yandex.ru', 'clck.yandex.ru',
  'yandex.ru/soft', 'redirect.appmetrica.yandex.com',
  // Analytics / Tracking
  'appmetrica.yandex.com', 'yandexmetrica.com',
  'amplitude.com', 'hotjar.com', 'fullstory.com', 'mouseflow.com',
  'luckyorange.com', 'clarity.ms', 'crazyegg.com', 'mixpanel.com',
  'segment.io', 'segment.com', 'heapanalytics.com', 'inspectlet.com',
  'newrelic.com', 'nr-data.net', 'sentry.io', 'bugsnag.com',
  // Social Widgets (often trackers)
  'platform.twitter.com', 'platform.linkedin.com', 'widgets.pinterest.com'
];

const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'connect.facebook.net',
  'pixel.facebook.com', 'mc.yandex.ru', 'quantserve.com',
  'scorecardresearch.com', 'bluekai.com', 'demdex.net', 'krxd.net',
  'hotjar.com', 'fullstory.com', 'clarity.ms', 'amplitude.com',
  'mouseflow.com', 'crazyegg.com', 'mixpanel.com', 'segment.io',
  'yandexmetrica.com', 'counter.yadro.ru'
];

function isBlockedDomain(hostname) {
  // Check exact match or subdomain
  return BLOCKED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

function isTrackerDomain(hostname) {
  return TRACKER_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

let pulseEnabled = true;

function setupAdBlocker() {
  // Block specific URL patterns regardless of domain
  const BLOCKED_URL_PATTERNS = [
    /yandex.*pack.*loader/i,
    /yandex.*browser.*setup/i,
    /YandexPackSetup/i,
    /yandex_pack/i,
    /\/soft\/download/i,
    /browser\.yandex.*\.exe/i,
    /google_ads/i,
    /doubleclick/i,
    /ad_status/i,
    /ads\?/i,
    /pagead/i,
    /\/ads\.js/i,
    /\/ad\.js/i
  ];

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (!pulseEnabled) {
      callback({});
      return;
    }

    try {
      const url = new URL(details.url);
      // Block by domain
      if (isBlockedDomain(url.hostname)) {
        pulseStats.adsBlocked++;
        pulseStats.dataSavedKB += 15;
        if (isTrackerDomain(url.hostname)) pulseStats.trackersBlocked++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pulse-stats-update', { ...pulseStats });
        }
        callback({ cancel: true });
        return;
      }
      // Block by URL pattern (Yandex pack loaders, etc.)
      const fullUrl = details.url;
      if (BLOCKED_URL_PATTERNS.some(p => p.test(fullUrl))) {
        pulseStats.adsBlocked++;
        console.log('[AdBlock] Blocked Yandex pack loader:', fullUrl);
        callback({ cancel: true });
        return;
      }
    } catch (e) { }
    pulseStats.requestsTotal++;
    callback({});
  });
}

// ============================================================
// ANTI-FINGERPRINT
// ============================================================
function getAntiDetectScript() {
  return `
    try {
      // 1. Hide WebDriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // 2. Mock Chrome Object (More detailed)
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect: function(){},
          sendMessage: function(){},
          id: undefined,
          getManifest: function() { return {}; },
          getURL: function(path) { return ''; },
          onMessage: { addListener: function(){}, removeListener: function(){} },
          onConnect: { addListener: function(){}, removeListener: function(){} }
        };
      }
      if (!window.chrome.app) {
        window.chrome.app = { 
          isInstalled: false, 
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, 
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } 
        };
      }
      // Add more fake chrome props
      if (!window.chrome.csi) window.chrome.csi = function() { return {}; };
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return {}; };

      // 3. Mock Permissions (Notification check often reveals Electron)
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // 4. Override User Agent Data (Client Hints)
      if (navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Chromium', version: '${CHROME_VERSION}'.split('.')[0] },
              { brand: 'Google Chrome', version: '${CHROME_VERSION}'.split('.')[0] },
              { brand: 'Not_A Brand', version: '24' }
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: function(hints) {
              return Promise.resolve({
                architecture: 'x86',
                bitness: '64',
                brands: this.brands,
                fullVersionList: [
                  { brand: 'Chromium', version: '${CHROME_VERSION}' },
                  { brand: 'Google Chrome', version: '${CHROME_VERSION}' },
                  { brand: 'Not_A Brand', version: '24.0.0.0' }
                ],
                mobile: false,
                model: '',
                platform: 'Windows',
                platformVersion: '10.0.0',
                uaFullVersion: '${CHROME_VERSION}'
              });
            }
          })
        });
      }

      // 5. Hide Electron Globals
      delete window.process;
      delete window.require;
      delete window.__electron_preload;
      delete window.Buffer;
      
      // 6. Mock Plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
          ];
          plugins.length = 5;
          return plugins;
        }
      });
      
      // 7. Mock Languages
      Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
      
    } catch(e) {}
  `;
}

// ============================================================
// GOOGLE LOGIN POPUP — Opens Google OAuth in a BrowserWindow
// instead of webview to bypass Google's embedded browser block
// ============================================================
function openGoogleLoginPopup(url, webviewContents) {
  const loginWin = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow,
    modal: true,
    show: true,
    title: 'Google Sign In',
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      // Use the same session so cookies are shared with webviews
      partition: undefined,
      // CRITICAL: Use dedicated preload script for early evasion
      preload: path.join(__dirname, 'src', 'main', 'preload-login.js')
    },
    icon: path.join(__dirname, 'icon_black.png'),
  });

  loginWin.setMenuBarVisibility(false);
  loginWin.webContents.setUserAgent(SPOOFED_UA);

  // --- CRITICAL: Spoof Headers for Login Window ---
  // Since it uses default session, the global onBeforeSendHeaders should apply,
  // BUT we must ensure the User-Agent is set correctly on load.
  loginWin.loadURL(url, { userAgent: SPOOFED_UA });

  // When Google login finishes, it will redirect to the original service
  // Detect when we leave accounts.google.com = login complete
  const handleNavigation = (e, navUrl) => {
    try {
      const u = new URL(navUrl);
      // If navigated away from Google login pages, login is complete
      // We only keep the popup open for accounts.google.com (auth flow)
      if (u.hostname !== 'accounts.google.com' && u.hostname !== 'accounts.youtube.com') {
        // Login complete — redirect webview to final URL and close popup
        if (webviewContents && !webviewContents.isDestroyed()) {
          webviewContents.loadURL(navUrl);
        }
        loginWin.close();
      }
    } catch (err) { /* ignore */ }
  };

  loginWin.webContents.on('will-redirect', handleNavigation);
  loginWin.webContents.on('did-navigate', (e, navUrl) => {
    try {
      const u = new URL(navUrl);
      // If we're back on a non-Google page, login is done
      if (u.hostname !== 'accounts.google.com' && u.hostname !== 'accounts.youtube.com') {
        if (webviewContents && !webviewContents.isDestroyed()) {
          webviewContents.loadURL(navUrl);
        }
        loginWin.close();
      }
    } catch (err) { /* ignore */ }
  });

  // If user closes popup manually, reload webview so it reflects any login state
  loginWin.on('closed', () => {
    if (webviewContents && !webviewContents.isDestroyed()) {
      webviewContents.reload();
    }
  });
}

function setupAntiFingerprint() {
  const antiDetectJS = getAntiDetectScript();
  const settings = loadSettings();

  mainWindow.webContents.on('did-attach-webview', (event, wc) => {
    wc.setUserAgent(SPOOFED_UA);

    // Intercept Google login navigations — open in popup BrowserWindow
    wc.on('will-navigate', (e, url) => {
      if (isGoogleLoginUrl(url)) {
        e.preventDefault();
        openGoogleLoginPopup(url, wc);
        return;
      }
    });

    // CRITICAL: Register preload for local file:// pages (settings, newtab)
    // so they can access window.mauzer API
    wc.on('will-navigate', (e, url) => {
      // Preload is already set from webview tag attributes for file:// URLs
    });

    wc.on('dom-ready', () => {
      const url = wc.getURL();

      // For local file:// pages, inject the mauzer API bridge
      if (url.startsWith('file://')) {
        // Inject a bridge that forwards IPC calls through the parent window
        wc.executeJavaScript(`
          if (!window.mauzer) {
            // Signal parent window to handle settings for us
            window.__isMauzerLocal = true;
          }
        `).catch(() => { });
      } else {
        // Only run anti-detect on external sites
        wc.executeJavaScript(antiDetectJS).catch(() => { });

        // Hide Yandex browser promo/pack banners
        if (url.includes('yandex.')) {
          wc.insertCSS(`
            .distr-tooltip, .softcheck, .soft-check,
            .distribution, .browser-install, .browser-download,
            .home-tabs__promo, .promo-header, .zen-promo,
            [class*="BrowserInstall"], [class*="SoftSuggest"],
            [class*="distr"], [class*="YandexSoft"],
            .popup2[data-name="distr"], .serp-header__bro,
            .bro-suggest, .bro-popup { display: none !important; }
          `).catch(() => { });
        }

        // YouTube Ad Blocker — auto-skip and speed-up ads
        if (url.includes('youtube.com')) {
          wc.insertCSS(`
            .ytp-ad-overlay-container,
            .ytp-ad-text-overlay,
            .ytp-ad-image-overlay,
            #player-ads,
            #masthead-ad,
            ytd-banner-promo-renderer,
            ytd-promoted-sparkles-web-renderer,
            ytd-display-ad-renderer,
            ytd-promoted-video-renderer,
            ytd-compact-promoted-video-renderer,
            ytd-action-companion-ad-renderer,
            .ytd-mealbar-promo-renderer,
            ytd-ad-slot-renderer,
            .ytp-ad-overlay-slot,
            #offer-module { display: none !important; }
          `).catch(() => { });

          wc.executeJavaScript(`
            (function() {
              if (window.__mauzerYTAdBlock) return;
              window.__mauzerYTAdBlock = true;
              
              const adBlocker = setInterval(() => {
                try {
                  const video = document.querySelector('video');
                  if (!video) return;
                  
                  // Detect if ad is playing
                  const adShowing = document.querySelector('.ad-showing, .ad-interrupting');
                  if (adShowing) {
                    // Try skip button first
                    const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern');
                    if (skipBtn) {
                      skipBtn.click();
                      return;
                    }
                    // Speed up non-skippable ads + mute
                    video.playbackRate = 16;
                    video.muted = true;
                    video.currentTime = video.duration || video.currentTime + 999;
                  } else {
                    // Restore normal playback
                    if (video.playbackRate === 16) {
                      video.playbackRate = 1;
                      video.muted = false;
                    }
                  }
                  
                  // Remove overlay ads
                  document.querySelectorAll('.ytp-ad-overlay-close-button').forEach(b => b.click());
                } catch(e) {}
              }, 500);
              
              // Cleanup on navigation
              window.addEventListener('beforeunload', () => clearInterval(adBlocker));
            })();
          `).catch(() => { });
        }
      }

      // Native dark mode signal
  nativeTheme.themeSource = settings.theme || 'dark';

  // Smooth scroll injection
  if (settings.smoothScroll) {
    wc.insertCSS(`html { scroll-behavior: smooth !important; }`).catch(() => { });
  }
});
});

  // Headers: Cunning User-Agent spoofing via headers
  // Google sometimes ignores setUserAgent if set as a simple string.
  // We intercept requests and replace the header "on the fly".
  const filter = {
    urls: ['https://accounts.google.com/*', 'https://*.google.com/*', 'https://*.youtube.com/*', '*://*/*']
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    
    // Remove all Electron-specific headers
    Object.keys(headers).forEach(k => {
      if (k.toLowerCase().startsWith('x-electron') || k.toLowerCase() === 'sec-ch-ua-full-version') {
        delete headers[k];
      }
    });
    
    // Force Chrome User-Agent
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    // Set other Chrome-like headers for consistency
    headers['sec-ch-ua'] = `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    
    if (settings.doNotTrack) headers['DNT'] = '1';
    
    callback({ cancel: false, requestHeaders: headers });
  });
}

// ============================================================
// DOWNLOADS HANDLER
// ============================================================
function setupDownloads() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const downloadPath = path.join(app.getPath('downloads'), fileName);

    item.setSavePath(downloadPath);

    const dlItem = {
      id: Date.now().toString(36),
      filename: fileName,
      url: item.getURL(),
      path: downloadPath,
      totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      timestamp: Date.now(),
    };

    item.on('updated', (event, state) => {
      dlItem.receivedBytes = item.getReceivedBytes();
      dlItem.state = state;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', { ...dlItem });
      }
    });

    item.once('done', (event, state) => {
      dlItem.state = state;
      dlItem.receivedBytes = dlItem.totalBytes;
      addDownload(dlItem);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-complete', { ...dlItem });
        mainWindow.webContents.send('toast', {
          message: `Загружено: ${fileName}`,
          type: 'success'
        });
      }
    });
  });
}

// ============================================================
// WINDOW CREATION
// ============================================================
function createWindow(isIncognito = false) {
  const settings = loadSettings();

  session.defaultSession.setUserAgent(SPOOFED_UA);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    thickFrame: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegrationInSubFrames: false,
      sandbox: false,
      webSecurity: true,
    },
    show: false,
    icon: path.join(__dirname, 'icon_black.png'),
    alwaysOnTop: settings.alwaysOnTop,
  });

  // Hidden menu with accelerators - this is the ONLY reliable way to handle
  // keyboard shortcuts in Electron when webview has focus
  const send = (data) => { if (win && !win.isDestroyed()) win.webContents.send('shortcut-triggered', data); };
  const sc = (accel, data) => ({ label: accel, accelerator: accel, click: () => send(data), visible: false });
  const menu = Menu.buildFromTemplate([{
    label: 'Shortcuts', submenu: [
      sc('CmdOrCtrl+T', { key: 't', ctrl: true, shift: false }),
      sc('CmdOrCtrl+W', { key: 'w', ctrl: true, shift: false }),
      sc('CmdOrCtrl+N', { key: 'n', ctrl: true, shift: false }),
      sc('CmdOrCtrl+Shift+N', { key: 'N', ctrl: true, shift: true }),
      sc('CmdOrCtrl+Shift+T', { key: 'T', ctrl: true, shift: true }),
      sc('CmdOrCtrl+K', { key: 'k', ctrl: true, shift: false }),
      sc('CmdOrCtrl+F', { key: 'f', ctrl: true, shift: false }),
      sc('CmdOrCtrl+H', { key: 'h', ctrl: true, shift: false }),
      sc('CmdOrCtrl+J', { key: 'j', ctrl: true, shift: false }),
      sc('CmdOrCtrl+L', { key: 'l', ctrl: true, shift: false }),
      sc('CmdOrCtrl+P', { key: 'p', ctrl: true, shift: false }),
      sc('CmdOrCtrl+R', { key: 'r', ctrl: true, shift: false }),
      sc('CmdOrCtrl+=', { key: '=', ctrl: true, shift: false }),
      sc('CmdOrCtrl+-', { key: '-', ctrl: true, shift: false }),
      sc('CmdOrCtrl+0', { key: '0', ctrl: true, shift: false }),
      sc('CmdOrCtrl+1', { key: '1', ctrl: true, shift: false }),
      sc('CmdOrCtrl+2', { key: '2', ctrl: true, shift: false }),
      sc('CmdOrCtrl+3', { key: '3', ctrl: true, shift: false }),
      sc('CmdOrCtrl+4', { key: '4', ctrl: true, shift: false }),
      sc('CmdOrCtrl+5', { key: '5', ctrl: true, shift: false }),
      sc('CmdOrCtrl+6', { key: '6', ctrl: true, shift: false }),
      sc('CmdOrCtrl+7', { key: '7', ctrl: true, shift: false }),
      sc('CmdOrCtrl+8', { key: '8', ctrl: true, shift: false }),
      sc('CmdOrCtrl+9', { key: '9', ctrl: true, shift: false }),
      sc('F5', { key: 'F5', ctrl: false, shift: false }),
      sc('F11', { key: 'F11', ctrl: false, shift: false }),
      sc('F12', { key: 'F12', ctrl: false, shift: false }),
    ]
  }]);
  Menu.setApplicationMenu(menu);

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (isIncognito) {
      win.webContents.send('set-incognito', true);
    }
  });

  win.on('maximize', () => {
    win.webContents.send('window-state-changed', { maximized: true });
  });
  win.on('unmaximize', () => {
    win.webContents.send('window-state-changed', { maximized: false });
  });

  win.on('enter-full-screen', () => {
    win.webContents.send('fullscreen-changed', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send('fullscreen-changed', false);
  });

  win.on('closed', () => {
    windows = windows.filter(w => w !== win);
    if (win === mainWindow) mainWindow = null;
  });

  windows.push(win);

  if (!mainWindow) {
    mainWindow = win;
    setupAdBlocker();
    setupAntiFingerprint();
    setupDownloads();
    setupWebViewPermissions();
  }

  return win;
}

// ============================================================
// WEBVIEW PERMISSIONS
// ============================================================
function setupWebViewPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-write', 'fullscreen', 'pointerLock', 'media', 'mediaKeySystem', 'audio', 'microphone'];
    callback(allowedPermissions.includes(permission));
  });

  // Also handle permission checks (not just requests)
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedChecks = ['media', 'mediaKeySystem', 'audio', 'microphone', 'clipboard-read', 'clipboard-write'];
    return allowedChecks.includes(permission);
  });

  mainWindow.webContents.on('did-attach-webview', (event, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      // Intercept Google login popups (e.g. "Sign in with Google" buttons)
      if (isGoogleLoginUrl(url)) {
        openGoogleLoginPopup(url, wc);
        return { action: 'deny' };
      }
      mainWindow.webContents.send('open-url-in-new-tab', url);
      return { action: 'deny' };
    });

    // Right-click context menu
    wc.on('context-menu', (e, params) => {
      const menuItems = [];

      // Navigation
      if (wc.canGoBack()) menuItems.push({ label: 'Назад', click: () => wc.goBack() });
      if (wc.canGoForward()) menuItems.push({ label: 'Вперёд', click: () => wc.goForward() });
      menuItems.push({ label: 'Перезагрузить', click: () => wc.reload() });
      menuItems.push({ type: 'separator' });

      // Text editing
      if (params.isEditable) {
        menuItems.push({ label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut });
        menuItems.push({ label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste });
      }
      if (params.selectionText) {
        menuItems.push({ label: 'Копировать', role: 'copy' });
      }
      menuItems.push({ label: 'Выделить всё', role: 'selectAll' });
      menuItems.push({ type: 'separator' });

      // Link
      if (params.linkURL) {
        menuItems.push({
          label: 'Открыть ссылку в новой вкладке',
          click: () => mainWindow.webContents.send('open-url-in-new-tab', params.linkURL)
        });
        menuItems.push({
          label: 'Копировать адрес ссылки',
          click: () => require('electron').clipboard.writeText(params.linkURL)
        });
        menuItems.push({ type: 'separator' });
      }

      // Image
      if (params.hasImageContents) {
        menuItems.push({
          label: 'Копировать изображение',
          click: () => wc.copyImageAt(params.x, params.y)
        });
        menuItems.push({
          label: 'Копировать адрес изображения',
          click: () => require('electron').clipboard.writeText(params.srcURL)
        });
        menuItems.push({
          label: 'Сохранить изображение как...',
          click: () => {
            mainWindow.webContents.downloadURL(params.srcURL);
          }
        });
        menuItems.push({ type: 'separator' });
      }

      // Dev tools
      menuItems.push({
        label: 'Просмотреть код',
        click: () => {
          // Open DevTools docked to the right side of the window
          wc.openDevTools({ mode: 'right' });
        }
      });

      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup({ window: mainWindow });
    });
  });
}

// ============================================================
// IPC HANDLERS
// ============================================================

// --- Window ---
ipcMain.handle('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.handle('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w?.isMaximized()) w.unmaximize(); else w?.maximize();
});
ipcMain.handle('window:close', (e) => {
  const settings = loadSettings();
  if (settings.clearOnExit) {
    session.defaultSession.clearStorageData();
    clearHistory();
  }
  BrowserWindow.fromWebContents(e.sender)?.close();
});
ipcMain.handle('window:isMaximized', (e) => {
  return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
});
ipcMain.handle('window:fullscreen', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  w?.setFullScreen(!w.isFullScreen());
});
ipcMain.handle('window:alwaysOnTop', (e, val) => {
  BrowserWindow.fromWebContents(e.sender)?.setAlwaysOnTop(val);
});
ipcMain.handle('window:new', () => {
  createWindow();
});
ipcMain.handle('window:newIncognito', () => {
  createWindow(true);
});

// --- Settings ---
async function applyThemeToWeb(settings) {
  nativeTheme.themeSource = settings.theme || 'dark';

  const ses = session.defaultSession;
  try {
    if (settings.theme === 'dark') {
      await ses.cookies.set({ url: 'https://www.youtube.com', name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/' });
      await ses.cookies.set({ url: 'https://www.google.com', name: 'PREF', value: 'f6=400', domain: '.google.com', path: '/' });
    } else {
      // Remove dark mode cookies for light theme
      await ses.cookies.remove('https://www.youtube.com', 'PREF');
      await ses.cookies.remove('https://www.google.com', 'PREF');
    }
  } catch (e) { }
}

ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_, data) => {
  saveSettings(data);
  applyThemeToWeb(data);
  // Notify ALL windows that settings changed so they can reload
  windows.forEach(w => {
    if (w && !w.isDestroyed()) {
      w.webContents.send('settings-changed', data);
    }
  });
  return true;
});
ipcMain.handle('settings:getDefault', () => DEFAULT_SETTINGS);
ipcMain.handle('app:getPreloadPath', () => path.join(__dirname, 'preload.js'));

// --- History ---
ipcMain.handle('history:get', (_, query) => query ? searchHistory(query) : getHistory().slice(0, 200));
ipcMain.handle('history:add', (_, entry) => { addHistoryEntry(entry); return true; });
ipcMain.handle('history:clear', () => { clearHistory(); return true; });
ipcMain.handle('history:remove', (_, id) => { removeHistoryEntry(id); return true; });
ipcMain.handle('history:search', (_, query) => searchHistory(query));// --- Downloads ---
ipcMain.handle('downloads:get', () => getDownloads());
ipcMain.handle('downloads:clear', () => { clearDownloads(); return true; });

// --- Pulse ---
ipcMain.handle('pulse:toggle', (_, enabled) => {
  pulseEnabled = !!enabled;
  return pulseEnabled;
});
ipcMain.handle('pulse:get-state', () => pulseEnabled);

// --- Search ---
ipcMain.handle('search:suggest', async (_, query) => {
  if (!query) return [];
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json[1] || [];
  } catch (e) {
    console.error('Search suggest error:', e);
    return [];
  }
});

// --- Downloads Actions ---
ipcMain.handle('downloads:open', (_, filepath) => { shell.openPath(filepath); });
ipcMain.handle('downloads:showInFolder', (_, filepath) => { shell.showItemInFolder(filepath); });
ipcMain.handle('downloads:openFolder', () => { shell.openPath(app.getPath('downloads')); });

// --- Bookmarks ---
ipcMain.handle('bookmarks:get', () => getBookmarks());
ipcMain.handle('bookmarks:add', (_, bm) => addBookmark(bm));
ipcMain.handle('bookmarks:remove', (_, id) => removeBookmark(id));

// --- Sessions ---
ipcMain.handle('sessions:get', () => getSessions());
ipcMain.handle('sessions:save', (_, name, tabs) => saveSession(name, tabs));
ipcMain.handle('sessions:delete', (_, id) => deleteSession(id));

function saveCurrentSession(tabs) {
  writeJSON('current-session.json', tabs);
}

function loadCurrentSession() {
  return readJSON('current-session.json', []);
}

ipcMain.handle('sessions:saveCurrent', (_, tabs) => { saveCurrentSession(tabs); return true; });
ipcMain.handle('sessions:loadCurrent', () => loadCurrentSession());

// --- Quick Links ---
ipcMain.handle('quicklinks:get', () => getQuickLinks());
ipcMain.handle('quicklinks:save', (_, links) => { saveQuickLinks(links); return true; });

// --- Top Sites ---
ipcMain.handle('topsites:get', () => getTopSites());

// --- Notes ---
ipcMain.handle('notes:get', () => getNotes());
ipcMain.handle('notes:save', (_, note) => saveNote(note));
ipcMain.handle('notes:delete', (_, id) => deleteNote(id));

// --- Reading List ---
ipcMain.handle('readinglist:get', () => getReadingList());
ipcMain.handle('readinglist:add', (_, item) => addToReadingList(item));
ipcMain.handle('readinglist:remove', (_, id) => removeFromReadingList(id));

// --- Clipboard ---
ipcMain.handle('clipboard:get', () => clipboardHistory);
ipcMain.handle('clipboard:add', (_, text) => { addToClipboard(text); return clipboardHistory; });

// --- Permissions ---
ipcMain.handle('permissions:get', () => getSitePermissions());
ipcMain.handle('permissions:set', (_, site, perm, val) => setSitePermission(site, perm, val));

// --- Flags ---
ipcMain.handle('flags:get', () => getFlags());
ipcMain.handle('flags:save', (_, flags) => { saveFlags(flags); return true; });

// --- Usage Stats ---
ipcMain.handle('usage:get', () => getUsageStats());
ipcMain.handle('usage:track', (_, url, seconds) => { trackUsage(url, seconds); return true; });

ipcMain.handle('update:restart', () => {
  autoUpdater.quitAndInstall();
  return true;
});
ipcMain.handle('update:download', () => {
  return autoUpdater.downloadUpdate();
});

// --- Pulse ---
ipcMain.handle('pulse:getStats', () => ({ ...pulseStats }));
ipcMain.handle('pulse:resetStats', () => {
  pulseStats = { adsBlocked: 0, trackersBlocked: 0, requestsTotal: 0, dataSavedKB: 0, sessionStart: Date.now() };
  return true;
});

// --- Config (legacy compat) ---
ipcMain.handle('config:load', () => loadSettings());
ipcMain.handle('config:save', (_, data) => { saveSettings(data); return true; });

// --- System ---
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
ipcMain.handle('app:getPath', (_, name) => app.getPath(name));
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion() || '2.0.0',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

// --- Print ---
ipcMain.handle('page:print', (e) => {
  // We send a message to renderer to trigger print on the active webview
  e.sender.send('trigger-print');
});

// --- Screenshot ---
ipcMain.handle('page:screenshot', async (e) => {
  try {
    const w = BrowserWindow.fromWebContents(e.sender);
    const image = await w.webContents.capturePage();
    const savePath = path.join(app.getPath('pictures'), `mauzer-screenshot-${Date.now()}.png`);
    fs.writeFileSync(savePath, image.toPNG());
    return { success: true, path: savePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- Clear data ---
ipcMain.handle('data:clearAll', async () => {
  await session.defaultSession.clearStorageData();
  clearHistory();
  clearDownloads();
  return true;
});
ipcMain.handle('data:clearCache', async () => {
  await session.defaultSession.clearCache();
  return true;
});
ipcMain.handle('data:clearCookies', async () => {
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });
  return true;
});

// ============================================================
// BROWSER DATA IMPORT
// ============================================================
const IMPORT_MARKER = path.join(app.getPath('userData'), '.mauzer-imported');

function isFirstRun() {
  return !fs.existsSync(IMPORT_MARKER);
}

function getBrowserPaths() {
  const localAppData = process.env.LOCALAPPDATA || '';
  return {
    chrome: {
      base: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default'),
      bookmarks: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'),
      history: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
    },
    yandex: {
      base: path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data', 'Default'),
      bookmarks: path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data', 'Default', 'Bookmarks'),
      history: path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data', 'Default', 'History'),
    }
  };
}

// Detect installed browsers
ipcMain.handle('import:detect', async () => {
  return importer.detectBrowsers();
});

// Import bookmarks
ipcMain.handle('import:bookmarks', async (_, browser) => {
  const result = await importer.importBookmarks(browser);
  if (result.count > 0) {
    const bookmarks = getBookmarks();
    const newItems = result.items.filter(n => !bookmarks.some(e => e.url === n.url));
    if (newItems.length > 0) {
      newItems.forEach(i => {
        bookmarks.push({ ...i, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
      });
      writeJSON('bookmarks.json', bookmarks);
    }
    return { count: newItems.length };
  }
  return { count: 0 };
});

// Import history
ipcMain.handle('import:history', async (_, browser) => {
  const result = await importer.importHistory(browser);
  if (result.count > 0) {
    const history = getHistory();
    // Simple merge: add new items that don't exist by URL+Timestamp
    const existingKeys = new Set(history.map(h => h.url + h.timestamp));
    const toAdd = [];
    
    result.items.forEach(item => {
      const key = item.url + item.timestamp;
      if (!existingKeys.has(key)) {
        toAdd.push({
          ...item,
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          favicon: '' // Can't easily import favicons yet
        });
      }
    });
    
    const merged = [...toAdd, ...history].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5000);
    writeJSON('history.json', merged);
    return { count: toAdd.length };
  }
  return { count: 0 };
});

// Import passwords (NEW)
ipcMain.handle('import:passwords', async (_, browser) => {
  const result = await importer.importPasswords(browser);
  // We don't have a password manager yet in this codebase version, 
  // so we'll save them to a secure file 'logins.json' for now.
  // In a real app, this should be encrypted with a master password.
  if (result.count > 0) {
    const logins = readJSON('logins.json', []);
    const newItems = result.items.filter(n => !logins.some(e => e.url === n.url && e.username === n.username));
    
    if (newItems.length > 0) {
      newItems.forEach(i => logins.push(i));
      writeJSON('logins.json', logins);
    }
    return { count: newItems.length };
  }
  return { count: 0 };
});

// Mark import as done
ipcMain.handle('import:done', async () => {
  fs.writeFileSync(IMPORT_MARKER, new Date().toISOString());
  return true;
});

// Close import window
ipcMain.on('import:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close();
});

ipcMain.on('import:minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.minimize();
});

function createImportWindow() {
  return new Promise((resolve) => {
    const importWin = new BrowserWindow({
      width: 600,
      height: 480,
      frame: false,
      resizable: false,
      backgroundColor: '#0a0a0a',
      center: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      icon: path.join(__dirname, 'icon_black.png'),
    });

    importWin.loadFile(path.join(__dirname, 'src', 'import.html'));
    importWin.once('ready-to-show', () => importWin.show());
    importWin.on('closed', () => resolve());
  });
}

function setupAutoUpdate() {
  // Work in both packaged and dev.
  // autoUpdater will throw in dev — we catch and fall back to GitHub API.
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = true;
  let checking = false;
  let lastCheck = 0;
  const minIntervalMs = 5 * 60 * 1000;
  const runCheck = () => {
    const now = Date.now();
    if (checking) return;
    if (now - lastCheck < minIntervalMs) return;
    checking = true;
    lastCheck = now;
    const currentVersion = app.getVersion();
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((err) => {
        const message = err?.message || String(err);
        const lower = message.toLowerCase();
        if (lower.includes('not packed') || lower.includes('packaged') || lower.includes('no published') || lower.includes('404') || lower.includes('cannot find')) {
          // In dev or no provider metadata — silently use fallback.
          sendUpdateStatus({ status: 'not-available' });
          checkGithubFallback(currentVersion);
          return;
        }
        sendUpdateStatus({ status: 'error', message });
        checkGithubFallback(currentVersion);
      })
      .finally(() => {
        checking = false;
      });
    // Also trigger fallback in parallel so UI appears quickly even if updater lags
    checkGithubFallback(currentVersion);
  };
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ status: 'available', info }));
  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({ status: 'not-available', info });
    checkGithubFallback(app.getVersion());
  });
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({
    status: 'downloading',
    percent: Math.round(progress.percent || 0),
    transferred: progress.transferred,
    total: progress.total
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ status: 'downloaded', info }));
  autoUpdater.on('error', (err) => sendUpdateStatus({ status: 'error', message: err?.message || String(err) }));
  runCheck();
  setInterval(runCheck, minIntervalMs);
  app.on('browser-window-focus', runCheck);
}

// ============================================================
app.name = 'Mauzer';
app.setAppUserModelId('com.mauzer.browser');

app.whenReady().then(async () => {
  // 1. Устанавливаем User-Agent как у обычного Chrome (Global fix)
  session.defaultSession.setUserAgent(SPOOFED_UA);

  // Apply theme settings
  await applyThemeToWeb(loadSettings());

  createWindow();
  setupAutoUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Security
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (contents.getType() !== 'webview') {
      if (!navigationUrl.startsWith('file://')) {
        event.preventDefault();
      }
    }
  });
});
