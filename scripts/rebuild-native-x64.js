// postbuild hook: electron-builder rebuilds native modules for the LAST
// architecture it packs (ia32), leaving node_modules/better-sqlite3 unusable
// by the 64-bit dev runtime (`npm start` fails to load the .node file).
// This restores the x64 build. Called automatically after `npm run build`.
'use strict';
const path = require('path');
const rb = require('@electron/rebuild');
const fn = rb.default || rb;
fn({
  buildPath: path.join(__dirname, '..'),
  electronVersion: '22.3.27',
  arch: 'x64',
  force: true,
  onlyModules: ['better-sqlite3']
})
  .then(() => console.log('[postbuild] better-sqlite3 rebuilt for x64 dev runtime'))
  .catch(e => { console.error('[postbuild] rebuild failed:', e.message); process.exit(1); });
