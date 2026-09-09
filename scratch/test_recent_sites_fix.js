const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Mock history:get returning item with corrupted title 'MAUZER' from earlier navigation
    ipcMain.handle('history:get', async () => {
        return [
            { id: '1', url: 'https://www.youtube.com', title: 'MAUZER', favicon: '', timestamp: Date.now() },
            { id: '2', url: 'https://github.com', title: 'GitHub: Let’s build from here', favicon: '', timestamp: Date.now() - 1000 },
            { id: '3', url: 'https://reddit.com', title: 'MAUZER', favicon: '', timestamp: Date.now() - 2000 }
        ];
    });

    ipcMain.handle('settings:load', async () => ({ theme: 'dark' }));
    ipcMain.handle('quicklinks:get', async () => []);
    ipcMain.handle('notes:get', async () => []);
    ipcMain.handle('reading-list:get', async () => []);

    const newtabPath = path.join(__dirname, '..', 'src', 'newtab.html');
    await win.loadFile(newtabPath);

    // Wait for JS to render
    await new Promise(r => setTimeout(r, 1500));

    // Evaluate recent chips rendered in DOM
    const chipsInfo = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('.recent-chip')).map(c => ({
            title: c.querySelector('.recent-chip-title')?.textContent,
            letter: c.querySelector('.recent-chip-letter')?.textContent,
            bg: c.querySelector('.recent-chip-letter')?.style.background,
            href: c.href
        }))
    `);

    console.log('RENDERED CHIPS:', JSON.stringify(chipsInfo, null, 2));

    const shotPath = path.join(__dirname, 'recent_sites_fix_verified.png');
    const img = await win.capturePage();
    fs.writeFileSync(shotPath, img.toPNG());
    console.log('Saved screenshot to:', shotPath);

    app.quit();
});
