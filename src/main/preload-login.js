// ============================================================
// MAUZER BROWSER — Login Preload (Anti-Fingerprint)
// Runs BEFORE Google's scripts to prevent detection and disable Passkeys
// ============================================================

const CHROME_VERSION = '120.0.0.0';

try {
  // 1. CRITICAL: Hide WebDriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  
  // 2. CRITICAL: Kill WebAuthn / Passkeys (Prevents "Windows Security" popup)
  try {
    delete window.PublicKeyCredential;
    Object.defineProperty(navigator, 'credentials', { get: () => undefined });
  } catch(e) {}

  // 3. Mock Chrome Object (Advanced Stealth)
  if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
      writable: true,
      enumerable: true,
      configurable: false,
      value: {} // Let scripts modify it if they want
    });
  }

  // Ensure 'runtime' exists
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

  // Ensure 'app' exists
  if (!window.chrome.app) {
    window.chrome.app = { 
      isInstalled: false, 
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, 
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
      installState: function() { return 'not_installed'; },
      runningState: function() { return 'cannot_run'; }
    };
  }

  // Ensure 'csi' and 'loadTimes' exist
  if (!window.chrome.csi) window.chrome.csi = function() { return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 }; };
  if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { 
    return { 
      getLoadTime: () => 0, 
      getNavType: () => 'Other', 
      getNavigationType: () => 'Other', 
      wasFetchedViaSpdy: () => true, 
      wasNpnNegotiated: () => true, 
      wasAlternateProtocolAvailable: () => false, 
      connectionInfo: 'h2', 
      firstPaintAfterLoadTime: 0, 
      firstPaintTime: 0, 
      finishDocumentLoadTime: 0, 
      finishLoadTime: 0, 
      domContentLoadedEventEnd: 0, 
      domContentLoadedEventStart: 0, 
      navigationStart: 0, 
      requestTime: 0, 
      startLoadTime: 0, 
      commitLoadTime: 0 
    }; 
  };

  // 4. Mock Permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // 5. Override User Agent Data (Client Hints)
  if (navigator.userAgentData) {
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Not_A Brand', version: '8' },
          { brand: 'Chromium', version: '120' },
          { brand: 'Google Chrome', version: '120' }
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            architecture: 'x86',
            bitness: '64',
            brands: this.brands,
            fullVersionList: [
              { brand: 'Not_A Brand', version: '8.0.0.0' },
              { brand: 'Chromium', version: CHROME_VERSION },
              { brand: 'Google Chrome', version: CHROME_VERSION }
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
  delete window.electron;
  
  if (typeof process !== 'undefined') {
    try {
        process.once('loaded', () => {
            global.process = undefined;
            global.electron = undefined;
        });
    } catch(e) {}
  }
  
  // 7. Mock Plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
      ];
      arr.item = function(index) { return this[index]; };
      arr.namedItem = function(name) { return this.find(p => p.name === name); };
      arr.refresh = function() {};
      return arr;
    }
  });
  
  Object.defineProperty(navigator, 'mimeTypes', { get: () => [] });

  // 8. Mock Languages
  Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
  
  // 9. Remove CDC fingerprint
  try {
      const proto = Object.getPrototypeOf(document);
      if (proto && proto.$cdc_asdjflasutopfhvcZLmcfl_) {
          delete proto.$cdc_asdjflasutopfhvcZLmcfl_;
      }
  } catch(e) {}

} catch(e) {}
