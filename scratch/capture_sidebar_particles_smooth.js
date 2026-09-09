const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    await win.loadFile(path.join(__dirname, '../src/newtab.html'));
    await new Promise(r => setTimeout(r, 600));

    // Capture closed sidebar state (full width)
    const imgClosed = await win.webContents.capturePage();
    require('fs').writeFileSync(path.join(__dirname, 'particles_smooth_closed.png'), imgClosed.toPNG());

    // Simulate open sidebar (shrunk by 260px)
    await win.setSize(1020, 800);
    await win.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'));");
    await new Promise(r => setTimeout(r, 400));

    // Capture open sidebar state
    const imgOpen = await win.webContents.capturePage();
    require('fs').writeFileSync(path.join(__dirname, 'particles_smooth_open.png'), imgOpen.toPNG());

    console.log('Screenshots saved successfully');
    app.quit();
});
