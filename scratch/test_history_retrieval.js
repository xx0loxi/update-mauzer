const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js')
        }
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'newtab.html'));
    const result = await win.webContents.executeJavaScript(`
        (async () => {
            if (window.mauzer && window.mauzer.history) {
                return await window.mauzer.history.get();
            }
            return 'no-api';
        })()
    `);
    console.log('History sample:', Array.isArray(result) ? result.slice(0, 5) : result);
    app.quit();
});
