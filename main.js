// ============================================================
// MAUZER BROWSER — Main Process (v2.0 — 103 Features)
// ============================================================

// --- Security Hardening: Environment Sanitization ---
// Disarm attack vectors targeting Electron runtime execution (CVE-2023-39956, ASAR tampering)
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ASAR;
if (process.env.NODE_OPTIONS) {
  delete process.env.NODE_OPTIONS;
}

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog, nativeImage, screen, nativeTheme, net, safeStorage, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const { isGoogleLoginUrl, readJSON, writeJSON, flushPendingWrites, normalizeVersion, compareVersions } = require('./src/main/utils');
const importer = require('./src/main/importer');
const historyDb = require('./src/main/history-db');
const BloomFilter = require('./src/main/bloom-filter');

// --- Windows 7 & Old PC Compatibility & Optimization ---
const isWin7 = os.release().startsWith('6.1');
const isLowEnd = process.env.SIMULATE_LOW_END === '1' || os.totalmem() < 4.5 * 1024 * 1024 * 1024 || os.cpus().length <= 2; // < 4.5GB RAM or <= 2 cores

// ОПТИМИЗАЦИЯ: Более агрессивные лимиты на основе реальных ресурсов
const cpuCores = os.cpus().length;
const ramGB = os.totalmem() / (1024 ** 3);

let processLimit = 8;
if (ramGB < 2.5) processLimit = 1;        // < 2.5GB RAM
else if (ramGB < 4) processLimit = 2;     // 2.5-4GB RAM
else if (cpuCores <= 2) processLimit = 3; // Dual-core
else if (isLowEnd) processLimit = 4;      // 4-4.5GB RAM

console.log(`[Mauzer] System: ${ramGB.toFixed(1)}GB RAM, ${cpuCores} cores → renderer limit: ${processLimit}`);

// Global Heavy-Tab Optimizations (Applies to ALL PCs)
// 1. Process sharing: Groups same sites into single processes
app.commandLine.appendSwitch('enable-features', 'ProcessPerSite,IntensiveWakeUpThrottling');
// 2. Limit renderer processes based on system power (bounds RAM usage efficiently)
app.commandLine.appendSwitch('renderer-process-limit', processLimit.toString());
// 3. Security hardening: disable dangerous / vulnerable hardware & internal APIs in Chromium 108
// (disable-features may be appended only ONCE — Chromium keeps the LAST value, so merged here)
app.commandLine.appendSwitch('disable-features', 'TranslateUI,BlinkGenPropertyTrees,WebAuthentication,WebAuth,WebAuthn,WebUSB,WebBluetooth,WebHID,WebSerial,WebMIDI,WebMIDISysex,FileSystemAccessAPI,DirectSockets');
// 4. Privacy & telemetry mitigations
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('ssl-version-min', 'tls1.2');

if (isWin7 || isLowEnd) {
  // Old PCs often lack proper GPU drivers or RAM.
  if (isWin7) {
      app.disableHardwareAcceleration();
      app.commandLine.appendSwitch('disable-gpu');
      app.commandLine.appendSwitch('disable-gpu-compositing');
  }
  app.commandLine.appendSwitch('enable-low-end-device-mode');
  app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=512');
  console.log('[Mauzer] Windows 7 or Low-End PC detected. Extra optimization limits applied.');
} else {
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
}

// Hidden benchmark/test runs (MAUZER_HIDDEN_TEST=1 or --security-selftest):
// the window never shows, but renderers must run unthrottled so measurements
// taken invisibly are comparable to a visible run
const HIDDEN_RUN = process.env.MAUZER_HIDDEN_TEST === '1' || process.argv.includes('--security-selftest');
if (HIDDEN_RUN) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

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
const CHROME_VERSION = '108.0.0.0'; // Updated to match Electron 22 (Win 7 compatible)
const SPOOFED_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

// Strip Electron/Mauzer from the default user agent at the app level
// This is critical for Google login — Google checks the UA and blocks Electron apps
app.userAgentFallback = SPOOFED_UA;

// --- CRITICAL: Disable Automation Control & Sandbox Escape Vectors ---
// AutomationControlled blocks Google logins. MojoJS/MojoJSTest are internal Chromium IPC bridges
// frequently abused in Chromium 108 for renderer-to-browser sandbox escape.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled,MojoJS,MojoJSTest');
// Other helpful flags for stealth
// WebAuthentication,WebAuth,WebAuthn - kills "Windows Security" popup
// (merged into the single disable-features switch above — a duplicate
// appendSwitch call silently overwrites the earlier list)
// REMOVED: NetworkService (deprecated/dangerous), OutOfBlinkCors (might break layout/resources)
// app.commandLine.appendSwitch('disable-site-isolation-trials'); // Removed as it can cause rendering issues

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

let pulseUpdateTimer = null;
// ОПТИМИЗАЦИЯ: Отправляем только активному окну вместо всех
function broadcastPulseStats(immediate = false) {
  const activeWindow = BrowserWindow.getFocusedWindow();
  if (!activeWindow || activeWindow.isDestroyed()) return;
  
  if (immediate) {
    if (pulseUpdateTimer) { clearTimeout(pulseUpdateTimer); pulseUpdateTimer = null; }
    activeWindow.webContents.send('pulse-stats-update', { ...pulseStats });
    return;
  }
  if (!pulseUpdateTimer) {
    pulseUpdateTimer = setTimeout(() => {
      pulseUpdateTimer = null;
      if (!activeWindow.isDestroyed()) {
        activeWindow.webContents.send('pulse-stats-update', { ...pulseStats });
      }
    }, 1000); // Увеличили до 1 сек — меньше нагрузка на IPC
  }
}

// При переключении окна — отправляем свежую статистику
app.on('browser-window-focus', (event, window) => {
  if (window && !window.isDestroyed()) {
    window.webContents.send('pulse-stats-update', { ...pulseStats });
  }
});

// RAM optimization: trim V8 heap and compact memory on minimize / idle
function trimMemory() {
  try {
    if (global.gc) global.gc();
  } catch (e) { }
}

// --- Filter sources (large, external) ---
const FILTER_SOURCES = [
  // 1) Base
  'https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/BaseFilter/sections/adservers.txt',
  'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_block.txt',
  // 2) RU
  'https://raw.githubusercontent.com/easylist/ruadlist/master/ruadlist/ruadlist_general.txt',
  // 3) Privacy
  'https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy/easyprivacy_trackers.txt',
  'https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/SpywareFilter/sections/tracking_servers.txt',
  // 4) Anti-malware / mining
  'https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/nocoin.txt',
  'https://raw.githubusercontent.com/Spam404/lists/master/main-blacklist.txt'
];

// Whitelist (trusted domains skip blocking). Extendable via future settings/file.
const WHITELIST = new Set([
  'youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'youtube-nocookie.com',
  'google.com',
  'google.ru',
  'gstatic.com',
  'googleapis.com',
  'duckduckgo.com',
  'twitch.tv',
  'jtvnw.net',
  'ttvnw.net',
  'github.com',
  'githubusercontent.com'
]);

let dynamicBlockedDomains = new Set();
let bloomFilter = null; // ОПТИМИЗАЦИЯ: Bloom filter для быстрой предварительной проверки
const blockCache = new Map(); // ОПТИМИЗАЦИЯ: LRU кэш для частых доменов
const CACHE_SIZE = 500;

function parseHostsList(raw) {
  const set = new Set();
  if (!raw) return set;
  raw.split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if (!l || l.startsWith('!') || l.startsWith('#')) return;
    // uBlock/ABP style: ||domain^ or plain domain
    const cleaned = l
      .replace(/^\|\|/, '')
      .replace(/^@@.*/, '')
      .replace(/\^.*$/, '')
      .replace(/^\d+\.\d+\.\d+\.\d+$/, '') // skip IPs
      .trim();
    if (!cleaned) return;
    // Strip path fragments
    const domain = cleaned.split(/[\/:]/)[0];
    if (domain && /[a-zA-Z0-9.-]/.test(domain) && domain.includes('.')) {
      set.add(domain.toLowerCase());
    }
  });
  return set;
}

// ОПТИМИЗАЦИЯ: Асинхронная загрузка с Bloom Filter
async function loadLocalFilters() {
  try {
    const filtersPath = path.join(__dirname, 'src', 'main', 'adblock-filters.json');
    if (fs.existsSync(filtersPath)) {
      // Асинхронное чтение вместо синхронного
      const data = await fs.promises.readFile(filtersPath, 'utf8');
      const list = JSON.parse(data);
      
      // Создаем Bloom Filter для быстрой проверки
      const bloom = new BloomFilter(list.length * 10, 4);
      list.forEach(domain => bloom.add(domain));
      
      dynamicBlockedDomains = new Set(list);
      bloomFilter = bloom;
      
      console.log('[Pulse] Pre-built filters loaded, unique domains:', dynamicBlockedDomains.size);
      console.log('[Pulse] Bloom filter initialized:', bloom.size, 'bits');
    } else {
      console.log('[Pulse] No pre-built filters found at', filtersPath);
      dynamicBlockedDomains = new Set();
    }
  } catch (e) {
    console.error('[Pulse] Failed to load local filters:', e);
    dynamicBlockedDomains = new Set();
  }
}

// Parse the 5+ MB filter list after the window is already coming up — a sync
// JSON.parse of this size stalls the main process for a noticeable slice of
// the startup. The first few requests simply pass with the static list only.
app.whenReady().then(() => setTimeout(loadLocalFilters, 300)).catch(() => {});

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
      // /releases/latest returns one small object instead of the whole release
      // history; conditional requests with ETag don't count against the API rate limit
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
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
          // /releases/latest returns a single release object (not an array);
          // normalize to the array shape checkGithubFallback expects
          const release = Array.isArray(json) ? json[0] : json;
          const releases = release && !release.draft ? [release] : [];
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
  newtabBackground: 'default',
  fontSize: 'medium',
  density: 'auto',
  showBookmarksBar: false,
  restoreSession: false,
  smoothScroll: true,
  httpsOnly: false,
  fingerprintProtection: true,
  doNotTrack: true,
  searchSuggest: true,
  weatherEnabled: true,
  clearOnExit: false,
  tabCountWarning: 50,
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
// HISTORY (SQLite-backed, see src/main/history-db.js)
// ============================================================
function getHistory() {
  return historyDb.get(5000);
}

function addHistoryEntry(entry) {
  historyDb.add(entry);
}

function clearHistory() {
  historyDb.clear();
}

function removeHistoryEntry(id) {
  historyDb.remove(id);
}

function removeHistoryEntries(ids) {
  historyDb.removeMany(ids);
}

function searchHistory(query) {
  if (!query) return historyDb.get(200);
  return historyDb.search(query, 200);
}

