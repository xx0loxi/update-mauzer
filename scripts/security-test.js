#!/usr/bin/env node
// ============================================================
// MAUZER SECURITY TEST
// Part 1 — static source gates (no Electron needed): asserts the
//          security-relevant code patterns are still in place.
// Part 2 — hidden runtime self-test: launches Mauzer invisibly
//          (MAUZER_HIDDEN_TEST=1 + temp profile + --security-selftest)
//          and probes the real IPC surface from the renderer.
// Usage:  node scripts/security-test.js [--static-only]
//         npm run test:security
// Exit code 0 = all passed, 1 = at least one failure.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const STATIC_ONLY = process.argv.includes('--static-only');
let failures = 0;

function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '✗ FAIL'}  ${name}${ok || !detail ? '' : '  → ' + detail}`);
}

// ---------- Part 1: static source gates ----------
function staticChecks() {
  console.log('\n[1/2] Static source checks');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const main = read('main.js');
  const appjs = read('src/app.js');
  const preload = read('preload.js');
  const pkg = read('package.json');
  const pages = ['index.html', 'newtab.html', 'settings.html', 'incognito.html', 'import.html']
    .map(p => ({ p, html: read(path.join('src', p)) }));

  check('CSP meta present on all 5 local pages', pages.every(x => x.html.includes('Content-Security-Policy')));
  const indexCsp = (pages[0].html.match(/script-src[^;"]*/) || [''])[0];
  check('index.html script-src is strict (no unsafe-inline)', indexCsp.includes("'self'") && !indexCsp.includes('unsafe-inline'), indexCsp.trim());
  check('renderers have nodeIntegration: false', main.includes('nodeIntegration: false'));
  check('contextIsolation: true', main.includes('contextIsolation: true'));
  check('sandbox: true', main.includes('sandbox: true'));
  check('no webSecurity disabled anywhere', !main.includes('webSecurity: false'));
  check('webview preload whitelist (APP_LOCAL_PAGE_RE)', main.includes('APP_LOCAL_PAGE_RE'));
  check('will-attach-webview strips foreign preload (both gates)', (main.match(/delete webPreferences\.preload/g) || []).length >= 2);
  check('permission handlers attached to every session', main.includes("app.on('session-created', attachPermissionHandlers)"));
  check('context-menu link protocol gate (linkSafe)', main.includes('linkSafe'));
  check('downloads:open path containment (isInsideDownloads)', main.includes('isInsideDownloads'));
  check('downloads:open blocks executables, opens Explorer instead', /dangerousExts[\s\S]{0,600}showItemInFolder/.test(main) && main.includes("'.exe'"));
  check('incognito search-suggest gate (isIncognitoSender)', main.includes('isIncognitoSender'));
  check('shell:openExternal protocol allowlist (http/https/mailto)', main.includes("'mailto:'"));
  check('window.open denied by default (setWindowOpenHandler)', main.includes("action: 'deny'"));
  check('updater never auto-pulls prereleases', main.includes('allowPrerelease = false'));
  check('preload exposes only contextBridge (no fs/net/child_process)', preload.includes("require('electron')") && !/require\(['"](fs|child_process|http|net|path|os)/.test(preload));
  check('preload self-gates by page (APP_PAGE_RE)', preload.includes('APP_PAGE_RE') && preload.includes('if (isAppPage)'));
  check('no inline onerror= handlers in shell renderer', !/\sonerror="/.test(appjs));
  check('webview new-window filter drops file://', appjs.includes('/^(https?:\\/\\/|mauzer:)/i'));
  check('no eval() in app code', !/\beval\(/.test(main + appjs + preload));
  check('XSS guard present (escapeHtml + hideBrokenImage)', appjs.includes('function escapeHtml') && appjs.includes('hideBrokenImage'));
  check('electron core pinned to 22.x (Win7 support)', /"electron":\s*"22\./.test(pkg));
}

// ---------- Part 2: hidden runtime self-test ----------
function runtimeChecks() {
  return new Promise((resolve) => {
    console.log('\n[2/2] Hidden runtime IPC self-test (invisible window, temp profile)');
    const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fs.existsSync(exe)) {
      check('runtime: electron binary present', false, exe + ' missing (see electron-dist-empty-fix)');
      return resolve();
    }
    const profile = path.join(os.tmpdir(), `mauzer-sec-test-${Date.now()}`);
    try { fs.mkdirSync(profile, { recursive: true }); } catch (e) { }
    const child = spawn(exe, ['.', '--security-selftest', `--user-data-dir=${profile}`], {
      cwd: root,
      env: { ...process.env, MAUZER_HIDDEN_TEST: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let tail = '';
    const timer = setTimeout(() => {
      console.log('✗ FAIL  runtime self-test timed out after 180s');
      failures++;
      try { child.kill(); } catch (e) { }
      resolve();
    }, 180000);
    child.stdout.on('data', (d) => {
      tail = (tail + d.toString()).split('\n').slice(-30).join('\n');
      for (const line of d.toString().split('\n')) {
        if (line.includes('[SelfTest]')) console.log('   ' + line.trim());
      }
    });
    child.stderr.on('data', () => { });
    child.on('close', (code) => {
      clearTimeout(timer);
      const m = tail.match(/RESULT:\s*(\d+)\/(\d+)/);
      if (m) {
        const passed = parseInt(m[1], 10), totalR = parseInt(m[2], 10);
        check(`runtime IPC probes (${passed}/${totalR})`, code === 0 && passed === totalR && totalR > 0, `exit code ${code}`);
      } else {
        check('runtime IPC probes', false, `no [SelfTest] RESULT in output, exit code ${code}`);
      }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
      resolve();
    });
  });
}

(async () => {
  console.log('==========================================');
  console.log(' MAUZER SECURITY TEST');
  console.log('==========================================');
  try { staticChecks(); } catch (e) {
    console.log('✗ FAIL  static checks crashed: ' + e.message);
    failures++;
  }
  if (!STATIC_ONLY) {
    try { await runtimeChecks(); } catch (e) {
      console.log('✗ FAIL  runtime crashed: ' + e.message);
      failures++;
    }
  } else {
    console.log('\n[2/2] Runtime part skipped (--static-only)');
  }
  console.log('\n==========================================');
  console.log(failures === 0 ? ' ✓ ALL SECURITY CHECKS PASSED' : ` ✗ ${failures} CHECK(S) FAILED`);
  console.log('==========================================');
  process.exit(failures === 0 ? 0 : 1);
})();
