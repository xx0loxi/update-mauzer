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

function readJSON(file, fallback = []) {
  try {
    const p = path.join(app.getPath('userData'), 'mauzer-data', file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error(`Read ${file} error:`, e); }
  return fallback;
}

function writeJSON(file, data) {
  try {
    const dir = path.join(app.getPath('userData'), 'mauzer-data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error(`Write ${file} error:`, e); }
}

module.exports = {
  isGoogleLoginUrl,
  normalizeVersion,
  compareVersions,
  readJSON,
  writeJSON
};
