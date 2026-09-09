const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
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

    win.webContents.on('console-message', (e, lvl, msg) => console.log('RENDERER:', msg));

    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1000));

    const sbBefore = await win.webContents.executeJavaScript('document.getElementById("sidebar").outerHTML');
    console.log('SB BEFORE:', sbBefore.substring(0, 100));

    await win.webContents.executeJavaScript('document.getElementById("btn-sidebar").click()');
    await new Promise(r => setTimeout(r, 500));

    const sbAfter = await win.webContents.executeJavaScript('document.getElementById("sidebar").outerHTML');
    console.log('SB AFTER:', sbAfter.substring(0, 120));

    const sbStyle = await win.webContents.executeJavaScript(`
        const el = document.getElementById("sidebar");
        const s = window.getComputedStyle(el);
        JSON.stringify({ display: s.display, width: s.width, marginLeft: s.marginLeft, opacity: s.opacity, classes: el.className })
    `);
    console.log('SB COMPUTED STYLE:', sbStyle);

    app.quit();
});
