const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const scratchDir = path.join('C:', 'Users', 'maksi', '.gemini', 'antigravity-ide', 'brain', '313fb2fb-7a01-4d1a-8b26-bc26d2b80508', 'scratch');

    const winMain = new BrowserWindow({
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
    await winMain.loadFile(indexPath);
    await new Promise(r => setTimeout(r, 1200));

    // Force hide intro overlay, open sidebar with History panel
    await winMain.webContents.executeJavaScript(`
        const intro = document.getElementById('intro-overlay');
        if (intro) intro.style.display = 'none';
        const skip = document.getElementById('intro-skip');
        if (skip) skip.style.display = 'none';

        // Mock window.mauzer history if needed for visual render
        if (window.mauzer && window.mauzer.history) {
            window.mauzer.history.get = async () => [
                { id: '1', title: 'GitHub: Let’s build from here', url: 'https://github.com', timestamp: Date.now() },
                { id: '2', title: 'Google Search: Mauzer Browser', url: 'https://google.com', timestamp: Date.now() - 3600000 },
                { id: '3', title: 'YouTube: Music & Videos', url: 'https://youtube.com', timestamp: Date.now() - 86400000 }
            ];
            window.mauzer.bookmarks.get = async () => [
                { id: 'b1', title: 'GitHub', url: 'https://github.com' },
                { id: 'b2', title: 'Mauzer Project', url: 'https://mauzer.app' }
            ];
        }
        
        const sb = document.getElementById('sidebar');
        if (sb) {
            sb.style.display = '';
            sb.classList.add('open');
        }
        const btnHistory = document.querySelector('.sidebar-tab[data-panel="history"]');
        if (btnHistory) btnHistory.click();
    `);
    await new Promise(r => setTimeout(r, 600));

    let imgSidebar = await winMain.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'browser_sidebar_history_rendered.png'), imgSidebar.toPNG());

    // Switch to Bookmarks
    await winMain.webContents.executeJavaScript(`
        const btnBookmarks = document.querySelector('.sidebar-tab[data-panel="bookmarks"]');
        if (btnBookmarks) btnBookmarks.click();
    `);
    await new Promise(r => setTimeout(r, 400));
    let imgBookmarks = await winMain.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'browser_sidebar_bookmarks_rendered.png'), imgBookmarks.toPNG());

    winMain.close();
    app.quit();
});