// ============================================================
// DOWNLOADS
// ============================================================
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
// AD & TRACKER BLOCKER
// ============================================================
const BLOCKED_DOMAINS = [
  // Google
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com', 'ads.google.com',
  'tpc.googlesyndication.com', 'googleads.g.doubleclick.net',
  // Facebook
  'connect.facebook.net', 'pixel.facebook.com', 'an.facebook.com', 'analytics.facebook.com',
  // Ad Networks
  'adnxs.com', 'adsrvr.org', 'adform.net', 'adcolony.com',
  'amazon-adsystem.com', 'aax.amazon-adsystem.com', 'aan.amazon.com', 'media.net', 'outbrain.com', 'taboola.com',
  'criteo.com', 'criteo.net', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'casalemedia.com', 'indexww.com', 'indexexchange.com', 'cdn.indexexchange.com', 'hilb.casalemedia.com', 'bidswitch.net',
  'smartadserver.com', 'yieldmo.com', 'sharethrough.com', 'triplelift.com', 'tlx.3lift.com',
  'quantserve.com', 'scorecardresearch.com', 'bluekai.com',
  'exelator.com', 'demdex.net', 'krxd.net', 'liadm.com', 'tapad.com',
  'adservr.org', 'smartyads.com', 'ad.gt', 'contextweb.com', 'eb2.3lift.com', 'flx.3lift.com',
  'apex.go.sonobi.com', 'c.gumgum.com', 'a.teads.tv', 'cdn.teads.tv', 'cdn.kargo.com', 'sync.kargo.com',
  // Fingerprinting / behavioral / identity
  'fingerprintjs.com', 'fpjs.io', 'api.fpjs.io',
  'siftscience.com', 'cdn.siftscience.com', 'permutive.com', 'cdn.permutive.com',
  'onetag-sys.com', 'pipipo.com', 'id5-sync.com', 'crwdcntrl.net',
  'mathtag.com', 'sync.mathtag.com', 'pixel.mathtag.com', 'thetradedesk.com',
  // LiveRamp
  'rlcdn.com', 'idsync.rlcdn.com', 'api.rlcdn.com',
  // Mobile attribution
  'appsflyer.com', 'app.appsflyer.com', 'adjust.com', 'app.adjust.com', 'branch.io', 'api2.branch.io', 'bnc.lt',
  'kochava.com', 'control.kochava.com', 'singular.net',
  'applovin.com', 'd.applovin.com', 'rt.applovin.com', 'ms.applovin.com',
  'api.vungle.com', 'vungle.com', 'liftoff.io',
  'auction.unityads.unity3d.com', 'webview.unityads.unity3d.com', 'config.unity3d.com', 'adserver.unityads.unity3d.com', 'unityads.unity3d.com',
  'live.chartboost.com', 'init.supersonicads.com', 'api.fyber.com', 'inmobi.com', 'ironSource.mobi', 'is.com', 'outcome-ssp.supersonicads.com',
  // Push / engagement
  'wzrkt.com', 'clevertap-prod.com',
  'moatads.com', 'doubleverify.com', 'adsafeprotected.com',
  'serving-sys.com', 'sizmek.com', 'flashtalking.com',
  'popads.net', 'popcash.net', 'propellerads.com',
  'revcontent.com', 'mgid.com', 'addthis.com', 'sharethis.com',
  'ads.yahoo.com', 'advertising.com', 'ad.doubleclick.net',
  'adtech.de', 'adtech.com', 'adtechus.com',
  'teads.tv', 'zedo.com', 'gumgum.com', 'sovrn.com',
  // ИСПРАВЛЕНО: НЕ блокируем эти домены — они нужны для работы YouTube
  // 's.youtube.com', 'redirector.googlevideo.com', 'youtubei.googleapis.com',
  'm.doubleclick.net', 'static.doubleclick.net', 'stats.g.doubleclick.net', 'cm.g.doubleclick.net', 'mediavisor.doubleclick.net', 'securepubads.g.doubleclick.net', 'pubads.g.doubleclick.net',
  'pagead2.googleadservices.com', 'www.googleadservices.com', 'afs.googlesyndication.com', 'fundingchoicesmessages.google.com',
  'pagead2.googlesyndication.com', 'adservice.google.com', 'tpc.googlesyndication.com',
  // ИСПРАВЛЕНО: pagead2.googlevideo.com убран — нужен для работы видео
  // 'pagead2.googlevideo.com',
  'bingads.microsoft.com', 'ads.microsoft.com',
  // New domains from user list
  'cdn.ravenjs.com', 'app.getsentry.com', 'api.rollbar.com', 'cdn.rollbar.com', 'rollbar.com', 'd2wy8f7a9ursnm.cloudfront.net',
  'cdn.logrocket.io', 'cdn.lr-ingest.com', 'firebase-settings.crashlytics.com', 'trackjs.com', 'usage.trackjs.com', 'api.raygun.io', 'capture.trackjs.com',
  's0.2mdn.net', 'ads.youtube.com', 'vid.springserve.com', 'sync.springserve.com', 'cdn.springserve.com',
  'ce.lijit.com', 'siteimproveanalytics.com', 'us.edge.rms.media.net', 'unagi-na.amazon.com',
  'mads.amazon.com', 'adtago.s3.amazonaws.com', 'advice-ads.s3.amazonaws.com', 'analyticsengine.s3.amazonaws.com',
  'analytics.pinterest.com', 'ads.pinterest.com', 'redditmedia.com',
  'app-measurement.com', 'ad.samsungadhub.com', 'nmetrics.samsung.com', 'samsung-com.112.2o7.net', 'smetrics.samsung.com', 'config.samsungads.com', 'analytics-api.samsunghealthcn.com',
  'samsungads.com',
  'adsapi.snapchat.com', 'bat.bing.com', 'c.bing.com',
  'ad.turn.com', 'banners.adfox.ru',
  'dev.visualwebsiteoptimizer.com', 'try.abtasty.com', 'cdn.abtest.ai', 'api.flagsmith.com', 'static.kameleoon.com', 'edge.api.flagsmith.com', 'cdn-eu.configcat.com',
  'tags.tiqcdn.com', 'app.link', 'data.kameleoon.io', 'abtasty.com',
  'analytics.google.com', 'tagmanager.google.com', 'informer.yandex.ru', 'mc.yandex.com',
  'vc.hotjar.io', 'cs.luckyorange.net', 'upload.luckyorange.net', 'cdn.mxpnl.com', 'chartbeat.com', 'stats.wp.com', 'pixel.wp.com',
  'r.logrocket.io', 'cdn.raygun.io', 'api.honeybadger.io', 'raygun.io',
  'coin-hive.com', 'coinhive.com', 'cryptoloot.org', 'hashing.win', 'cpu.js.org', 'fastpool.xyz', 'minemytraffic.com', 'afminer.com', 'coin-have.com', 'cnhv.co',
  'fresnel.vimeocdn.com', 'f.vimeocdn.com', 'api.bcovlive.io', 'prd.jwpltx.com', 'cdn.jwplayer.com', 'static.addtoany.com',
  'platform.instagram.com', 'badges.instagram.com', 'st-widget.s3.amazonaws.com', 'plus.google.com', 'analytics.pointdrive.linkedin.com',
  'pangleglobal.com', 'insightexpressai.com', 'click.googleanalytics.com', 'analytics.adobe.io',
  'pippio.com', 'prod.uidapi.com',
  'bdapi-ads.realmemobile.com', 'bdapi-in-ads.realmemobile.com',
  'ads.roku.com',
  'gemini.yahoo.com', 'adtech.yahooinc.com',
  'ironSource.mobi', 'ironsource.mobi',
  'd.adroll.com', 's.adroll.com', 'adroll.com',
  'anrdoezrs.net', 'dpbolvw.net', 'tkqlhce.com',
  'px.srvcs.tumblr.com', 'ads.vk.com',
  'skimresources.com', 'r.skimresources.com',
  'ad.admitad.com', 'gdeslon.ru',
  'sibautomation.com', 'getdrip.com',
  'clientservices.googleapis.com', 'firebaselogging.googleapis.com',
  
  // RU/CIS Ad Networks
  'an.yandex.ru', 'yandexadexchange.net', 'mc.yandex.ru', 'bs.yandex.ru',
  'ad.mail.ru', 'target.my.com', 'top-fwz1.mail.ru', 'counter.yadro.ru',
  'tns-counter.ru', 'rambler.ru', 'begun.ru', 'sape.ru',
  'rs.mail.ru', 'relap.io', 'videonow.ru', 'marketgid.com',
  'metrika.yandex.ru', 'adfox.yandex.ru', 'adfstat.yandex.ru', 'appmetrica.yandex.ru', 'extmaps-api.yandex.net', 'offerwall.yandex.net',
  // Yandex Distribution / Hijackers
  'browser.yandex.ru', 'dl.browser.yandex.ru', 'downloader.yandex.ru',
  'distribution.yandex.ru', 'soft.yandex.ru', 'clck.yandex.ru',
  'yandex.ru/soft', 'redirect.appmetrica.yandex.com',
  // Analytics / Tracking
  'appmetrica.yandex.com', 'yandexmetrica.com',
  'amplitude.com', 'hotjar.com', 'fullstory.com', 'mouseflow.com',
  'luckyorange.com', 'clarity.ms', 'crazyegg.com', 'mixpanel.com',
  'segment.io', 'segment.com', 'heapanalytics.com', 'inspectlet.com',
  'newrelic.com', 'nr-data.net', 'sentry.io', 'browser.sentry-cdn.com', 'bugsnag.com',
  'track.hubspot.com', 'munchkin.marketo.net', 'trackcmp.net',
  'track.mailerlite.com', 'click.mailerlite.com', 'assets.mailerlite.com',
  'track.customer.io', 'mailchimp.com',
  'app.convertkit.com', 'open.convertkit.com',
  'email.mailgun.net', 'pi.pardot.com', 'mandrillapp.com', 'getresponse.com', 'pixel.aweber.com', 'sendgrid.net',
  'freshmarketer.com', 'static.chartbeat.com',
  'pendo.io', 'cdn.pendo.io', 'app.pendo.io',
  'matomo.cloud', 'piwik.pro',
  // Social Widgets (often trackers)
  'platform.twitter.com', 'platform.linkedin.com', 'widgets.pinterest.com',
  'syndication.twitter.com', 'static.ads-twitter.com', 't.co',
  'staticxx.facebook.com',
  // Apple ads/analytics
  'iadsdk.apple.com', 'metrics.icloud.com', 'api-adservices.apple.com',
  'books-analytics-events.apple.com', 'weather-analytics-events.apple.com', 'notes-analytics-events.apple.com',
  'metrics.mzstatic.com', 'xp.apple.com',
  // Realme/Oppo
  'iot-eu-logser.realme.com', 'iot-logser.realme.com', 'bdapi-ads.realme.com', 'bdapi-in-ads.realme.com',
  'adsfs.oppomobile.com', 'adx.ads.oppomobile.com', 'ck.ads.oppomobile.com', 'data.ads.oppomobile.com',
  // OnePlus/Huawei/Xiaomi
  'open.oneplus.net',
  'metrics.data.hicloud.com', 'metrics2.data.hicloud.com', 'grs.hicloud.com', 'logservice.hicloud.com', 'logservice1.hicloud.com', 'logbak.hicloud.com', 'ads.huawei.com',
  'api.ad.xiaomi.com', 'data.mistat.xiaomi.com', 'data.mistat.india.xiaomi.com', 'data.mistat.rus.xiaomi.com',
  'sdkconfig.ad.xiaomi.com', 'sdkconfig.ad.intl.xiaomi.com', 'tracking.rus.miui.com', 'tracking.miui.com',
  // LG / Samsung ads ecosystems
  'us.info.lgsmartad.com', 'us.lbs.lgappstv.com', 'ad.lgappstv.com', 'info.lgsmartad.com', 'ngfts.lge.com', 'yumenetworks.com', 'smartclip.net', 'smartclip.com',
  // Microsoft telemetry
  'settings-win.data.microsoft.com', 'vortex.data.microsoft.com', 'vortex-win.data.microsoft.com', 'watson.telemetry.microsoft.com', 'telemetry.microsoft.com',
  // Amazon FireTV metrics/ads
  'device-metrics-us.amazon.com', 'device-metrics-us-2.amazon.com', 'mads-eu.amazon.com',
  // Meta / Instagram / Snapchat
  'graph.facebook.com', 'tr.facebook.com',
  'graph.instagram.com', 'i.instagram.com',
  'sc-static.net', 'tr.snapchat.com', 'ads.snapchat.com', 'sc-analytics.appspot.com',
  // Chat widgets
  'widget.intercom.io', 'js.driftt.com',
  // LinkedIn / X / Reddit
  'ads.linkedin.com', 'analytics.poindrive.linkedin.com', 'snap.licdn.com', 'px.ads.linkedin.com',
  'static-ads-twitter.com', 'ads-api.twitter.com', 'analytics.twitter.com', 'ads.x.com',
  'events.reddit.com', 'events.redditmedia.com', 'd.reddit.com',
  // TikTok / Pinterest / Quora
  'ads-api.tiktok.com', 'analytics.tiktok.com', 'ads-sg.tiktok.com', 'analytics-sg.tiktok.com',
  'business-api.tiktok.com', 'ads.tiktok.com', 'log.byteoversea.com', 'mon.byteoversea.com',
  'ct.pinterest.com', 'log.pinterest.com', 'trk.pinterest.com',
  'pixel.quora.com',
  // Affiliate / performance networks
  'arndoezrs.net', 'dpbolvw.net', 'lkqlhce.com',
  'shareasale.com', 'shareasale-analytics.com',
  'click.linksynergy.com', 'ad.linksynergy.com', 'track.linksynergy.com',
  'impact.com', 'd.impactradius-event.com', 'api.impact.com',
  'awin1.com', 'zenaps.com',
  'partnerstack.com', 'api.partnerstack.com',
  'refersion.com', 'api.refersion.com',
  's.skimresources.com', 't.skimresources.com', 'go.skimresources.com', 'redirector.skimresources.com',
  'redirect.viglink.com', 'cdn.viglink.com', 'api.viglink.com',
  // A/B testing platforms
  'cdn.optimizely.com', 'logx.optimizely.com', 'api.optimizely.com',
  'cdn.dynamicyield.com',
  'stream.launchdarkly.com', 'events.launchdarkly.com', 'mobile.launchdarkly.com', 'app.launchdarkly.com',
  'streaming.split.io', 'sdk.split.io', 'cdn.split.io', 'events.split.io',
  'cdn-pci.optimizely.com',
  'kameleoon.eu', 'vwo.com', 'statsigapi.net', 'cdn.configcat.com', 'featuregates.org',
  // Video ads / VAST / players
  'imasdk.googleapis.com', 'dai.google.com',
  'g.jwpsrv.com', 'ssl.p.jwpcdn.com',
  'mssl.fwmrm.net',
  'cd.connatix.com', 'capi.connatix.com', 'vid.connatix.com',
  'metrics.brightcove.com',
  's.innovid.com',
  'tremorhub.com', 'ads.tremorhub.com',
  // Monitoring / logging
  'js.honeybadger.io',
  'cdn.rollbar.com', 'api.rollbar.com', 'rollbar.com',
  'app.getsentry.com', 'cdn.ravenjs.com', 'd2wy8f7a9ursnm.cloudfront.net',
  'cdn.lr-ingest.com', 'firebase-settings.crashlytics.com', 'cdn.logrocket.io',
  'trackjs.com', 'usage.trackjs.com', 'capture.trackjs.com', 'api.raygun.io',
  // Consent / CMPs
  'cdn.cookielaw.org', 'geolocation.onetrust.com', 'consent.cookiebot.com', 'consentcdn.cookiebot.com', 'cookiebot.com',
  'consent.trustarc.com', 'sdk.privacy-center.org', 'cdn.privacy-mgmt.com', 'app.usercentrics.eu',
  'wrapper-api.sp-prod.net', 'cookies-data.onetrust.io', 'cdn.onetrust.com', 'optanon.blob.core.windows.net',
  'api.privacy-center.org', 'aggregator.service.usercentrics.eu', 'api.usercentrics.eu', 'consent-pref.trustarc.com',
  'privacymanager.io', 'c.betrad.com', 'didomi.io',
  // Crypto miners / malvertising / malware
  'coinimp.com', 'www.coinimp.com', 'webminepool.com', 'minero.cc', 'mineral1.io', 'jsecoin.com', 'crypto-loot.org', 'monerominer.rocks',
  'propellerclick.com', 'onclickads.net', 'popmyads.com', 'clickadu.com', 'trafficjunky.net', 'exoclick.com', 'juicyads.com',
  '2giga.link', 'greatis.com', 'statdynamic.com',
  'popads.net', 'popcash.net', 'propellerads.com'
];

