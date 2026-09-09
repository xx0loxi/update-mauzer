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
    const viberPath = 'C:\\Users\\maksi\\Downloads\\ViberSetup.exe';
    let iconUrl = null;
    try {
        const icon = await app.getFileIcon(viberPath, { size: 'normal' });
        if (icon && !icon.isEmpty()) iconUrl = icon.toDataURL();
    } catch (_) {}

    ipcMain.handle('downloads:get', () => [
        { filename: 'ViberSetup.exe', path: viberPath, iconUrl, totalBytes: 2684376, receivedBytes: 2684376, state: 'completed' },
        { filename: 'Antigravity IDE.exe', path: 'C:\\Users\\maksi\\Downloads\\Antigravity IDE.exe', totalBytes: 227712776, receivedBytes: 227712776, state: 'completed' }
    ]);
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

    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 600));

    // Open sidebar and go to downloads
    await win.webContents.executeJavaScript(`
        document.getElementById('btn-sidebar').click();
    `);
    await new Promise(r => setTimeout(r, 300));
    await win.webContents.executeJavaScript(`
        const tab = document.querySelector('.sidebar-tab[data-panel="downloads"]');
        if (tab) tab.click();
    `);
    await new Promise(r => setTimeout(r, 500));

    const imgSidebar = await win.webContents.capturePage({ x: 0, y: 0, width: 340, height: 500 });
    fs.writeFileSync(path.join(__dirname, 'test_downloads_sidebar.png'), imgSidebar.toPNG());
    console.log('[Test] Saved test_downloads_sidebar.png');

    win.close();
    app.quit();
});
