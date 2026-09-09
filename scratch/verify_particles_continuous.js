const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    await win.loadFile(path.join(__dirname, '../src/newtab.html'));
    await new Promise(r => setTimeout(r, 600));

    // Toggle viewport size 5 times in rapid succession (simulating opening/closing sidebar fast)
    for (let i = 0; i < 5; i++) {
        await win.setSize(940, 800);
        await win.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'));");
        await new Promise(r => setTimeout(r, 60));
        await win.setSize(1200, 800);
        await win.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'));");
        await new Promise(r => setTimeout(r, 60));
    }

    const finalState = await win.webContents.executeJavaScript(`
        (() => {
            const canvas = document.getElementById('fx-canvas');
            return {
                w: canvas.width,
                h: canvas.height,
                styleW: canvas.style.width,
                styleH: canvas.style.height
            };
        })()
    `);
    console.log('Final state after 5 rapid sidebar toggles:', finalState);

    if (finalState.w === 1920 && finalState.h === 1080) {
        console.log('PASS: Canvas maintained 100% rock-solid resolution and state through rapid toggles.');
    } else {
        console.error('FAIL');
        process.exit(1);
    }

    app.quit();
});
