const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// ============================================================
// WINDOWS DPAPI DECRYPTION HELPERS
// ============================================================
// Chrome stores the encryption key in 'Local State' file, encrypted with DPAPI.
// Since we are in Electron on Windows, we can use `safeStorage.decryptString`
// IF Electron is running as the same user. But safeStorage uses the CURRENT app's key.
// To decrypt Chrome's key, we technically need to call the Windows CryptUnprotectData API directly.
//
// Electron's safeStorage is wrapper around DPAPI on Windows, but it prefixes data.
// Chrome's DPAPI blob doesn't have Electron's prefix.
//
// OPTION A: Use a native module like `dpapi` or `win-dpapi`.
// OPTION B: Use PowerShell to decrypt (slow but no compilation needed).
// OPTION C: Try to read without decryption (only possible for non-encrypted data).
//
// We will use a hybrid approach:
// 1. Read 'Local State' to get the encrypted key (starts with DPAPI).
// 2. Use a PowerShell one-liner to decrypt the key (Reliable fallback without native deps).
// 3. Use the decrypted key (AES-GCM) to decrypt passwords/cookies.

function getBrowserPaths() {
  const localAppData = process.env.LOCALAPPDATA || '';
  return {
    chrome: {
      name: 'Google Chrome',
      userData: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      profile: 'Default'
    },
    edge: {
      name: 'Microsoft Edge',
      userData: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      profile: 'Default'
    },
    yandex: {
      name: 'Yandex Browser',
      userData: path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data'),
      profile: 'Default'
    },
    brave: {
      name: 'Brave',
      userData: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      profile: 'Default'
    }
  };
}

// Decrypt DPAPI data using PowerShell (Avoids compiling native modules)
function decryptDpapi(encryptedBase64) {
  return new Promise((resolve) => {
    if (!encryptedBase64) return resolve(null);
    
    const psScript = `
      Add-Type -AssemblyName System.Security
      $bytes = [Convert]::FromBase64String('${encryptedBase64}')
      $decoded = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($decoded)
    `;
    
    const { exec } = require('child_process');
    exec(`powershell -NoProfile -Command "${psScript}"`, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        console.error('DPAPI Decrypt failed:', err);
        resolve(null);
      } else {
        try {
          resolve(Buffer.from(stdout.trim(), 'base64'));
        } catch (e) { resolve(null); }
      }
    });
  });
}

// Get the master key from Local State
async function getMasterKey(userDataPath) {
  try {
    const localStatePath = path.join(userDataPath, 'Local State');
    if (!fs.existsSync(localStatePath)) return null;
    
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const encryptedKey = localState.os_crypt?.encrypted_key;
    if (!encryptedKey) return null;
    
    // The key is base64 encoded and starts with 'DPAPI'
    let keyBuffer = Buffer.from(encryptedKey, 'base64');
    
    // Remove 'DPAPI' prefix (first 5 bytes)
    if (keyBuffer.slice(0, 5).toString() !== 'DPAPI') return null;
    keyBuffer = keyBuffer.slice(5);
    
    // Decrypt using DPAPI
    return await decryptDpapi(keyBuffer.toString('base64'));
  } catch (e) {
    console.error('Failed to get master key:', e);
    return null;
  }
}

