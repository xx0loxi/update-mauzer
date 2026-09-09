const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

app.whenReady().then(async () => {
    ipcMain.handle('settings:load', () => ({ theme: 'dark', language: 'ru', lastIntroVersion: '1.1.19' }));
    ipcMain.handle('app:getInfo', () => ({ version: '1.1.19' }));
    ipcMain.handle('app:getPreloadPath', () => path.join(__dirname, '..', 'preload.js'));
    ipcMain.handle('sessions:loadCurrent', () => null);
    ipcMain.handle('sessions:saveCurrent', () => null);
    ipcMain.handle('pulse:get-state', () => ({ stats: { blocked: 0 } }));
    ipcMain.handle('bookmarks:get', () => []);
    ipcMain.handle('history:get', () => []);
    ipcMain.handle('downloads:get', () => []);
    ipcMain.handle('downloads:clear', () => true);
    ipcMain.handle('downloads:open', () => true);
    ipcMain.handle('downloads:showInFolder', () => true);
    ipcMain.handle('downloads:openFolder', () => true);
    ipcMain.handle('downloads:getFileIcon', async (_, filepath) => {
        try {
            const icon = await app.getFileIcon(filepath, { size: 'normal' });
            return icon && !icon.isEmpty() ? icon.toDataURL() : null;
        } catch (_) { return null; }
    });

    win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: true,
        backgroundColor: '#0a0a0c',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        }
    });

    const indexHtml = path.join(__dirname, '..', 'src', 'index.html');
    await win.loadFile(indexHtml);

    console.log('[Test] Window loaded index.html');
    await new Promise(r => setTimeout(r, 600));

    // Emulate download complete event for ViberSetup.exe which exists in Downloads
    const viberPath = 'C:\\Users\\maksi\\Downloads\\ViberSetup.exe';
    let iconUrl = null;
    try {
        const icon = await app.getFileIcon(viberPath, { size: 'normal' });
        if (icon && !icon.isEmpty()) {
            iconUrl = icon.toDataURL();
        }
    } catch (e) {
        console.error('Failed to get icon:', e);
    }

    console.log('[Test] Viber icon extracted, length:', iconUrl ? iconUrl.length : 0);

    // 1. Simulate download-complete for 2 files to test badge counter
    win.webContents.send('download-complete', {
        filename: 'ViberSetup.exe',
        path: viberPath,
        iconUrl: iconUrl,
        totalBytes: 2684376,
        receivedBytes: 2684376,
        state: 'completed',
        timestamp: Date.now()
    });

    win.webContents.send('download-complete', {
        filename: 'Antigravity IDE.exe',
        path: 'C:\\Users\\maksi\\Downloads\\Antigravity IDE.exe',
        totalBytes: 227712776,
        receivedBytes: 227712776,
        state: 'completed',
        timestamp: Date.now()
    });

    await new Promise(r => setTimeout(r, 600));

    // Check badge status and check that NO toasts exist
    const check1 = await win.webContents.executeJavaScript(`
        (() => {
            const badge = document.getElementById('downloads-badge');
            const toasts = document.querySelectorAll('.toast');
            const cs = badge ? getComputedStyle(badge) : {};
            const rect = badge ? badge.getBoundingClientRect() : {};
            return {
                badgeDisplay: badge ? badge.style.display : null,
                computedDisplay: cs.display,
                computedVisibility: cs.visibility,
                computedOpacity: cs.opacity,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                badgeText: badge ? badge.textContent : null,
                toastCount: toasts.length
            };
        })()
    `);
    console.log('[Test] After 2 downloads completed:', JSON.stringify(check1, null, 2));

    // Capture screenshot of toolbar with badge
    const badgeRect = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.getElementById('btn-downloads');
            const r = btn.getBoundingClientRect();
            return { x: Math.round(r.x - 15), y: Math.round(r.y - 10), width: Math.round(r.width + 30), height: Math.round(r.height + 20) };
        })()
    `);
    const imgBadge = await win.webContents.capturePage(badgeRect);
    fs.writeFileSync(path.join(__dirname, 'test_downloads_badge.png'), imgBadge.toPNG());
    console.log('[Test] Saved test_downloads_badge.png at', badgeRect);

    // 2. Now open the downloads panel by clicking btn-downloads
    await win.webContents.executeJavaScript(`
        document.getElementById('btn-downloads').click();
    `);

    await new Promise(r => setTimeout(r, 700));

    const check2 = await win.webContents.executeJavaScript(`
        (() => {
            const badge = document.getElementById('downloads-badge');
            const panel = document.getElementById('downloads-panel');
            const items = panel ? panel.querySelectorAll('.dl-item') : [];
            const firstItemIcon = items.length > 0 ? items[0].querySelector('.dl-item-native-icon') : null;
            const r = panel ? panel.getBoundingClientRect() : {};
            return {
                badgeDisplay: badge ? badge.style.display : null,
                panelDisplay: panel ? panel.style.display : null,
                itemsCount: items.length,
                hasNativeIcon: !!firstItemIcon,
                nativeIconSrcStart: firstItemIcon ? firstItemIcon.src.slice(0, 30) : null,
                rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
            };
        })()
    `);
    console.log('[Test] After opening downloads panel:', JSON.stringify(check2, null, 2));

    // Capture screenshot of the open downloads panel
    const imgPanel = await win.webContents.capturePage(check2.rect);
    fs.writeFileSync(path.join(__dirname, 'test_downloads_panel.png'), imgPanel.toPNG());
    console.log('[Test] Saved test_downloads_panel.png at', check2.rect);

    // 3. Hover over first item to verify action buttons
    await win.webContents.executeJavaScript(`
        const first = document.querySelector('.dl-item');
        if (first) {
            first.classList.add('hover-test');
            const actions = first.querySelector('.dl-item-actions');
            if (actions) {
                actions.style.opacity = '1';
                actions.style.transform = 'none';
            }
        }
    `);
    await new Promise(r => setTimeout(r, 200));
    const imgHover = await win.webContents.capturePage(check2.rect);
    fs.writeFileSync(path.join(__dirname, 'test_downloads_hover.png'), imgHover.toPNG());
    console.log('[Test] Saved test_downloads_hover.png');

    win.close();
    app.quit();
});