const BLOCKED_DOMAINS_SET = new Set(BLOCKED_DOMAINS);

// Tracker classification for Pulse stats: everything in the main blocklist
// counts, plus a few tracker-only domains. One small list instead of a
// 300-line copy of BLOCKED_DOMAINS.
const TRACKER_EXTRA_DOMAINS = [
  'list-manage.com'
];
const TRACKER_DOMAINS_SET = new Set([...BLOCKED_DOMAINS_SET, ...TRACKER_EXTRA_DOMAINS]);

// ОПТИМИЗАЦИЯ: Кэшированная проверка домена с Bloom Filter
function checkDomainInSet(hostname, set) {
  if (!hostname) return false;
  
  const lower = hostname.toLowerCase();
  
  // Создаем уникальный ключ кэша для каждого set
  const setId = set === BLOCKED_DOMAINS_SET ? 'blocked' :
                set === WHITELIST ? 'whitelist' :
                set === dynamicBlockedDomains ? 'dynamic' :
                set === TRACKER_DOMAINS_SET ? 'tracker' : 'other';
  const cacheKey = `${setId}:${lower}`;
  
  // Проверяем LRU кэш
  if (blockCache.has(cacheKey)) {
    return blockCache.get(cacheKey);
  }
  
  // Bloom filter: отсекаем только если НИ сам домен, НИ один из его родительских доменов не присутствуют в Bloom
  if (set === dynamicBlockedDomains && bloomFilter) {
    let mightMatch = bloomFilter.has(lower);
    if (!mightMatch) {
      const parts = lower.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (bloomFilter.has(parts.slice(i).join('.'))) {
          mightMatch = true;
          break;
        }
      }
    }
    if (!mightMatch) {
      // Bloom гарантирует "точно нет" для хоста и всех его родительских доменов
      if (blockCache.size >= CACHE_SIZE) {
        const firstKey = blockCache.keys().next().value;
        blockCache.delete(firstKey);
      }
      blockCache.set(cacheKey, false);
      return false;
    }
  }
  
  // Точная проверка: hostname или родительский домен
  let result = false;
  if (set.has(lower)) {
    result = true;
  } else {
    const parts = lower.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const sub = parts.slice(i).join('.');
      if (set.has(sub)) {
        result = true;
        break;
      }
    }
  }
  
  // Кэшируем результат (LRU)
  if (blockCache.size >= CACHE_SIZE) {
    const firstKey = blockCache.keys().next().value;
    blockCache.delete(firstKey);
  }
  blockCache.set(cacheKey, result);
  
  return result;
}

function isBlockedDomain(hostname) {
  // Global flag: if Puls is disabled, never block
  if (!pulseEnabled) return false;

  // 1) Whitelist fast-path
  if (checkDomainInSet(hostname, WHITELIST)) return false;

  // 2) Dynamic filters
  if (dynamicBlockedDomains && dynamicBlockedDomains.size && checkDomainInSet(hostname, dynamicBlockedDomains)) {
    return true;
  }

  // 3) Static blocklist
  return checkDomainInSet(hostname, BLOCKED_DOMAINS_SET);
}

function isTrackerDomain(hostname) {
  return checkDomainInSet(hostname, TRACKER_DOMAINS_SET);
}

let pulseEnabled = true;

let _dntEnabled = null;
function getDntEnabled() {
  // Cached: loadSettings() here would spread a 30-key object on EVERY request.
  // Invalidated from the settings:save / config:save handlers.
  if (_dntEnabled === null) _dntEnabled = !!loadSettings().doNotTrack;
  return _dntEnabled;
}

let _httpsOnly = null;
function getHttpsOnly() {
  if (_httpsOnly === null) _httpsOnly = !!loadSettings().httpsOnly;
  return _httpsOnly;
}

function isLocalHostname(host) {
  const h = (host || '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) { const n = parseInt(m172[1], 10); if (n >= 16 && n <= 31) return true; }
  return false;
}

// HTTPS-Only: upgrade plain http:// requests to https:// (top-level and
// subresources). Local/private addresses are never redirected.
function httpsOnlyRedirect(details) {
  if (!getHttpsOnly()) return null;
  if (typeof details.url !== 'string' || !details.url.startsWith('http://')) return null;
  try {
    const u = new URL(details.url);
    if (isLocalHostname(u.hostname)) return null;
    return 'https://' + details.url.slice('http://'.length);
  } catch (e) {
    return null;
  }
}

// Security: Fast regex for detecting private network addresses (localhost, LAN, link-local, loopback)
const IS_PRIVATE_IP_RE = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?)$/i;
function isPrivateHost(host) {
  if (!host) return false;
  return IS_PRIVATE_IP_RE.test(host) || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal');
}

