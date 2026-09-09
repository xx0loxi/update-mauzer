const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    ipcMain.handle('settings:load', () => ({ theme: 'dark', language: 'ru', lastIntroVersion: '1.1.19' }));
    ipcMain.handle('app:getInfo', () => ({ version: '1.1.19' }));
    ipcMain.handle('app:getPreloadPath', () => path.join(__dirname, '..', 'preload.js'));
    ipcMain.handle('sessions:loadCurrent', () => null);
    ipcMain.handle('sessions:saveCurrent', () => null);
    ipcMain.handle('pulse:get-state', () => ({ stats: { blocked: 0 } }));
    ipcMain.handle('bookmarks:get', () => [
        { id: 'b1', title: 'GitHub', url: 'https://github.com' },
        { id: 'b2', title: 'Facebook', url: 'https://facebook.com' }
    ]);
    ipcMain.handle('history:get', () => [
        { id: 'h1', title: 'GitHub: Let’s build from here', url: 'https://github.com', timestamp: Date.now() },
        { id: 'h2', title: 'Facebook: Log in or sign up', url: 'https://facebook.com', timestamp: Date.now() - 3600000 },
        { id: 'h3', title: 'Google Search', url: 'https://google.com', timestamp: Date.now() - 86400000 }
    ]);
    ipcMain.handle('downloads:get', () => []);
    ipcMain.handle('readinglist:get', () => []);
    ipcMain.handle('quicklinks:get', () => []);

    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: true,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true
        }
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 600));

    // Click sidebar toggle
    await win.webContents.executeJavaScript(`
        document.getElementById('btn-sidebar').click();
    `);
    await new Promise(r => setTimeout(r, 600));

    const res = await win.webContents.executeJavaScript(`
        const s = document.getElementById('sidebar');
        const w = document.getElementById('webview-container');
        const sr = s.getBoundingClientRect();
        const wr = w.getBoundingClientRect();
        ({
            sidebarRect: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
            webviewRect: { x: wr.x, y: wr.y, width: wr.width, height: wr.height },
            sidebarDisplay: s.style.display,
            sidebarClasses: s.className,
            sidebarMarginLeft: getComputedStyle(s).marginLeft,
            sidebarZIndex: getComputedStyle(s).zIndex,
            webviewZIndex: getComputedStyle(w).zIndex
        })
    `);
    console.log('SIDEBAR RECTS:', res);
    const panelHtml = await win.webContents.executeJavaScript('document.getElementById("sidebar-panel").innerHTML');
    console.log('PANEL HTML:', panelHtml);

    const shot = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'sidebar_smooth_opened.png'), shot.toPNG());
    console.log('Saved sidebar_smooth_opened.png successfully');

    app.quit();
});
