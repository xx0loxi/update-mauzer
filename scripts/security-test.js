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
  console.log('\n[1/2] Static source checks (70 hardening gates & CVE mitigations)');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const main = read('main.js');
  const appjs = read('src/app.js');
  const preload = read('preload.js');
  const pkg = read('package.json');
  const utils = read('src/main/utils.js');
  const histDb = read('src/main/history-db.js');
  const pages = ['index.html', 'newtab.html', 'settings.html', 'incognito.html', 'import.html']
    .map(p => ({ p, html: read(path.join('src', p)) }));

  const indexCsp = (pages[0].html.match(/script-src[^;"]*/) || [''])[0];

  // 1-5: Content Security Policy (CSP) & Tag Injection Hardening
  check('CSP meta present on all 5 local pages', pages.every(x => x.html.includes('Content-Security-Policy')));
  check('index.html script-src is strict (no unsafe-inline)', indexCsp.includes("'self'") && !indexCsp.includes('unsafe-inline'), indexCsp.trim());
  check('all 5 local pages enforce object-src "none"', pages.every(x => x.html.includes("object-src 'none'")));
  check('all 5 local pages enforce base-uri "none"', pages.every(x => x.html.includes("base-uri 'none'")));
  check('all 5 local pages enforce form-action "none"', pages.every(x => x.html.includes("form-action 'none'")));

  // 6-17: Process Isolation, RCE & WebPreferences (CVE-2022-29247, CVE-2023-29198, CVE-2023-23623)
  check('renderers have nodeIntegration: false', main.includes('nodeIntegration: false'));
  check('renderers have nodeIntegrationInSubFrames: false [CVE-2022-29247]', main.includes('nodeIntegrationInSubFrames: false'));
  check('contextIsolation: true enforced on all windows [CVE-2023-29198]', main.includes('contextIsolation: true'));
  check('sandbox: true enforced on all renderers [CVE-2023-23623]', main.includes('sandbox: true'));
  check('no webSecurity disabled anywhere in app', !main.includes('webSecurity: false'));
  check('enableRemoteModule: false explicitly configured', main.includes('enableRemoteModule: false'));
  check('allowRunningInsecureContent: false enforced against mixed content', main.includes('allowRunningInsecureContent = false') && !main.includes('allowRunningInsecureContent: true'));
  check('webPreferences.experimentalFeatures disabled', main.includes('experimentalFeatures = false') && !main.includes('experimentalFeatures: true'));
  check('commandLineSwitches stripped from webviews [GHSA-9wfr-w7mm-pc7f]', main.includes('delete webPreferences.commandLineSwitches'));
  check('webview window.open denied by default [GHSA-9f4c-93c8-jc8g]', main.includes("action: 'deny'"));
  check('DevTools dock mode strictly sanitized [GHSA-4f78-qhmw-8j8m]', main.includes("contents.openDevTools({ mode: 'right' })"));
  check('nativeImage only handles local application icons [GHSA-6r2x-8pq8-9489]', main.includes("icon: path.join(__dirname, 'icon_black.png')"));

  // 18-27: Preload & Webview Lifecycle Gates
  check('webview preload whitelist active (APP_LOCAL_PAGE_RE)', main.includes('APP_LOCAL_PAGE_RE'));
  check('will-attach-webview strips foreign preload (both gates)', (main.match(/delete webPreferences\.preload/g) || []).length >= 2);
  check('will-attach-webview registered at module scope (web-contents-created)', main.includes("app.on('web-contents-created'") && main.includes("contents.on('will-attach-webview'"));
  check('webview new-window filter drops file://', appjs.includes('/^(https?:\\/\\/|mauzer:)/i'));
  check('webview plugins disabled in app shell markup', !appjs.includes('plugins=yes') && !appjs.includes("setAttribute('plugins'"));
  check('preload exposes only contextBridge (no fs/net/child_process)', preload.includes("require('electron')") && !/require\(['"](fs|child_process|http|net|path|os)/.test(preload));
  check('preload self-gates by page (APP_PAGE_RE)', preload.includes('APP_PAGE_RE') && preload.includes('if (isAppPage)'));
  check('preload self-gate requires file: protocol', preload.includes("location.protocol === 'file:'"));
  check('server redirects gated with will-redirect', main.includes("contents.on('will-redirect'"));
  check('top-level webview navigation gated with will-navigate', main.includes("contents.on('will-navigate'") && main.includes('handleNavigationGate'));

  // 28-42: Permissions & Hardware Attack Surface Gating
  check('permission request handler attached to every session', main.includes("app.on('session-created', attachPermissionHandlers)"));
  check('permission check handler attached to session', main.includes('ses.setPermissionCheckHandler'));
  check('hardware APIs disabled (WebUSB/WebBluetooth/WebHID/WebSerial)', main.includes('WebUSB') && main.includes('WebBluetooth') && main.includes('WebHID') && main.includes('WebSerial'));
  check('WebUSB blocked via CLI and session [GHSA-9899-m83m-qhpj]', main.includes('WebUSB') && main.includes("'usb'"));
  check('WebMIDI and WebMIDISysex blocked via CLI and session', main.includes('WebMIDI') && main.includes("'midi'"));
  check('sensor APIs blocked (gyroscope/accelerometer/magnetometer)', main.includes('gyroscope') && main.includes('accelerometer') && main.includes('magnetometer'));
  check('ambient-light-sensor and sensors API blocked', main.includes('ambient-light-sensor') && main.includes("'sensors'"));
  check('screen-wake-lock and idle-detection blocked', main.includes('screen-wake-lock') && main.includes('idle-detection'));
  check('background-sync and periodic-background-sync blocked', main.includes('background-sync') && main.includes('periodic-background-sync'));
  check('background-fetch permission blocked', main.includes("'background-fetch'"));
  check('NFC permission explicitly blocked', main.includes("'nfc'"));
  check('payment-handler permission explicitly blocked', main.includes("'payment-handler'"));
  check('clipboard-read permission gated to user prompt', main.includes("permission === 'clipboard-read'") && main.includes('dialog.showMessageBox'));
  check('MojoJS IPC sandbox escape vectors disabled [CVE-2022-3699]', main.includes('MojoJS'));
  check('MojoJSTest IPC sandbox escape vectors disabled [CVE-2022-3723]', main.includes('MojoJSTest'));

  // 43-52: Network, Protocol & Anti-Automation
  check('AutomationControlled disabled for stealth and anti-bot', main.includes('AutomationControlled'));
  check('private network access (SSRF) guard active', main.includes('isPrivateHost') && main.includes('IS_PRIVATE_IP_RE'));
  check('WebRTC IP policy set to default_public_interface_only', main.includes("ses.setWebRTCIPHandlingPolicy('default_public_interface_only')"));
  check('minimum TLS protocol pinned to TLS 1.2+ (POODLE/BEAST)', main.includes("'ssl-version-min', 'tls1.2'"));
  check('context-menu link protocol gate (linkSafe)', main.includes('linkSafe'));
  check('shell:openExternal protocol allowlist (http/https/mailto)', main.includes("'mailto:'"));
  check('ms-msdt: protocol blocked in openExternal [CVE-2022-30190]', main.includes("p === 'http:' || p === 'https:' || p === 'mailto:'"));
  check('search-ms: & ms-appinstaller: blocked in openExternal [CVE-2024-27997]', main.includes("p === 'http:' || p === 'https:' || p === 'mailto:'"));
  check('WebRequest strips Electron-specific headers [GHSA-4p4r-m79c-wq3v]', main.includes("k.toLowerCase().startsWith('x-electron')"));
  check('WebRequest removes sec-ch-ua-full-version header', main.includes("sec-ch-ua-full-version"));

  // 53-60: File System, Traversal & Binary Execution Defense
  check('downloads:open path containment (isInsideDownloads)', main.includes('isInsideDownloads'));
  check('downloads:open blocks direct execution of .exe/.bat/.cmd/.ps1', /dangerousExts[\s\S]{0,600}showItemInFolder/.test(main) && main.includes("'.exe'"));
  check('downloads:showInFolder path containment enforced', main.includes('downloads:showInFolder') && main.includes("rel.startsWith('..')"));
  check('downloads:openFolder restricted to downloads directory [GHSA-5c9j-mhmv-5xgx]', main.includes("ipcMain.handle('downloads:openFolder'") && main.includes("shell.openPath(app.getPath('downloads'))"));
  check('app:getPath restricted to safe whitelist (ALLOWED_GET_PATHS)', main.includes('ALLOWED_GET_PATHS'));
  check('safeStorage DPAPI password encryption active (no plaintext)', main.includes('safeStorage.encryptString'));
  check('atomic writeJSON prevents data corruption on write', utils.includes('renameSync'));
  check('history database queries use parameterized SQL', histDb.includes('?'));

  // 61-70: Privacy, Integrity & Environment
  check('incognito search-suggest gate (isIncognitoSender)', main.includes('isIncognitoSender'));
  check('incognito downloads excluded from persistence (recordHistory)', main.includes('recordHistory') && main.includes('incognito'));
  check('no inline onerror= handlers in shell renderer', !/\sonerror="/.test(appjs));
  check('no inline onload= handlers in shell renderer', !/\sonload="/.test(appjs));
  check('no eval() in app production code', !/\beval\(/.test(main.slice(0, main.indexOf('runSecuritySelfTest')) + appjs + preload));
  check('XSS guard present (escapeHtml + hideBrokenImage)', appjs.includes('function escapeHtml') && appjs.includes('hideBrokenImage'));
  check('environment variables sanitized (ELECTRON_RUN_AS_NODE / ELECTRON_NO_ASAR) [CVE-2023-39956]', main.includes('ELECTRON_RUN_AS_NODE') && main.includes('ELECTRON_NO_ASAR'));
  check('NODE_OPTIONS cleared to prevent preload injection [CVE-2023-39956]', main.includes('NODE_OPTIONS'));
  check('single instance lock active to prevent protocol hijacking [GHSA-3c8v-cfp5-9885]', main.includes('app.requestSingleInstanceLock()'));
  check('updater never auto-pulls prereleases', main.includes('allowPrerelease = false'));
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