function attachAdBlockerToSession(ses) {
  if (!ses || !ses.webRequest) return;
  try {
    ses.setUserAgent(SPOOFED_UA);
  } catch(e) {}

  // Helper: detect third-party to reduce breakage (compares target host to referrer host)
  // Takes the already-parsed request URL — avoids a second `new URL()` per request.
  const isThirdPartyRequest = (details, reqUrl) => {
    try {
      if (!details.referrer) return true;
      const reqHost = reqUrl.hostname;
      const refHost = new URL(details.referrer).hostname;
      return !(reqHost === refHost || reqHost.endsWith('.' + refHost) || refHost.endsWith('.' + reqHost));
    } catch (e) {
      return true; // default to third-party if parsing fails
    }
  };

  // Block specific URL patterns regardless of domain
  // Relaxed patterns to avoid breaking site functionality (false positives)
  const BLOCKED_URL_PATTERNS = [
    /yandex.*pack.*loader/i,
    /yandex.*browser.*setup/i,
    /YandexPackSetup/i,
    /yandex_pack/i,
    /\/soft\/download/i,
    /browser\.yandex.*\.exe/i,
    /google_ads/i,
    /doubleclick\.net/i,
    /googleadservices\.com/i,
    /googlesyndication\.com/i
  ];

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    // HTTPS-Only upgrade first — applies regardless of the Pulse toggle
    const upgradeUrl = httpsOnlyRedirect(details);
    if (upgradeUrl) { callback({ redirectURL: upgradeUrl }); return; }

    if (!pulseEnabled) { callback({}); return; }

    // Stealth Network: fake 200 OK for YouTube ads and telemetry to completely eliminate ads
    // ИСПРАВЛЕНО: Более точная фильтрация для YouTube
    if (
      /\/log_event/.test(details.url) ||
      /\/api\/stats\/ads/.test(details.url) ||
      /\/api\/stats\/atr.*[?&](adformat|ad_type)/.test(details.url) ||
      /\/pagead\//.test(details.url) ||
      /youtube\.com\/ptracking/.test(details.url) ||
      /youtube\.com\/get_midroll_info/.test(details.url) ||
      /googleads\.g\.doubleclick\.net/.test(details.url) ||
      /static\.doubleclick\.net\/instream/.test(details.url)
      // ИСПРАВЛЕНО: Убрал блокировку googlevideo.com — она ломала видео
      // Проблема была: /googlevideo\.com\/videoplayback.*[?&](adformat|ad_type|ctier)/
      // YouTube использует эти параметры и для обычных видео!
    ) {
      pulseStats.adsBlocked++;
      broadcastPulseStats();
      callback({ redirectURL: 'data:,' });
      return;
    }
    
    // НОВОЕ: Более умная блокировка видеорекламы YouTube
    // Блокируем только если это ТОЧНО реклама (несколько маркеров одновременно)
    if (/googlevideo\.com\/videoplayback/.test(details.url)) {
      const url = details.url;
      // Блокируем только если есть явные признаки рекламы
      const hasAdMarkers = (
        (url.includes('adformat') || url.includes('ad_type')) &&
        (url.includes('&ad=1') || url.includes('&ctype=ad') || url.includes('&clen=') && parseInt(url.match(/clen=(\d+)/)?.[1] || 0) < 300000) // короткие видео < 300KB
      );
      
      if (hasAdMarkers) {
        pulseStats.adsBlocked++;
        broadcastPulseStats();
        callback({ redirectURL: 'data:,' });
        return;
      }
    }

    let url;
    try {
      url = new URL(details.url);
    } catch (e) {
      pulseStats.requestsTotal++;
      callback({});
      return;
    }

    // Security: Private Network Access (PNA) / SSRF Guard
    // Blocks external websites from scanning or attacking local/internal network services (localhost, routers, printers)
    if (isPrivateHost(url.hostname)) {
      let isExternalCaller = false;
      if (details.initiator) {
        try {
          const initHost = new URL(details.initiator).hostname;
          if (initHost && !isPrivateHost(initHost)) isExternalCaller = true;
        } catch (e) { }
      } else if (details.referrer) {
        try {
          const refHost = new URL(details.referrer).hostname;
          if (refHost && !isPrivateHost(refHost)) isExternalCaller = true;
        } catch (e) { }
      }
      if (isExternalCaller) {
        console.warn('[Security] Blocked external request to private network:', url.hostname, 'from:', details.initiator || details.referrer);
        callback({ cancel: true });
        return;
      }
    }
    const thirdParty = isThirdPartyRequest(details, url);

    // Block by domain (prefer third-party to avoid trimming first-party assets)
    if (thirdParty && isBlockedDomain(url.hostname)) {
      pulseStats.adsBlocked++;
      pulseStats.dataSavedKB += 15;
      if (isTrackerDomain(url.hostname)) pulseStats.trackersBlocked++;
      broadcastPulseStats();
      callback({ cancel: true });
      return;
    }
    // Block by URL pattern (Yandex pack loaders, etc.)
    const fullUrl = details.url;
    if (BLOCKED_URL_PATTERNS.some(p => p.test(fullUrl))) {
      pulseStats.adsBlocked++;
      broadcastPulseStats();
      console.log('[AdBlock] Blocked Yandex pack loader:', fullUrl);
      callback({ cancel: true });
      return;
    }
    pulseStats.requestsTotal++;
    callback({});
  });

  const filter = {
    urls: ['https://accounts.google.com/*', 'https://*.google.com/*', 'https://*.youtube.com/*', '*://*/*']
  };

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    
    // Remove all Electron-specific headers
    Object.keys(headers).forEach(k => {
      if (k.toLowerCase().startsWith('x-electron') || k.toLowerCase() === 'sec-ch-ua-full-version') {
        delete headers[k];
      }
    });
    
    // Force Chrome User-Agent
    headers['User-Agent'] = SPOOFED_UA;
    
    // Set other Chrome-like headers for consistency
    headers['sec-ch-ua'] = `"Not-A.Brand";v="99", "Chromium";v="108", "Google Chrome";v="108"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    
    if (getDntEnabled()) headers['DNT'] = '1';
    
    callback({ cancel: false, requestHeaders: headers });
  });
}

function setupAdBlocker() {
  attachAdBlockerToSession(session.defaultSession);
  app.on('session-created', (ses) => {
    attachAdBlockerToSession(ses);
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
              { brand: 'Not-A.Brand', version: '99' },
              { brand: 'Chromium', version: '108' },
              { brand: 'Google Chrome', version: '108' }
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: function(hints) {
              return Promise.resolve({
                architecture: 'x86',
                bitness: '64',
                brands: this.brands,
                fullVersionList: [
                  { brand: 'Not-A.Brand', version: '99.0.0.0' },
                  { brand: 'Chromium', version: '108.0.0.0' },
                  { brand: 'Google Chrome', version: '108.0.0.0' }
                ],
                mobile: false,
                model: '',
                platform: 'Windows',
                platformVersion: '10.0.0',
                uaFullVersion: '108.0.0.0'
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
// GOOGLE LOGIN — EXTERNAL BROWSER FLOW
// ============================================================
async function handleGoogleLoginExternal(url, webContents) {
  // 1. Open system browser (Chrome/Edge)
  await shell.openExternal(url);

  // 2. Show dialog asking user to complete login
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Вход через внешний браузер',
    message: 'Мы открыли страницу входа в вашем системном браузере (Chrome/Edge).',
    detail: 'Пожалуйста, войдите в аккаунт там. Когда закончите, нажмите кнопку "Синхронизировать", чтобы перенести сессию в Mauzer.',
    buttons: ['Синхронизировать сессию', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });

  if (response === 0) {
    // 3. Import cookies from Chrome
    // We try Chrome first, then Edge, etc. or just try all.
    // Ideally we detect which browser is default, but that's hard.
    // Let's try Chrome then Edge.
    let imported = false;
    const browsers = ['chrome', 'edge', 'yandex', 'brave'];
    
    for (const browser of browsers) {
      try {
        const result = await importer.importCookies(browser);
        if (result.count > 0) {
          // Filter for Google/YouTube cookies
          const googleCookies = result.items.filter(c => 
            c.domain.includes('google.com') || 
            c.domain.includes('youtube.com') || 
            c.domain.includes('gstatic.com')
          );
          
          if (googleCookies.length > 0) {
            console.log(`[Import] Found ${googleCookies.length} Google cookies from ${browser}`);
            
            // Inject into current session
            for (const cookie of googleCookies) {
              const scheme = cookie.secure ? 'https' : 'http';
              const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
              const cookieUrl = scheme + '://' + domain + cookie.path;
              
              await session.defaultSession.cookies.set({
                url: cookieUrl,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                expirationDate: cookie.expirationDate,
                sameSite: cookie.sameSite
              }).catch(e => {}); // Ignore errors for individual cookies
            }
            imported = true;
            break; // Stop after first successful import
          }
        }
      } catch (e) {
        console.error('Import error for', browser, e);
      }
    }

    if (imported) {
      // Reload the page to apply cookies
      if (webContents && !webContents.isDestroyed()) {
        webContents.reload();
      }
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Успешно',
        message: 'Сессия Google успешно синхронизирована! Теперь вы авторизованы.'
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка',
        message: 'Не удалось найти активную сессию Google в других браузерах.',
        detail: 'Убедитесь, что вы вошли в аккаунт в Chrome или Edge.'
      });
    }
  }
}

function setupAntiFingerprint(win) {
  if (!win || win.isDestroyed()) return;
  const antiDetectJS = getAntiDetectScript();
  const settings = loadSettings();

  // insertCSS survives SPA navigations (pushState keeps the same document),
  // so re-inserting on every did-navigate-in-page stacks copies. Track the
  // last inserted key per webContents and remove it before re-inserting.
  const adblockCssKeys = new WeakMap();
  const insertCssOnce = async (wc, css) => {
    try {
      const oldKey = adblockCssKeys.get(wc);
      if (oldKey) {
        try { await wc.removeInsertedCSS(oldKey); } catch (e) { }
      }
      const key = await wc.insertCSS(css);
      adblockCssKeys.set(wc, key);
    } catch (e) { }
  };

  win.webContents.on('did-attach-webview', (event, wc) => {
    wc.setUserAgent(SPOOFED_UA);

    // Intercept Google login navigations — open in popup BrowserWindow
    wc.on('will-navigate', (e, url) => {
      // if (isGoogleLoginUrl(url)) {
      //   e.preventDefault();
      //   handleGoogleLoginExternal(url, wc);
      //   return;
      // }
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
      }

      // Native dark mode signal
      nativeTheme.themeSource = settings.theme || 'dark';

      // Smooth scroll injection
      if (settings.smoothScroll) {
        wc.insertCSS(`html { scroll-behavior: smooth !important; }`).catch(() => { });
      }
    });

    // Comprehensive uBlock Origin / AdGuard rules for YouTube & Web
    const YOUTUBE_ADBLOCK_CSS = `
      .ytp-suggested-action, .ytp-suggested-action-badge,
      .ytp-ad-action-interstitial, .ytp-ad-overlay-container,
      .ytp-ad-overlay-slot, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
      .ytp-ad-preview-container, .ytp-ad-player-overlay-flyout-cta,
      .ytp-ad-button-vm, .ytp-ad-text, .ytp-ad-module,
      #masthead-ad, ytd-ad-slot-renderer, ytd-display-ad-renderer,
      ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
      ytd-promoted-sparkles-web-renderer, ytd-merch-shelf-renderer,
      ytd-companion-slot-renderer, ytd-statement-banner-renderer,
      .ytd-player-legacy-ad-renderer, #player-ads, .ad-div, #merchandise-promo,
      #shopping-timely-shelf, .badge-shape-wiz--ad, .badge-shape-wiz--ad-secondary,
      .ytp-ad-overlay-close-button,
      .ytp-ad-message-container,
      .ytp-ad-player-overlay-layout,
      ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
      ytd-item-section-renderer:has(ytd-ad-slot-renderer),
      ytd-ad-slot-renderer[ad-slot-type],
      ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]
      { display: none !important; }
    `;

    const YOUTUBE_ZERO_ADS_JS = `
      (function() {
        // uBlock Origin: Neutralize YouTube EXPERIMENT_FLAGS that force ads
        try {
          if (!window.ytcfg) window.ytcfg = { data_: {} };
          if (!window.ytcfg.data_) window.ytcfg.data_ = {};
          if (!window.ytcfg.data_.EXPERIMENT_FLAGS) window.ytcfg.data_.EXPERIMENT_FLAGS = {};
          const ef = window.ytcfg.data_.EXPERIMENT_FLAGS;
          ef.all_web_network_ad_formats = false;
          ef.all_web_enable_ad_signals = false;
          ef.web_enable_ad_signals = false;
          ef.web_player_enable_ad_signals = false;
          ef.html5_ad_frequency_cap = 0;
          if (typeof window.ytcfg.set === 'function' && !window.ytcfg._patched) {
            window.ytcfg._patched = true;
            const origSet = window.ytcfg.set;
            window.ytcfg.set = function(...args) {
              if (args[0] && typeof args[0] === 'object' && args[0].EXPERIMENT_FLAGS) {
                args[0].EXPERIMENT_FLAGS.all_web_network_ad_formats = false;
                args[0].EXPERIMENT_FLAGS.all_web_enable_ad_signals = false;
                args[0].EXPERIMENT_FLAGS.web_enable_ad_signals = false;
              }
              return origSet.apply(this, args);
            };
          }
        } catch(e) {}

        if (window.__mauzerZeroAds) {
          if (typeof cleanDomAds === 'function') cleanDomAds();
          return;
        }
        window.__mauzerZeroAds = true;

        function pruneAdData(obj) {
          if (!obj || typeof obj !== 'object') return obj;
          try {
            delete obj.adPlacements;
            delete obj.adSlots;
            delete obj.playerAds;
            delete obj.adBreakHeartbeatParams;
            if (obj.playbackTracking) {
              delete obj.playbackTracking.videostatsPlaybackUrl;
              delete obj.playbackTracking.atrUrl;
              delete obj.playbackTracking.videostatsDelayplayUrl;
            }
          } catch(e) {}
          return obj;
        }

        // 1. Prune window.ytInitialPlayerResponse
        if (window.ytInitialPlayerResponse) {
          pruneAdData(window.ytInitialPlayerResponse);
        }
        if (window.ytInitialData && window.ytInitialData.playerResponse) {
          pruneAdData(window.ytInitialData.playerResponse);
        }
        let _ytResp = window.ytInitialPlayerResponse;
        try {
          Object.defineProperty(window, 'ytInitialPlayerResponse', {
            get() { return _ytResp; },
            set(val) { _ytResp = pruneAdData(val); },
            configurable: true,
            enumerable: true
          });
        } catch(e) {}

        // 2. Intercept JSON.parse globally
        const origParse = JSON.parse;
        JSON.parse = function(...args) {
          const res = origParse.apply(this, args);
          if (res && typeof res === 'object') {
            if (res.adPlacements || res.playerAds || res.adSlots) {
              pruneAdData(res);
            }
            if (res.playerResponse) {
              pruneAdData(res.playerResponse);
            }
          }
          return res;
        };

        // 3. Intercept fetch (uBlock Origin: trusted-replace-fetch-response + json-prune)
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          const response = await origFetch.apply(this, args);
          if (typeof url === 'string' && (url.includes('/youtubei/v1/') || url.includes('/player') || url.includes('/browse'))) {
            try {
              const text = await response.text();
              if (text.includes('"adSlots"') || text.includes('"adPlacements"') || text.includes('"playerAds"')) {
                const cleaned = text
                  .replaceAll('"adSlots"', '"no_adSlots"')
                  .replaceAll('"adPlacements"', '"no_adPlacements"')
                  .replaceAll('"playerAds"', '"no_playerAds"')
                  .replaceAll('"adBreakHeartbeatParams"', '"no_adBreak"');
                return new Response(cleaned, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              }
              return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            } catch(e) {
              return response;
            }
          }
          return response;
        };

        // 4. Intercept XMLHttpRequest
        const origXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this._isYt = typeof url === 'string' && (url.includes('/youtubei/v1/') || url.includes('/player') || url.includes('/browse'));
          return origXhrOpen.call(this, method, url, ...rest);
        };
        const origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
          if (this._isYt) {
            this.addEventListener('readystatechange', () => {
              if (this.readyState === 4 && this.responseText) {
                try {
                  if (this.responseText.includes('"adSlots"') || this.responseText.includes('"adPlacements"')) {
                    const cleaned = this.responseText
                      .replaceAll('"adSlots"', '"no_adSlots"')
                      .replaceAll('"adPlacements"', '"no_adPlacements"')
                      .replaceAll('"playerAds"', '"no_playerAds"');
                    Object.defineProperty(this, 'responseText', { value: cleaned, configurable: true });
                    Object.defineProperty(this, 'response', { value: cleaned, configurable: true });
                  }
                } catch(e) {}
              }
            });
          }
          return origXhrSend.apply(this, args);
        };

        // 5. DOM cleaner for sidebar cards, suggested actions & banner interstitials
        function cleanDomAds() {
          try {
            const selectors = [
              'ytd-ad-slot-renderer',
              'ytd-in-feed-ad-layout-renderer',
              'ytd-banner-promo-renderer',
              'ytd-promoted-sparkles-web-renderer',
              'ytd-companion-slot-renderer',
              'ytd-statement-banner-renderer',
              '#player-ads',
              '#masthead-ad',
              '#shopping-timely-shelf',
              '.ytp-suggested-action',
              '.ytp-suggested-action-badge',
              '.ytp-ad-action-interstitial',
              '.ytp-ad-overlay-container',
              '.ytp-ad-overlay-slot',
              '.ytp-ad-button-vm',
              '.ytp-ad-text',
              '.ytp-ad-preview-container',
              '.ytp-ad-module',
              '.ytp-ad-message-container',
              '.ytp-ad-player-overlay-layout',
              '.badge-shape-wiz--ad',
              '.badge-shape-wiz--ad-secondary',
              'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
              'ytd-item-section-renderer:has(ytd-ad-slot-renderer)'
            ];
            selectors.forEach(sel => {
              document.querySelectorAll(sel).forEach(el => el.remove());
            });

            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
              if (typeof player.skipAd === 'function') player.skipAd();
              const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button');
              if (skipBtn) skipBtn.click();
            }
          } catch(e) {}
        }

        window.addEventListener('yt-navigate-finish', cleanDomAds);
        window.addEventListener('yt-page-data-updated', cleanDomAds);
        document.addEventListener('DOMContentLoaded', cleanDomAds);
        // Poll slowly and only while the tab is visible — a 300ms timer in
        // every background tab is constant CPU drain for no benefit.
        setInterval(() => {
          if (document.visibilityState === 'visible') cleanDomAds();
        }, 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') cleanDomAds();
        });
      })();
    `;

    const GENERIC_ADBLOCK_CSS = `
      .adsbygoogle, .google-auto-placed,
      div[id^="google_ads_iframe"], div[id^="div-gpt-ad"],
      iframe[id^="google_ads_frame"],
      .ad-banner, .ad-box, .ad-container, .ad-slot,
      .banner-ad, .sidebar-ad, .text-ad, .sponsored-link,
      [class*="yandex_ad"], [id*="yandex_ad"],
      .ya-share2, .ya-context-panel, 
      div[class*="ya-site-form"],
      #ad_banner, .b-banner,
      .share-buttons, .social-share
    `;

    const applyAdblock = () => {
      if (!pulseEnabled) return;
      let url = '';
      try { url = wc.getURL(); } catch (e) {}
      if (!url) return;

      if (url.includes('youtube.com')) {
        insertCssOnce(wc, YOUTUBE_ADBLOCK_CSS);
        wc.executeJavaScript(YOUTUBE_ZERO_ADS_JS).catch(() => {});
      } else if (!url.startsWith('file://') && !url.startsWith('mauzer://')) {
        insertCssOnce(wc, GENERIC_ADBLOCK_CSS);
      }
    };

    // Re-apply on every load and SPA navigation
    wc.on('did-finish-load', applyAdblock);
    wc.on('did-navigate-in-page', applyAdblock);
    wc.on('did-navigate', applyAdblock);
  });
}

// ============================================================
// DOWNLOADS HANDLER
// ============================================================
function setupDownloads() {
  const attachedSessions = new WeakSet();
  const attach = (ses) => {
    if (!ses || attachedSessions.has(ses)) return;
    attachedSessions.add(ses);
    // Downloads from incognito sessions (partition 'incognito*') are never
    // recorded in downloads.json — only the default session's are.
    const recordHistory = ses === session.defaultSession;
    ses.on('will-download', (event, item, webContents) => {
    // Open PDFs inline instead of forcing download
    const mime = item.getMimeType();
    if (mime && mime.toLowerCase() === 'application/pdf') {
      const pdfUrl = item.getURL();
      event.preventDefault();
      // Open in the window the download came from (may be incognito)
      const hostWin = (webContents && BrowserWindow.fromWebContents(webContents)) || mainWindow;
      if (hostWin && !hostWin.isDestroyed()) {
        hostWin.webContents.send('open-url-in-new-tab', pdfUrl);
      }
      return;
    }

    // The suggested name comes from Content-Disposition — attacker-controlled.
    // Force a bare filename, keep the path inside Downloads, never overwrite.
    let fileName = path.basename(String(item.getFilename() || '')).trim().replace(/[<>:"|?*\x00-\x1f]/g, '_') || 'download';
    const totalBytes = item.getTotalBytes();
    const downloadsDir = app.getPath('downloads');
    let downloadPath = path.join(downloadsDir, fileName);
    const rel = path.relative(path.resolve(downloadsDir), path.resolve(downloadPath));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      downloadPath = path.join(downloadsDir, 'download');
    }
    if (fs.existsSync(downloadPath)) {
      const ext = path.extname(downloadPath);
      const base = path.basename(downloadPath, ext);
      for (let i = 1; i < 1000 && fs.existsSync(downloadPath); i++) {
        downloadPath = path.join(downloadsDir, `${base} (${i})${ext}`);
      }
    }
    fileName = path.basename(downloadPath);

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

    const broadcastDownload = (channel, payload) => {
      windows.forEach(w => {
        if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
      });
    };

    item.on('updated', (event, state) => {
      dlItem.receivedBytes = item.getReceivedBytes();
      dlItem.state = state;
      broadcastDownload('download-progress', { ...dlItem });
    });

    item.once('done', async (event, state) => {
      dlItem.state = state;
      dlItem.receivedBytes = dlItem.totalBytes;
      if (!recordHistory) return; // incognito: file is saved, but nothing is persisted
      try {
        if (state === 'completed' && downloadPath && fs.existsSync(downloadPath)) {
          const icon = await app.getFileIcon(downloadPath, { size: 'normal' });
          if (icon && !icon.isEmpty()) {
            dlItem.iconUrl = icon.toDataURL();
          }
        }
      } catch (_) {}
      addDownload(dlItem);
      broadcastDownload('download-complete', { ...dlItem });
    });
    });
  };
  attach(session.defaultSession);
  app.on('session-created', attach);
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
      sandbox: true, // Enabled for better security and site compatibility (YouTube/Google)
      webSecurity: true,
      plugins: true, // Needed for built-in PDF viewer inside webviews
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

  // Pass the incognito flag via query param so the renderer knows BEFORE
  // it creates any tabs (the 'set-incognito' IPC arrives too late — after init).
  win.loadFile(path.join(__dirname, 'src', 'index.html'),
    isIncognito ? { query: { incognito: '1' } } : undefined);

  win.once('ready-to-show', () => {
    // Hidden runs (benchmark / security self-test) stay invisible
    if (!HIDDEN_RUN) win.show();
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
  win.on('minimize', () => {
    trimMemory();
  });

  win.on('enter-full-screen', () => {
    win.webContents.send('fullscreen-changed', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send('fullscreen-changed', false);
  });

  win.on('closed', () => {
    windows = windows.filter(w => w !== win);
    if (win === mainWindow) {
      mainWindow = windows[0] || null;
    }
  });

  windows.push(win);

  setupAntiFingerprint(win);

  if (!mainWindow) {
    mainWindow = win;
    setupAdBlocker();
    setupDownloads();
    setupWebViewPermissions();
  }

  return win;
}

// ============================================================
// WEBVIEW PERMISSIONS
// ============================================================
// Local pages that may carry the full IPC preload into a webview — only the
// app's own UI pages, never an arbitrary file:// document (e.g. an HTML file
// from Downloads)
const APP_LOCAL_PAGE_RE = /\/(newtab|settings|incognito|import|index)\.html($|[?#])/i;
const APP_SRC_DIR = path.normalize(path.resolve(path.join(__dirname, 'src'))).toLowerCase();
function isAppLocalPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('file:')) return false;
  if (!APP_LOCAL_PAGE_RE.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    let p = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:[\/]/.test(p)) p = p.slice(1);
    const norm = path.normalize(path.resolve(p)).toLowerCase();
    return norm.startsWith(APP_SRC_DIR);
  } catch (e) {
    return false;
  }
}

// Permission handlers must exist on EVERY session: without one Electron
// auto-grants the request, and incognito partitions create their own sessions
// — a site there would get the mic/camera silently, with no dialog at all.
function attachPermissionHandlers(ses) {
  if (!ses || typeof ses.setPermissionRequestHandler !== 'function') return;
  try {
    if (typeof ses.setWebRTCIPHandlingPolicy === 'function') {
      ses.setWebRTCIPHandlingPolicy('default_public_interface_only');
    }
  } catch (e) { }
  // clipboard-read is deliberately NOT auto-granted: a silent read is a
  // silent data leak, it goes through the same per-site dialog as the mic.
  // clipboard-write only pushes data OUT, so it stays automatic.
  const alwaysAllowed = ['clipboard-write', 'fullscreen', 'pointerLock', 'mediaKeySystem', 'audio'];
  const blockedPermissions = [
    'usb', 'serial', 'hid', 'bluetooth', 'midi', 'midi-sysex',
    'sensors', 'ambient-light-sensor', 'accelerometer', 'gyroscope', 'magnetometer',
    'idle-detection', 'screen-wake-lock', 'system-wake-lock', 'nfc',
    'payment-handler', 'background-sync', 'background-fetch', 'periodic-background-sync',
    'accessibility-events', 'clipboard-sanitized-write'
  ];

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (blockedPermissions.includes(permission)) return callback(false);
    if (alwaysAllowed.includes(permission)) return callback(true);

    // Camera/microphone/clipboard: per-site decision, remembered in permissions.json
    if (permission === 'media' || permission === 'microphone' || permission === 'clipboard-read') {
      try {
        const url = (details && details.requestingUrl) || (webContents && !webContents.isDestroyed() ? webContents.getURL() : '') || '';
        const host = new URL(url).hostname;
        if (!host) return callback(false);
        const perms = getSitePermissions();
        const stored = perms[host] && perms[host][permission];
        if (stored === true) return callback(true);
        if (stored === false) return callback(false);

        let what;
        if (permission === 'clipboard-read') {
          what = 'чтение буфера обмена';
        } else {
          const kinds = (details && details.mediaTypes) || [];
          what = kinds.includes('video') ? 'камеру и/или микрофон' : 'микрофон';
        }
        const targetWin = (webContents && !webContents.isDestroyed() && BrowserWindow.fromWebContents(webContents)) || mainWindow;
        dialog.showMessageBox(targetWin, {
          type: 'question',
          title: 'Разрешение доступа',
          message: `Сайт ${host} запрашивает доступ к ${what}.`,
          detail: 'Разрешение будет запомнено. Изменить его можно в настройках сайта.',
          buttons: ['Разрешить', 'Заблокировать'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        }).then(({ response }) => {
          const granted = response === 0;
          try { setSitePermission(host, permission, granted); } catch (e) { }
          callback(granted);
        }).catch(() => callback(false));
        return;
      } catch (e) {
        return callback(false);
      }
    }
    callback(false);
  });

  // Also handle permission checks (not just requests)
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (blockedPermissions.includes(permission)) return false;
    if (alwaysAllowed.includes(permission)) return true;
    if (permission === 'media' || permission === 'microphone' || permission === 'clipboard-read') {
      try {
        const host = new URL(requestingOrigin).hostname;
        const perms = getSitePermissions();
        return !!(perms[host] && perms[host][permission] === true);
      } catch (e) { return false; }
    }
    return false;
  });
}

// WebView/host guards must be registered at module scope: the first window's
// shell webContents is created BEFORE app.whenReady, and a handler registered
// later would never see its 'web-contents-created' event (this exact gap kept
// will-attach-webview dead until the security self-test caught it).
app.on('web-contents-created', (event, contents) => {
    // Security: Secure webview attachments
    contents.on('will-attach-webview', (wvEvent, webPreferences, params) => {
      // Prevent untrusted webviews from gaining Node.js access
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.enableRemoteModule = false;
      webPreferences.sandbox = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      delete webPreferences.commandLineSwitches;

      // The preload may only ride along to the app's own UI pages. This is
      // the real file:// gate — the initial webview src never fires
      // will-navigate. Strips unless BOTH hold: the attach-time src is a
      // confirmed app page (a webview can be appended before its src is set,
      // so an unknown src keeps nothing) AND the preload is the app's own
      // (checked in both Electron forms: path and preloadURL).
      const trustedPreload = path.join(__dirname, 'preload.js');
      const trustedPreloadUrl = 'file:///' + trustedPreload.replace(/\\/g, '/');
      if (webPreferences.preload || webPreferences.preloadURL) {
        const srcOk = typeof params.src === 'string' && isAppLocalPageUrl(params.src);
        const preloadOk = webPreferences.preload === trustedPreload || webPreferences.preload === trustedPreloadUrl || webPreferences.preloadURL === trustedPreloadUrl;
        if (!srcOk || !preloadOk) {
          delete webPreferences.preload;
          delete webPreferences.preloadURL;
        }
      }
    });

    // Security: Handle popups / window.open safely
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        // Only allow safe web protocols
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mauzer:') {
          // Route popups into the window the call came from — the global
          // mainWindow may be a normal window while the caller is incognito
          const hostWin = BrowserWindow.fromWebContents(contents) || mainWindow;
          if (hostWin && !hostWin.isDestroyed()) {
            hostWin.webContents.send('open-url-in-new-tab', url);
          }
        }
      } catch (e) { }
      return { action: 'deny' };
    });

    // Security: Prevent arbitrary navigation to local file:// or dangerous schemes from webviews (gates both will-navigate and will-redirect)
    const handleNavigationGate = (navEvent, navigationUrl) => {
      try {
        if (!navigationUrl || typeof navigationUrl !== 'string') {
          navEvent.preventDefault();
          return;
        }
        // Fast paths for standard web protocols
        if (navigationUrl.startsWith('https://') || navigationUrl.startsWith('http://') || navigationUrl.startsWith('about:') || navigationUrl.startsWith('mauzer:')) {
          return;
        }
        const parsed = new URL(navigationUrl);
        if (parsed.protocol === 'file:') {
          // Webviews may ONLY navigate to valid local app pages if already on an internal page
          if (isAppLocalPageUrl(navigationUrl)) {
            const currentUrl = (contents && !contents.isDestroyed()) ? contents.getURL() : '';
            if (!currentUrl || currentUrl.startsWith('file:') || currentUrl.startsWith('about:') || currentUrl.startsWith('mauzer:')) {
              return;
            }
          }
          navEvent.preventDefault();
          console.warn('[Security] Blocked unauthorized file navigation to:', navigationUrl);
          return;
        }
        navEvent.preventDefault();
        console.warn('[Security] Blocked non-standard protocol navigation to:', navigationUrl);
      } catch (e) {
        navEvent.preventDefault();
      }
    };

    contents.on('will-navigate', handleNavigationGate);
    contents.on('will-redirect', handleNavigationGate);

    // Right-click context menu
    contents.on('context-menu', (e, params) => {
      if (contents.getType() !== 'webview') return;
      const hostWin = (contents && !contents.isDestroyed() && BrowserWindow.fromWebContents(contents)) || mainWindow;
      const menuItems = [];

      // Navigation
      if (contents.canGoBack()) menuItems.push({ label: 'Назад', click: () => contents.goBack() });
      if (contents.canGoForward()) menuItems.push({ label: 'Вперёд', click: () => contents.goForward() });
      menuItems.push({ label: 'Перезагрузить', click: () => contents.reload() });
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
        // Only web protocols — a file:// link opened this way would bypass the
        // setWindowOpenHandler gate and load a local page in a webview
        let linkSafe = false;
        try { const p = new URL(params.linkURL).protocol; linkSafe = p === 'http:' || p === 'https:' || p === 'mauzer:'; } catch (e) { }
        if (linkSafe) {
          menuItems.push({
            label: 'Открыть ссылку в новой вкладке',
            click: () => {
              if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send('open-url-in-new-tab', params.linkURL);
            }
          });
        }
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
          click: () => contents.copyImageAt(params.x, params.y)
        });
        menuItems.push({
          label: 'Копировать адрес изображения',
          click: () => require('electron').clipboard.writeText(params.srcURL)
        });
        menuItems.push({
          label: 'Сохранить изображение как...',
          click: () => {
            if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.downloadURL(params.srcURL);
          }
        });
        menuItems.push({ type: 'separator' });
      }

      // Dev tools
      menuItems.push({
        label: 'Просмотреть код',
        click: () => {
          // Open DevTools docked to the right side of the window
          contents.openDevTools({ mode: 'right' });
        }
      });

      const menu = Menu.buildFromTemplate(menuItems);
      if (hostWin && !hostWin.isDestroyed()) menu.popup({ window: hostWin });
    });
});

function setupWebViewPermissions() {
  attachPermissionHandlers(session.defaultSession);
  // Incognito partitions create their own in-memory sessions — each one must
  // carry the same permission handlers as the default session
  app.on('session-created', attachPermissionHandlers);
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
  _dntEnabled = null; // invalidate request-header cache
  _httpsOnly = null; // invalidate HTTPS-Only cache
  applyThemeToWeb(data);
  // Notify ALL windows that settings changed so they can reload
  windows.forEach(w => {
    if (w && !w.isDestroyed()) {
      w.webContents.send('settings-changed', data);
    }
  });
  // Also notify embedded webviews (newtab, settings pages) — each webview is
  // its own IPC context and never receives messages sent to the host window.
  webContents.getAllWebContents().forEach(wc => {
    if (wc.hostWebContents && !wc.isDestroyed()) {
      wc.send('settings-changed', data);
    }
  });
  return true;
});
ipcMain.handle('settings:getDefault', () => DEFAULT_SETTINGS);
ipcMain.handle('app:getPreloadPath', () => path.join(__dirname, 'preload.js'));

// --- History ---
// List views never need more than 200 rows — pulling 5000 over IPC just to
// slice 200 wastes RAM and serialization time (getTopSites is the only
// consumer of the full 5000)
ipcMain.handle('history:get', (_, query) => query ? searchHistory(query) : historyDb.get(200));
ipcMain.handle('history:add', (_, entry) => { addHistoryEntry(entry); return true; });
ipcMain.handle('history:clear', () => { clearHistory(); return true; });
ipcMain.handle('history:remove', (_, id) => { removeHistoryEntry(id); return true; });
ipcMain.handle('history:removeMany', (_, ids) => { removeHistoryEntries(ids); return true; });
ipcMain.handle('history:search', (_, query) => searchHistory(query));

// --- Downloads ---
ipcMain.handle('downloads:get', () => getDownloads());
ipcMain.handle('downloads:clear', () => { clearDownloads(); return true; });

// --- Pulse ---
ipcMain.on('pulse:ad-blocked', () => {
  pulseStats.adsBlocked++;
  broadcastPulseStats();
});
ipcMain.handle('pulse:toggle', (_, enabled) => {
  pulseEnabled = !!enabled;
  return pulseEnabled;
});
ipcMain.handle('pulse:get-state', () => pulseEnabled);

// Per-site whitelist for Puls
const PULS_WHITELIST_KEY = 'puls-whitelist-domains';
ipcMain.handle('pulse:get-whitelist', async () => {
  return readJSON('puls-whitelist.json', []);
});
ipcMain.handle('pulse:add-whitelist', async (_, domain) => {
  if (!domain) return readJSON('puls-whitelist.json', []);
  const list = readJSON('puls-whitelist.json', []);
  if (!list.includes(domain)) {
    list.push(domain);
    writeJSON('puls-whitelist.json', list);
  }
  return list;
});
ipcMain.handle('pulse:remove-whitelist', async (_, domain) => {
  const list = readJSON('puls-whitelist.json', []);
  const updated = list.filter(d => d !== domain);
  writeJSON('puls-whitelist.json', updated);
  return updated;
});
ipcMain.handle('pulse:clear-whitelist', async () => {
  writeJSON('puls-whitelist.json', []);
  return [];
});

// --- Search ---
// Incognito detection for privacy-sensitive IPC: an incognito webview runs in
// its own partition session; the incognito window's shell is the default
// session but carries ?incognito=1 in its URL.
function isIncognitoSender(e) {
  try {
    if (!e || !e.sender || e.sender.isDestroyed()) return false;
    if (e.sender.session !== session.defaultSession) return true;
    return new URL(e.sender.getURL()).searchParams.get('incognito') === '1';
  } catch (err) { return false; }
}

ipcMain.handle('search:suggest', async (e, query) => {
  if (!query) return [];
  // Incognito never phones home: keystrokes from an incognito window must
  // not reach the suggest endpoint
  if (isIncognitoSender(e)) return [];
  // Privacy: every keystroke would otherwise be sent to Google
  if (loadSettings().searchSuggest === false) return [];
  try {
    // https module instead of global fetch() — Electron 22 runs Node 16,
    // where fetch does not exist and the call silently failed
    const json = await new Promise((resolve, reject) => {
      const req = https.get(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mauzer' } },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); return reject(new Error('status ' + res.statusCode)); }
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', c => { buf += c; });
          res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    });
    return json[1] || [];
  } catch (e) {
    console.error('Search suggest error:', e.message || e);
    return [];
  }
});

// --- Downloads Actions ---
ipcMain.handle('downloads:open', async (_, filepath) => {
  if (!filepath || typeof filepath !== 'string') return false;
  try {
    const resolved = path.resolve(filepath);
    const downloadsDir = path.resolve(app.getPath('downloads'));
    const rel = path.relative(downloadsDir.toLowerCase(), resolved.toLowerCase());
    const isInsideDownloads = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!isInsideDownloads) {
      console.warn('[Security] Blocked unauthorized downloads:open:', filepath);
      return false;
    }
    // Block direct silent execution of dangerous downloads — scripts AND
    // executables/installers. The panel only reveals the file in Explorer;
    // running it is a separate, conscious user action.
    const dangerousExts = [
      '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1', '.scr', '.reg',
      '.exe', '.msi', '.msix', '.msp', '.mst', '.com', '.pif', '.hta', '.jar', '.lnk', '.scf', '.apk'
    ];
    if (dangerousExts.some(ext => resolved.toLowerCase().endsWith(ext))) {
      shell.showItemInFolder(resolved);
      return true;
    }
    await shell.openPath(resolved);
    return true;
  } catch (e) {
    console.error('Failed to open download', e);
    return false;
  }
});
ipcMain.handle('downloads:showInFolder', (_, filepath) => {
  if (!filepath || typeof filepath !== 'string') return false;
  try {
    const resolved = path.resolve(filepath);
    const downloadsDir = path.resolve(app.getPath('downloads'));
    const rel = path.relative(downloadsDir.toLowerCase(), resolved.toLowerCase());
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      console.warn('[Security] Blocked unauthorized downloads:showInFolder:', filepath);
      return false;
    }
    shell.showItemInFolder(resolved);
    return true;
  } catch (e) {
    return false;
  }
});
ipcMain.handle('downloads:openFolder', () => { shell.openPath(app.getPath('downloads')); });
ipcMain.handle('downloads:getFileIcon', async (_, filepath) => {
  if (!filepath || typeof filepath !== 'string') return null;
  try {
    const resolved = path.resolve(filepath);
    const downloadsDir = path.resolve(app.getPath('downloads'));
    const rel = path.relative(downloadsDir.toLowerCase(), resolved.toLowerCase());
    const isInsideDownloads = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!isInsideDownloads) {
      return null;
    }
    const icon = await app.getFileIcon(resolved, { size: 'normal' });
    if (!icon || icon.isEmpty()) return null;
    return icon.toDataURL();
  } catch (e) {
    return null;
  }
});

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

ipcMain.handle('update:restart', () => {
  autoUpdater.quitAndInstall();
  return true;
});
ipcMain.handle('update:download', async () => {
  try {
    return await autoUpdater.downloadUpdate();
  } catch (err) {
    console.error('[UPDATE] autoUpdater.downloadUpdate failed:', err);
    shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
    return false;
  }
});

// --- Pulse ---
ipcMain.handle('pulse:getStats', () => ({ ...pulseStats }));
ipcMain.handle('pulse:resetStats', () => {
  pulseStats = { adsBlocked: 0, trackersBlocked: 0, requestsTotal: 0, dataSavedKB: 0, sessionStart: Date.now() };
  broadcastPulseStats(true);
  return true;
});

// --- Config (legacy compat) ---
ipcMain.handle('config:load', () => loadSettings());
ipcMain.handle('config:save', (_, data) => { saveSettings(data); _dntEnabled = null; _httpsOnly = null; return true; });

// --- System ---
ipcMain.handle('shell:openExternal', (_, url) => {
  try {
    const p = new URL(url).protocol;
    if (p === 'http:' || p === 'https:' || p === 'mailto:') {
      return shell.openExternal(url);
    }
  } catch (e) { }
  return false;
});
// Only expose the handful of paths the UI actually needs — not exe/sessionData
const ALLOWED_GET_PATHS = ['downloads', 'pictures', 'userData', 'home', 'temp'];
ipcMain.handle('app:getPath', (_, name) => {
  if (!ALLOWED_GET_PATHS.includes(name)) return null;
  try { return app.getPath(name); } catch (e) { return null; }
});
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  isWin7: isWin7,
  isLowEnd: isWin7 || isLowEnd,
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

// Import credentials may only ever be requested by the import wizard — the
// shared preload exposes mauzer.import.* to every local page, so any other
// caller (e.g. a compromised local page) is rejected at the IPC boundary
const IMPORT_HTML_PATH = path.normalize(path.resolve(path.join(__dirname, 'src', 'import.html'))).toLowerCase();
function isImportSender(e) {
  try {
    if (!e || !e.sender || e.sender.isDestroyed()) return false;
    let url = e.sender.getURL();
    if (!url || !url.startsWith('file:') || !url.includes('import.html')) return false;
    const parsed = new URL(url);
    let p = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:[\/]/.test(p)) p = p.slice(1);
    return path.normalize(path.resolve(p)).toLowerCase() === IMPORT_HTML_PATH;
  } catch (err) { return false; }
}

// Detect installed browsers
ipcMain.handle('import:detect', async (e) => {
  if (!isImportSender(e)) return null;
  return importer.detectBrowsers();
});

// Import bookmarks
ipcMain.handle('import:bookmarks', async (e, browser) => {
  if (!isImportSender(e)) return { count: 0 };
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
ipcMain.handle('import:history', async (e, browser) => {
  if (!isImportSender(e)) return { count: 0 };
  const result = await importer.importHistory(browser);
  if (result.count > 0) {
    // UNIQUE(url, timestamp) index dedupes automatically
    const inserted = historyDb.addMany(result.items);
    return { count: inserted };
  }
  return { count: 0 };
});

// Import passwords (NEW)
ipcMain.handle('import:passwords', async (e, browser) => {
  if (!isImportSender(e)) return { count: 0 };
  const result = await importer.importPasswords(browser);
  if (result.count > 0) {
    const logins = readJSON('logins.json', []);
    const newItems = result.items.filter(n => !logins.some(e => e.url === n.url && e.username === n.username));
    
    if (newItems.length > 0) {
      let encryptionAvailable = false;
      try {
        encryptionAvailable = !!(safeStorage && safeStorage.isEncryptionAvailable());
      } catch (e) { }
      if (!encryptionAvailable) {
        // Never write plaintext passwords to disk
        console.warn('[Security] safeStorage unavailable — password import skipped');
        return { count: 0 };
      }
      newItems.forEach(i => {
        let storedPassword;
        try {
          storedPassword = 'enc:' + safeStorage.encryptString(i.password).toString('base64');
        } catch (e) {
          return;
        }
        logins.push({
          url: i.url,
          username: i.username,
          password: storedPassword,
          timestamp: i.timestamp || Date.now()
        });
      });
      writeJSON('logins.json', logins);
    }
    return { count: newItems.length };
  }
  return { count: 0 };
});

// Import cookies
ipcMain.handle('import:cookies', async (e, browser) => {
  if (!isImportSender(e)) return [];
  return await importer.importCookies(browser);
});

// Mark import as done
ipcMain.handle('import:done', async (e) => {
  if (!isImportSender(e)) return false;
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
  // Bare 1.1.x tags are stable releases; never auto-pull a prerelease
  autoUpdater.allowPrerelease = false;
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
    // No parallel fallback here: autoUpdater is authoritative in packaged builds,
    // and the fallback only fires when it errors (see catch above) — this keeps
    // GitHub API requests (and rate limits) to a minimum.
  };
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ status: 'available', info }));
  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({ status: 'not-available', info });
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

// --- DEEP LINKING (mauzer://) ---
// Register protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mauzer', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('mauzer');
}

// Handle deep links on Windows (second instance)
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      // Someone tried to run a second instance, we should focus our window.
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        
        // Find deep link in args (Windows puts it as an argument)
        const url = commandLine.find(arg => arg.startsWith('mauzer://'));
        if (url) {
          handleDeepLink(url);
        }
      }
    });
  
    // Handle deep links on macOS
    app.on('open-url', (event, url) => {
      event.preventDefault();
      handleDeepLink(url);
    });
  }

function handleDeepLink(url) {
  console.log('[DeepLink] Received:', url);

  try {
    const u = new URL(url);
    // Only the exact auth host is recognized — anything else is ignored so
    // a random website can't trigger app behavior via mauzer:// links.
    // The token itself is never echoed to the screen.
    if (u.hostname === 'auth') {
      // Token auth is not implemented — a random website must not be able to
      // make the app pop dialogs (or do anything else) via mauzer:// links
      console.log('[DeepLink] auth token received but ignored');
    }
  } catch(e) {
    console.error('Deep link parse error:', e);
  }
}

// ============================================================
// SECURITY SELF-TEST (--security-selftest)
// Hidden-window probes asserting the renderer-side security gates:
// contextIsolation, downloads/external-protocol guards, IPC sender
// gating and the webview preload whitelist. Driven by
// scripts/security-test.js; never runs in normal launches.
// ============================================================
async function runSecuritySelfTest() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const results = [];
  const expect = (name, ok, got) => {
    results.push(ok);
    console.log(`[SelfTest] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' (got: ' + JSON.stringify(got) + ')'}`);
  };
  let evilFile = null;
  try {
    // Wait for the shell page (fresh temp profile: first-run intro etc.)
    let ready = false;
    for (let i = 0; i < 25 && !ready; i++) {
      await wait(1000);
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          ready = await mainWindow.webContents.executeJavaScript('typeof window.mauzer === "object" && !!document.getElementById("browser-shell")');
        }
      } catch (e) { }
    }
    if (!ready || mainWindow.isDestroyed()) throw new Error('main window did not boot');
    const wc = mainWindow.webContents;

    const calcPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');
    evilFile = path.join(app.getPath('temp'), `mauzer-selftest-evil-${Date.now()}.html`);
    fs.writeFileSync(evilFile, '<!doctype html><title>evil</title>');
    const evilUrl = 'file:///' + evilFile.replace(/\\/g, '/');
    const fakeNewtabFile = path.join(app.getPath('temp'), `mauzer-fake-newtab-${Date.now()}-newtab.html`);
    fs.writeFileSync(fakeNewtabFile, '<!doctype html><title>fake newtab</title>');
    const fakeNewtabUrl = 'file:///' + fakeNewtabFile.replace(/\\/g, '/');
    const newtabUrl = 'file:///' + path.join(__dirname, 'src', 'newtab.html').replace(/\\/g, '/') + '?theme=dark';

    const out = await wc.executeJavaScript(`(async () => {
      const out = {};
      out.mauzerApi = typeof window.mauzer;
      out.nodeRequire = typeof window.require;
      out.processGlobal = typeof window.process;
      out.nodeBuffer = typeof window.Buffer;
      out.openOutsideDownloads = await window.mauzer.downloads.open(${JSON.stringify(calcPath)});
      out.showInFolderOutside = await window.mauzer.downloads.showInFolder(${JSON.stringify(calcPath)});
      out.openExternalFile = await window.mauzer.shell.openExternal('file:///C:/Windows');
      out.openExternalJs = await window.mauzer.shell.openExternal('javascript:alert(1)');
      out.openExternalMsdt = await window.mauzer.shell.openExternal('ms-msdt:/id PCWDiagnostic');
      out.openExternalSearch = await window.mauzer.shell.openExternal('search-ms:query=test');
      out.openExternalAppInstaller = await window.mauzer.shell.openExternal('ms-appinstaller:?source=evil');
      out.openExternalVbscript = await window.mauzer.shell.openExternal('vbscript:msgbox("test")');
      out.getPathExe = await window.mauzer.app.getPath('exe');
      out.getPathSessionData = await window.mauzer.app.getPath('sessionData');
      out.getPathDesktop = await window.mauzer.app.getPath('desktop');
      out.getPathAppData = await window.mauzer.app.getPath('appData');
      out.importDetect = await window.mauzer.import.detect();
      out.importPasswordsCount = (await window.mauzer.import.passwords('chrome')).count;
      out.importBookmarksCount = (await window.mauzer.import.bookmarks('chrome')).count;
      out.importHistoryCount = (await window.mauzer.import.history('chrome')).count;
      let evalBlocked = false;
      try {
        eval('1+1');
      } catch (e) {
        evalBlocked = true;
      }
      out.evalBlocked = evalBlocked;
      out.rawIpcRenderer = typeof window.ipcRenderer;
      out.openExternalCmd = await window.mauzer.shell.openExternal('cmd:/c dir');
      out.openExternalPowershell = await window.mauzer.shell.openExternal('powershell:-enc test');
      out.openExternalData = await window.mauzer.shell.openExternal('data:text/html,evil');
      let protoPollutionBlocked = false;
      try {
        const payload = JSON.parse('{"__proto__":{"polluted":true},"theme":"dark"}');
        await window.mauzer.settings.save(payload);
        protoPollutionBlocked = (Object.prototype.polluted === undefined);
      } catch (e) {
        protoPollutionBlocked = true;
      }
      out.protoPollutionBlocked = protoPollutionBlocked;
      let historyLen = -1;
      try {
        const hist = await window.mauzer.history.get();
        historyLen = Array.isArray(hist) ? hist.length : -1;
      } catch (e) { historyLen = -2; }
      out.historyLen = historyLen;
      const preloadUrl = 'file:///' + (await window.mauzer.app.getPreloadPath()).replace(/\\\\/g, '/');
      const probeWebview = (srcUrl) => new Promise((resolve) => {
        const wv = document.createElement('webview');
        wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes');
        wv.setAttribute('preload', preloadUrl);
        let done = false;
        wv.addEventListener('dom-ready', async () => {
          if (done) return;
          done = true;
          let api = 'exec-error';
          try { api = await wv.executeJavaScript('String(typeof window.mauzer)'); } catch (e) { }
          try { wv.remove(); } catch (e) { }
          resolve(api);
        });
        setTimeout(() => { if (!done) { done = true; try { wv.remove(); } catch (e) { } resolve('timeout'); } }, 15000);
        wv.src = srcUrl;
        document.body.appendChild(wv);
      });
      out.webviewEvilApi = await probeWebview(${JSON.stringify(evilUrl)});
      out.webviewFakeNewtabApi = await probeWebview(${JSON.stringify(fakeNewtabUrl)});
      out.webviewNewtabApi = await probeWebview(${JSON.stringify(newtabUrl)});
      return out;
    })()`, true);

    expect('contextBridge API present in shell', out.mauzerApi === 'object', out.mauzerApi);
    expect('no require() in renderer', out.nodeRequire === 'undefined', out.nodeRequire);
    expect('no process global in renderer', out.processGlobal === 'undefined', out.processGlobal);
    expect('no Buffer global in renderer', out.nodeBuffer === 'undefined', out.nodeBuffer);
    expect('no raw ipcRenderer leaked in renderer', out.rawIpcRenderer === 'undefined', out.rawIpcRenderer);
    expect('prototype pollution on exposed API blocked [GHSA-ff2p-hmqr-hxm4]', out.protoPollutionBlocked === true, out.protoPollutionBlocked);
    expect('downloads:open refuses paths outside Downloads', out.openOutsideDownloads === false, out.openOutsideDownloads);
    expect('downloads:showInFolder refuses paths outside Downloads', out.showInFolderOutside === false, out.showInFolderOutside);
    expect('shell:openExternal refuses file://', out.openExternalFile === false, out.openExternalFile);
    expect('shell:openExternal refuses javascript:', out.openExternalJs === false, out.openExternalJs);
    expect('shell:openExternal refuses ms-msdt: [CVE-2022-30190]', out.openExternalMsdt === false, out.openExternalMsdt);
    expect('shell:openExternal refuses search-ms: [CVE-2024-27997]', out.openExternalSearch === false, out.openExternalSearch);
    expect('shell:openExternal refuses ms-appinstaller: protocol', out.openExternalAppInstaller === false, out.openExternalAppInstaller);
    expect('shell:openExternal refuses vbscript: protocol', out.openExternalVbscript === false, out.openExternalVbscript);
    expect('shell:openExternal refuses cmd: command execution', out.openExternalCmd === false, out.openExternalCmd);
    expect('shell:openExternal refuses powershell: command execution', out.openExternalPowershell === false, out.openExternalPowershell);
    expect('shell:openExternal refuses data: URI scheme', out.openExternalData === false, out.openExternalData);
    expect('app:getPath allowlist refuses "exe"', out.getPathExe === null, out.getPathExe);
    expect('app:getPath allowlist refuses "sessionData"', out.getPathSessionData === null, out.getPathSessionData);
    expect('app:getPath allowlist refuses "desktop"', out.getPathDesktop === null, out.getPathDesktop);
    expect('app:getPath allowlist refuses "appData"', out.getPathAppData === null, out.getPathAppData);
    expect('import:detect gated to import.html only', out.importDetect === null, out.importDetect);
    expect('import:passwords gated to import.html only', out.importPasswordsCount === 0, out.importPasswordsCount);
    expect('import:bookmarks gated to import.html only', out.importBookmarksCount === 0, out.importBookmarksCount);
    expect('import:history gated to import.html only', out.importHistoryCount === 0, out.importHistoryCount);
    expect('history list capped at 200 rows', out.historyLen >= 0 && out.historyLen <= 200, out.historyLen);
    expect('shell CSP strictly blocks eval() [CVE-2023-23623]', out.evalBlocked === true, out.evalBlocked);
    expect('webview preload stripped for non-app file:// page', out.webviewEvilApi === 'undefined', out.webviewEvilApi);
    expect('webview preload stripped for outside fake newtab.html', out.webviewFakeNewtabApi === 'undefined', out.webviewFakeNewtabApi);
    expect('webview preload kept for app page (newtab)', out.webviewNewtabApi === 'object', out.webviewNewtabApi);
  } catch (e) {
    console.log('[SelfTest] FAIL harness (' + ((e && e.message) || e) + ')');
    results.push(false);
  }
  try { if (evilFile && fs.existsSync(evilFile)) fs.unlinkSync(evilFile); } catch (e) { }
  try { if (fakeNewtabFile && fs.existsSync(fakeNewtabFile)) fs.unlinkSync(fakeNewtabFile); } catch (e) { }
  const passed = results.filter(Boolean).length;
  console.log(`[SelfTest] RESULT: ${passed}/${results.length} passed`);
  await wait(300);
  app.exit(results.length > 0 && passed === results.length ? 0 : 1);
}

app.whenReady().then(async () => {
  // 1. Устанавливаем User-Agent как у обычного Chrome (Global fix)
  session.defaultSession.setUserAgent(SPOOFED_UA);

  // Apply theme settings
  await applyThemeToWeb(loadSettings());

  createWindow();
  setupAutoUpdate();

  // Security self-test: hidden run, IPC probes, exits with a code
  // (see scripts/security-test.js)
  if (process.argv.includes('--security-selftest')) {
    runSecuritySelfTest();
  }

  // Benchmark & Stress Testing Mode
  const benchmarkArg = process.argv.find(arg => arg.startsWith('--benchmark='));
  if (benchmarkArg) {
    const tabsToOpen = parseInt(benchmarkArg.split('=')[1], 10) || 15;
    console.log(`\n[Benchmark] =================================================`);
    console.log(`[Benchmark] 🚀 STARTING FULL SYSTEM & HEAVY TABS BENCHMARK`);
    console.log(`[Benchmark] Target Tabs: ${tabsToOpen} HEAVY real-world web pages`);
    console.log(`[Benchmark] =================================================\n`);

    let crashCount = 0;
    app.on('render-process-gone', (e, wc, details) => {
      crashCount++;
      console.log(`[Benchmark] ❌ PROCESS CRASH DETECTED: ${details.reason} (exit code: ${details.exitCode})`);
    });

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[Benchmark] [STAGE 1] Opening ${tabsToOpen} heavy tabs (YouTube, GitHub, Reddit, Wikipedia)...`);
        
        const heavyUrls = [
          'https://www.youtube.com',
          'https://github.com/trending',
          'https://en.wikipedia.org/wiki/Web_browser',
          'https://en.wikipedia.org/wiki/World_Wide_Web',
          'https://news.ycombinator.com'
        ];
        
        for (let i = 0; i < tabsToOpen; i++) {
           const url = heavyUrls[i % heavyUrls.length];
           setTimeout(() => {
             if (!mainWindow.isDestroyed()) {
               mainWindow.webContents.send('open-url-in-new-tab', url);
             }
           }, i * 350);
        }

        let maxLoadingMem = 0;
        let settledMem = 0;
        let peakCpu = 0;
        let ticks = 0;

        const interval = setInterval(async () => {
           if (mainWindow.isDestroyed()) {
              clearInterval(interval);
              return;
           }
           const metrics = app.getAppMetrics();
           let totalMemKB = 0;
           let totalCpu = 0;
           metrics.forEach(m => {
              totalMemKB += m.memory.workingSetSize;
              totalCpu += m.cpu.percentCPUUsage;
           });
           const totalMemMB = parseFloat((totalMemKB / 1024).toFixed(2));
           const cpu = parseFloat(totalCpu.toFixed(1));
           if (cpu > peakCpu) peakCpu = cpu;

           ticks++;

           if (ticks <= 12) {
             // Stage 1: Active loading phase
             if (totalMemMB > maxLoadingMem) maxLoadingMem = totalMemMB;
             console.log(`[Benchmark] ⏳ [Loading Phase] CPU: ${cpu}% | RAM: ${totalMemMB} MB (Peak: ${maxLoadingMem} MB)`);
           } else if (ticks <= 20) {
             // Stage 2: Settled phase after full load
             settledMem = totalMemMB;
             console.log(`[Benchmark] 🌿 [Settled Phase] CPU: ${cpu}% | RAM: ${totalMemMB} MB | Peak was: ${maxLoadingMem} MB`);
           } else if (ticks === 21) {
             // Stage 3: Automated UI Chaos / Monkey test
             console.log(`\n[Benchmark] 🤖 [STAGE 3] Automated UI Chaos / Monkey Testing...`);
             console.log(`[Benchmark] Testing rapid tab switching, closing tabs, shortcut triggers...`);
             try {
               mainWindow.webContents.executeJavaScript(`
                 (function() {
                   // Rapid tab switching test
                   const tabs = Array.from(document.querySelectorAll('.tab'));
                   tabs.forEach((t, idx) => {
                     setTimeout(() => t.click(), idx * 100);
                   });
                   // Test closing 4 tabs
                   setTimeout(() => {
                     const closes = Array.from(document.querySelectorAll('.tab-close')).slice(0, 4);
                     closes.forEach(c => c.click());
                   }, 1500);
                 })();
               `).catch(() => {});
             } catch(e) {}
           } else if (ticks <= 26) {
             console.log(`[Benchmark] 🧪 [Stress Testing] CPU: ${cpu}% | RAM: ${totalMemMB} MB`);
           } else {
             clearInterval(interval);
             console.log(`\n[Benchmark] =================================================`);
             console.log(`[Benchmark] 📊 FINAL BENCHMARK & STABILITY REPORT`);
             console.log(`[Benchmark] =================================================`);
             console.log(`[Benchmark] 📈 Пик памяти при одновременной загрузке: ${maxLoadingMem} MB`);
             console.log(`[Benchmark] 📉 Память после полной прогрузки всех вкладок: ${settledMem} MB`);
             console.log(`[Benchmark] ⚡ Пиковая нагрузка на процессор: ${peakCpu}%`);
             console.log(`[Benchmark] 🛡️ Проверка на вылеты и критические ошибки: ${crashCount === 0 ? '0 вылетов (ИДЕАЛЬНО)' : crashCount + ' вылетов'}`);
             console.log(`[Benchmark] =================================================\n`);
           }
        }, 1000);
      }
    }, 2500);
  }
});

// Write all debounced JSON writes to disk before the process exits,
// otherwise session/settings changes made in the last second are lost.
app.on('before-quit', () => {
  flushPendingWrites();
  try { historyDb.close(); } catch (e) { }
});

app.on('will-quit', () => {
  try { historyDb.close(); } catch (e) { }
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // "Clear on exit" belongs to the app lifecycle — wiping on any window's
    // close button destroyed data even while other windows were still open.
    if (loadSettings().clearOnExit) {
      try {
        await session.defaultSession.clearStorageData();
        clearHistory();
      } catch (e) { }
    }
    app.quit();
  }
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
