// ============================================================
// MAUZER BROWSER — Login Preload (Anti-Fingerprint)
// Runs BEFORE Google's scripts to prevent detection and disable Passkeys
// ============================================================

const CHROME_VERSION = '124.0.6367.207';

try {
  // 1. CRITICAL: Hide WebDriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. CRITICAL: Kill WebAuthn / Passkeys
  delete window.PublicKeyCredential;
  delete navigator.credentials;

  // 3. Mock Chrome Object
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function(){},
      sendMessage: function(){},
      id: 'bgnowghclckkdicbadhimaapfiibcpdd', // Fake ID
      getManifest: function() { return { version: '1.0.0' }; },
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
  if (!window.chrome.csi) window.chrome.csi = function() { return { onloadT: Date.now(), pageT: Date.now(), startE: Date.now(), tran: 15 }; };
  if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { 
    return {
      getLoadTime: () => Date.now() / 1000,
      getStartLoadTime: () => Date.now() / 1000,
      commitLoadTime: () => Date.now() / 1000,
      requestTime: () => Date.now() / 1000,
      startLoadTime: () => Date.now() / 1000,
      wasFetchedViaSpdy: () => true,
      wasNpnNegotiated: () => true,
      npnNegotiatedProtocol: () => 'h2',
      wasAlternateProtocolAvailable: () => false,
      connectionInfo: () => 'h2'
    }; 
  };

  // 4. Mock Permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // 5. Override User Agent Data
  if (navigator.userAgentData) {
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Chromium', version: '124' },
          { brand: 'Google Chrome', version: '124' },
          { brand: 'Not-A.Brand', version: '99' }
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            architecture: 'x86',
            bitness: '64',
            brands: this.brands,
            fullVersionList: [
              { brand: 'Chromium', version: CHROME_VERSION },
              { brand: 'Google Chrome', version: CHROME_VERSION },
              { brand: 'Not-A.Brand', version: '99.0.0.0' }
            ],
            mobile: false,
            model: '',
            platform: 'Windows',
            platformVersion: '10.0.0',
            uaFullVersion: CHROME_VERSION
          });
        }
      })
    });
  }

  // 6. Hide Electron Globals
  delete window.process;
  delete window.require;
  delete window.__electron_preload;
  delete window.Buffer;
  
  // 7. Mock Plugins
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
  
  // 8. Mock Languages
  Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
  
} catch(e) {}