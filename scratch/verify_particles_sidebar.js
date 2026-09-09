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

    // Wait for canvas to initialize
    await new Promise(r => setTimeout(r, 600));

    // Get initial state
    const initial = await win.webContents.executeJavaScript(`
        (() => {
            const canvas = document.getElementById('fx-canvas');
            return {
                width: canvas.width,
                height: canvas.height,
                styleWidth: canvas.style.width,
                styleHeight: canvas.style.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight
            };
        })()
    `);
    console.log('Initial Canvas State:', initial);

    // Simulate sidebar opening: resize the window/viewport by 260px
    await win.setSize(940, 800);
    // Trigger resize event
    await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'));`);
    await new Promise(r => setTimeout(r, 400));

    const afterSidebarOpen = await win.webContents.executeJavaScript(`
        (() => {
            const canvas = document.getElementById('fx-canvas');
            return {
                width: canvas.width,
                height: canvas.height,
                styleWidth: canvas.style.width,
                styleHeight: canvas.style.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight
            };
        })()
    `);
    console.log('After Sidebar Open (viewport shrunk by 260px):', afterSidebarOpen);

    // Simulate sidebar closing
    await win.setSize(1200, 800);
    await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'));`);
    await new Promise(r => setTimeout(r, 400));

    const afterSidebarClose = await win.webContents.executeJavaScript(`
        (() => {
            const canvas = document.getElementById('fx-canvas');
            return {
                width: canvas.width,
                height: canvas.height,
                styleWidth: canvas.style.width,
                styleHeight: canvas.style.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight
            };
        })()
    `);
    console.log('After Sidebar Close:', afterSidebarClose);

    const isBufferStable = (
        initial.width === afterSidebarOpen.width &&
        initial.height === afterSidebarOpen.height &&
        initial.width === afterSidebarClose.width &&
        initial.height === afterSidebarClose.height &&
        initial.styleWidth === afterSidebarOpen.styleWidth &&
        initial.styleHeight === afterSidebarOpen.styleHeight
    );

    console.log('Is Canvas 100% Buffer Stable across Sidebar Toggles?', isBufferStable);

    if (isBufferStable) {
        console.log('SUCCESS: Zero buffer reallocations, zero stretching, zero twitching!');
    } else {
        console.error('FAILURE: Canvas dimensions shifted!');
        process.exit(1);
    }

    app.quit();
});
