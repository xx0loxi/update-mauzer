// ============================================================
// MAUZER — History storage (SQLite via better-sqlite3)
// Replaces the old history.json approach: O(1) inserts instead of
// re-serializing up to 5000 entries on every navigation.
// ============================================================
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let addCount = 0;
const MAX_ENTRIES = 5000;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ensureDb() {
  if (db) return db;
  const dir = path.join(app.getPath('userData'), 'mauzer-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const Database = require('better-sqlite3');
  db = new Database(path.join(dir, 'history.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT DEFAULT '',
      favicon TEXT DEFAULT '',
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_ts ON history(timestamp);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_history_url_ts ON history(url, timestamp);
  `);
  migrateFromJson();
  return db;
}

// One-time migration from the old history.json (renamed to .bak, never deleted)
function migrateFromJson() {
  try {
    const oldPath = path.join(app.getPath('userData'), 'mauzer-data', 'history.json');
    if (!fs.existsSync(oldPath)) return;
    const count = db.prepare('SELECT COUNT(*) AS c FROM history').get().c;
    if (count === 0) {
      const data = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      if (Array.isArray(data) && data.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO history (id, url, title, favicon, timestamp) VALUES (?, ?, ?, ?, ?)');
        db.transaction((items) => {
          for (const h of items) {
            try { ins.run(h.id || genId(), h.url, h.title || h.url, h.favicon || '', h.timestamp || Date.now()); } catch (e) { }
          }
        })(data.slice(0, MAX_ENTRIES));
      }
    }
    fs.renameSync(oldPath, oldPath + '.bak');
  } catch (e) {
    console.error('[HistoryDB] JSON migration failed:', e);
  }
}

function prune() {
  if (!db) return;
  try {
    db.prepare(`DELETE FROM history WHERE timestamp < (SELECT timestamp FROM history ORDER BY timestamp DESC LIMIT 1 OFFSET ${MAX_ENTRIES})`).run();
  } catch (e) { }
}

function get(limit = MAX_ENTRIES) {
  ensureDb();
  return db.prepare('SELECT id, url, title, favicon, timestamp FROM history ORDER BY timestamp DESC LIMIT ?').all(limit);
}

function search(query, limit = 200) {
  ensureDb();
  const q = '%' + String(query).replace(/[%_\\]/g, '\\$&') + '%';
  return db.prepare(`SELECT id, url, title, favicon, timestamp FROM history
    WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
    ORDER BY timestamp DESC LIMIT ?`).all(q, q, limit);
}

function add(entry) {
  ensureDb();
  try {
    // UNIQUE(url, timestamp) silently dedupes same-page navigations
    db.prepare('INSERT OR IGNORE INTO history (id, url, title, favicon, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(genId(), entry.url, entry.title || entry.url, entry.favicon || '', Date.now());
  } catch (e) { }
  if (++addCount % 100 === 0) {
    try { prune(); } catch (e) { }
  }
}

function addMany(items) {
  ensureDb();
  let inserted = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO history (id, url, title, favicon, timestamp) VALUES (?, ?, ?, ?, ?)');
  db.transaction((rows) => {
    for (const it of rows) {
      try {
        const res = ins.run(genId(), it.url, it.title || it.url, it.favicon || '', it.timestamp || Date.now());
        inserted += res.changes;
      } catch (e) { }
    }
  })(items);
  try { prune(); } catch (e) { }
  return inserted;
}

function remove(id) {
  ensureDb();
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

function removeMany(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  ensureDb();
  const del = db.prepare('DELETE FROM history WHERE id = ?');
  db.transaction((rows) => { for (const id of rows) del.run(id); })(ids);
}

function clear() {
  ensureDb();
  db.exec('DELETE FROM history');
}

function close() {
  if (db) {
    try { db.close(); } catch (e) { }
    db = null;
  }
}

module.exports = { get, search, add, addMany, remove, removeMany, clear, close };