// Decrypt AES-GCM value (v10 password)
function decryptValue(encryptedBuffer, masterKey) {
  try {
    // Structure: v10 (3 bytes) + Nonce (12 bytes) + CipherText + Tag (16 bytes)
    const nonce = encryptedBuffer.slice(3, 15);
    const ciphertext = encryptedBuffer.slice(15, encryptedBuffer.length - 16);
    const tag = encryptedBuffer.slice(encryptedBuffer.length - 16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (e) {
    return null;
  }
}

// ============================================================
// DATA EXTRACTORS
// ============================================================

async function importHistory(browserId) {
  const browsers = getBrowserPaths();
  const b = browsers[browserId];
  if (!b) return { count: 0, items: [] };
  
  const historyPath = path.join(b.userData, b.profile, 'History');
  if (!fs.existsSync(historyPath)) return { count: 0, items: [] };
  
  // Copy to temp to avoid lock
  const tmpPath = path.join(app.getPath('temp'), `import-hist-${Date.now()}.db`);
  fs.copyFileSync(historyPath, tmpPath);
  
  const items = [];
  try {
    const db = new Database(tmpPath, { readonly: true });
    const rows = db.prepare(`
      SELECT url, title, last_visit_time 
      FROM urls 
      ORDER BY last_visit_time DESC 
      LIMIT 5000
    `).all();
    
    for (const r of rows) {
      // Chrome time: microseconds since 1601-01-01
      // Unix time: milliseconds since 1970-01-01
      // Diff: 11644473600 seconds
      const ts = Math.floor((r.last_visit_time / 1000000) - 11644473600) * 1000;
      if (r.url && (r.url.startsWith('http') || r.url.startsWith('https'))) {
        items.push({ url: r.url, title: r.title || r.url, timestamp: ts });
      }
    }
    db.close();
  } catch (e) {
    console.error('History import failed:', e);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch(e) {}
  }
  
  return { count: items.length, items };
}

async function importBookmarks(browserId) {
  const browsers = getBrowserPaths();
  const b = browsers[browserId];
  if (!b) return { count: 0, items: [] };
  
  const bookmarksPath = path.join(b.userData, b.profile, 'Bookmarks');
  if (!fs.existsSync(bookmarksPath)) return { count: 0, items: [] };
  
  const items = [];
  try {
    const data = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
    
    function traverse(node, folder = '') {
      if (node.type === 'url') {
        items.push({
          url: node.url,
          title: node.name || node.url,
          folder: folder,
          timestamp: Date.now()
        });
      } else if (node.children) {
        const newFolder = folder ? `${folder}/${node.name}` : node.name;
        node.children.forEach(child => traverse(child, newFolder));
      }
    }
    
    if (data.roots) {
      Object.keys(data.roots).forEach(k => traverse(data.roots[k]));
    }
  } catch (e) {
    console.error('Bookmarks import failed:', e);
  }
  
  return { count: items.length, items };
}

async function importPasswords(browserId) {
  const browsers = getBrowserPaths();
  const b = browsers[browserId];
  if (!b) return { count: 0, items: [] };
  
  const loginDataPath = path.join(b.userData, b.profile, 'Login Data');
  if (!fs.existsSync(loginDataPath)) return { count: 0, items: [] };
  
  // 1. Get Master Key
  const masterKey = await getMasterKey(b.userData);
  if (!masterKey) {
    console.error('Could not decrypt master key for', b.name);
    return { count: 0, items: [], error: 'Key decryption failed' };
  }
  
  // 2. Copy DB
  const tmpPath = path.join(app.getPath('temp'), `import-pass-${Date.now()}.db`);
  fs.copyFileSync(loginDataPath, tmpPath);
  
  const items = [];
  try {
    const db = new Database(tmpPath, { readonly: true });
    const rows = db.prepare(`
      SELECT origin_url, username_value, password_value 
      FROM logins 
      WHERE blacklisted_by_user = 0
    `).all();
    
    for (const r of rows) {
      if (!r.username_value || !r.password_value) continue;
      
      let password = '';
      const buffer = r.password_value;
      
      // Check for v10 prefix (AES-GCM)
      if (buffer.length > 3 && buffer.slice(0, 3).toString() === 'v10') {
        password = decryptValue(buffer, masterKey);
      } else {
        // Fallback for older DPAPI-only encryption (rare now)
        // We can skip this or implement if needed.
        continue;
      }
      
      if (password && r.origin_url) {
        items.push({
          url: r.origin_url,
          username: r.username_value,
          password: password,
          timestamp: Date.now()
        });
      }
    }
    db.close();
  } catch (e) {
    console.error('Password import failed:', e);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch(e) {}
  }
  
  return { count: items.length, items };
}

// Detect available browsers
function detectBrowsers() {
  const paths = getBrowserPaths();
  const result = {};
  for (const [id, info] of Object.entries(paths)) {
    result[id] = { 
      name: info.name,
      exists: fs.existsSync(info.userData)
    };
  }
  return result;
}

module.exports = {
  detectBrowsers,
  importHistory,
  importBookmarks,
  importPasswords
};
