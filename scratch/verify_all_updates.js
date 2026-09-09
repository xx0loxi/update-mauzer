const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    // 1. Verify newtab modal & chips
    const newtabWin = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    await newtabWin.loadFile(path.join(__dirname, '..', 'src', 'newtab.html'));
    await new Promise(r => setTimeout(r, 600));

    // Open add modal and click Facebook chip
    await newtabWin.webContents.executeJavaScript(`
        openAddModal();
        const fbChip = Array.from(document.querySelectorAll('.modal-chip')).find(c => c.dataset.title === 'Facebook');
        if (fbChip) fbChip.click();
    `);
    await new Promise(r => setTimeout(r, 400));

    const modalShot = await newtabWin.capturePage();
    fs.writeFileSync(path.join(__dirname, 'modal_with_facebook.png'), modalShot.toPNG());
    console.log('Saved modal_with_facebook.png');

    newtabWin.close();

    // 2. Verify main window address bar & sidebar
    const mainWin = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'preload.js'),
            webviewTag: true
        }
    });

    await mainWin.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    await new Promise(r => setTimeout(r, 1000));

    // Capture normal address bar
    const barNormal = await mainWin.capturePage();
    fs.writeFileSync(path.join(__dirname, 'address_bar_normal.png'), barNormal.toPNG());
    console.log('Saved address_bar_normal.png');

    // Focus address bar
    await mainWin.webContents.executeJavaScript(`
        const inp = document.getElementById('url-input');
        if (inp) {
            inp.focus();
            inp.value = 'https://facebook.com';
        }
    `);
    await new Promise(r => setTimeout(r, 300));

    const barFocused = await mainWin.capturePage();
    fs.writeFileSync(path.join(__dirname, 'address_bar_focused.png'), barFocused.toPNG());
    console.log('Saved address_bar_focused.png');

    // Open sidebar and render sample items
    await mainWin.webContents.executeJavaScript(`
        if (window.mauzer && window.mauzer.history) {
            window.mauzer.history.get = async () => [
                { id: '1', title: 'GitHub - Where the world builds software', url: 'https://github.com', timestamp: Date.now() },
                { id: '2', title: 'YouTube: Watch videos online', url: 'https://youtube.com', timestamp: Date.now() - 3600000 },
                { id: '3', title: 'Facebook - Connect with friends', url: 'https://facebook.com', timestamp: Date.now() - 7200000 }
            ];
        }
        openSidebar('history');
    `);
    await new Promise(r => setTimeout(r, 600));

    const sidebarShot = await mainWin.capturePage();
    fs.writeFileSync(path.join(__dirname, 'sidebar_smooth_opened.png'), sidebarShot.toPNG());
    console.log('Saved sidebar_smooth_opened.png');

    mainWin.close();
    app.quit();
});
