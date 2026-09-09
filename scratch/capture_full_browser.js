const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Register minimal IPC handlers so app.js initializes cleanly
ipcMain.handle('settings:load', () => ({
    language: 'ru', theme: 'dark', accentColor: '#808080', searchEngine: 'google'
}));
ipcMain.handle('settings:save', () => true);
ipcMain.handle('pulse:get-state', () => ({
    adBlockEnabled: true, httpsOnly: false, fingerprintProtection: true,
    totalBlockedAds: 1254, totalHttpsUpgrades: 48, activeRulesCount: 230000
}));
ipcMain.handle('history:get', () => [
    { id: '1', title: 'GitHub — Build software better, together', url: 'https://github.com', timestamp: Date.now() - 600000 },
    { id: '2', title: 'Habr: Сообщество IT-специалистов', url: 'https://habr.com', timestamp: Date.now() - 3600000 },
    { id: '3', title: 'YouTube: Видео и стримы онлайн', url: 'https://youtube.com', timestamp: Date.now() - 86400000 }
]);
ipcMain.handle('bookmarks:get', () => [
    { id: 'b1', title: 'GitHub', url: 'https://github.com' },
    { id: 'b2', title: 'Mauzer Browser', url: 'https://mauzer.app' },
    { id: 'b3', title: 'Google', url: 'https://google.com' }
]);
ipcMain.handle('downloads:get', () => [
    { id: 'd1', filename: 'Mauzer-Setup-1.1.19.exe', totalBytes: 145000000, path: 'C:\\Users\\maksi\\Downloads\\Mauzer-Setup-1.1.19.exe' },
    { id: 'd2', filename: 'update-notes.pdf', totalBytes: 1240000, path: 'C:\\Users\\maksi\\Downloads\\update-notes.pdf' }
]);
ipcMain.handle('readinglist:get', () => [
    { id: 'r1', title: 'Современная архитектура Electron браузеров', url: 'https://habr.com/post/123' }
]);
ipcMain.handle('updater:get-state', () => ({ updateAvailable: false }));
ipcMain.handle('app:version', () => '1.1.19');
ipcMain.handle('system:ram', () => ({ total: 16000, free: 8000 }));

app.whenReady().then(async () => {
    const scratchDir = path.join('C:', 'Users', 'maksi', '.gemini', 'antigravity-ide', 'brain', '313fb2fb-7a01-4d1a-8b26-bc26d2b80508', 'scratch');

    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });

    const indexPath = path.join(__dirname, '..', 'src', 'index.html');
    await win.loadFile(indexPath);
    await new Promise(r => setTimeout(r, 1000));

    // Open sidebar and render history
    await win.webContents.executeJavaScript(`
        const intro = document.getElementById('intro-overlay');
        if (intro) intro.remove();
        const skip = document.getElementById('intro-skip');
        if (skip) skip.remove();

        const btnSidebar = document.getElementById('btn-sidebar');
        btnSidebar.click();
    `);
    await new Promise(r => setTimeout(r, 500));

    let imgHistory = await win.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'real_browser_sidebar_history.png'), imgHistory.toPNG());

    // Switch to Bookmarks
    await win.webContents.executeJavaScript(`
        document.querySelector('.sidebar-tab[data-panel="bookmarks"]').click();
    `);
    await new Promise(r => setTimeout(r, 400));
    let imgBookmarks = await win.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'real_browser_sidebar_bookmarks.png'), imgBookmarks.toPNG());

    // Switch to Downloads
    await win.webContents.executeJavaScript(`
        document.querySelector('.sidebar-tab[data-panel="downloads"]').click();
    `);
    await new Promise(r => setTimeout(r, 400));
    let imgDownloads = await win.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'real_browser_sidebar_downloads.png'), imgDownloads.toPNG());

    win.close();
    app.quit();
});
