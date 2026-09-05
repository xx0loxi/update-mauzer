const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function isGoogleLoginUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'accounts.google.com' || u.hostname === 'accounts.youtube.com') &&
      (u.pathname.includes('/signin') || u.pathname.includes('/ServiceLogin') ||
        u.pathname.includes('/o/oauth2') || u.pathname.includes('/v3/signin') ||
        u.pathname.includes('/AccountChooser') || u.pathname.includes('/AddSession') ||
        u.pathname.includes('/InteractiveLogin'));
  } catch (e) { return false; }
}

function normalizeVersion(v) {
  return String(v || '').replace(/^v/i, '').split('-')[0];
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map(n => parseInt(n || '0', 10));
  const pb = normalizeVersion(b).split('.').map(n => parseInt(n || '0', 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

const cache = new Map();
const writeTimeouts = new Map();

function readJSON(file, fallback = []) {
  if (cache.has(file)) return cache.get(file);
  try {
    const p = path.join(app.getPath('userData'), 'mauzer-data', file);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      cache.set(file, data);
      return data;
    }
  } catch (e) { console.error(`Read ${file} error:`, e); }
  
  // Clone fallback so we don't accidentally mutate the default fallback argument
  const initialData = Array.isArray(fallback) ? [...fallback] : (typeof fallback === 'object' && fallback !== null ? { ...fallback } : fallback);
  cache.set(file, initialData);
  return initialData;
}

function writeJSON(file, data) {
  cache.set(file, data);
  
  if (writeTimeouts.has(file)) {
    clearTimeout(writeTimeouts.get(file));
  }
  
  const timeoutId = setTimeout(() => {
    writeTimeouts.delete(file);
    try {
      const dir = path.join(app.getPath('userData'), 'mauzer-data');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Use async write to avoid blocking the main thread
      fs.writeFile(path.join(dir, file), JSON.stringify(data, null, 2), 'utf8', (err) => {
        if (err) console.error(`Async write ${file} error:`, err);
      });
    } catch (e) { console.error(`Write setup ${file} error:`, e); }
  }, 1000); // 1 second debounce
  
  writeTimeouts.set(file, timeoutId);
}

module.exports = {
  isGoogleLoginUrl,
  normalizeVersion,
  compareVersions,
  readJSON,
  writeJSON
};
