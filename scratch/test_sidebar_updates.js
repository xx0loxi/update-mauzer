const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const scratchDir = path.join('C:', 'Users', 'maksi', '.gemini', 'antigravity-ide', 'brain', '313fb2fb-7a01-4d1a-8b26-bc26d2b80508', 'scratch');

    // 1. Test Settings Window
    const winSettings = new BrowserWindow({
        width: 1100,
        height: 750,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    const settingsPath = path.join(__dirname, '..', 'src', 'settings.html');
    await winSettings.loadFile(settingsPath);
    await new Promise(r => setTimeout(r, 600));

    // Check that Yandex is not in searchEngine select
    const hasYandex = await winSettings.webContents.executeJavaScript(`
        !!document.querySelector('select[data-key="searchEngine"] option[value="yandex"]')
    `);
    console.log('Settings: has Yandex option? ->', hasYandex);

    // Initial state screenshot (sec-general active)
    const active1 = await winSettings.webContents.executeJavaScript(`
        document.querySelector('.nav-item.active')?.dataset.target
    `);
    console.log('Settings: initial active nav item ->', active1);
    let imgTop = await winSettings.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'settings_top_fixed.png'), imgTop.toPNG());

    // Scroll to Privacy section
    await winSettings.webContents.executeJavaScript(`
        const el = document.getElementById('sec-privacy');
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
        window.dispatchEvent(new Event('scroll'));
    `);
    await new Promise(r => setTimeout(r, 400));
    const activePrivacy = await winSettings.webContents.executeJavaScript(`
        document.querySelector('.nav-item.active')?.dataset.target
    `);
    console.log('Settings: scrolled to privacy, active nav item ->', activePrivacy);
    let imgPrivacy = await winSettings.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'settings_scroll_privacy.png'), imgPrivacy.toPNG());

    // Scroll to bottom (About section)
    await winSettings.webContents.executeJavaScript(`
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.dispatchEvent(new Event('scroll'));
    `);
    await new Promise(r => setTimeout(r, 400));
    const activeAbout = await winSettings.webContents.executeJavaScript(`
        document.querySelector('.nav-item.active')?.dataset.target
    `);
    console.log('Settings: scrolled to bottom, active nav item ->', activeAbout);
    let imgAbout = await winSettings.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'settings_scroll_about.png'), imgAbout.toPNG());

    winSettings.close();

    // 2. Test Main Browser UI Sidebar
    const winMain = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });

    const indexPath = path.join(__dirname, '..', 'src', 'index.html');
    await winMain.loadFile(indexPath);
    await new Promise(r => setTimeout(r, 800));

    // Open sidebar and inspect tabs
    const sidebarInfo = await winMain.webContents.executeJavaScript(`
        (async () => {
            const btn = document.getElementById('btn-sidebar');
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            const tabs = Array.from(document.querySelectorAll('.sidebar-tab')).map(t => ({
                panel: t.dataset.panel,
                title: t.getAttribute('title'),
                active: t.classList.contains('active')
            }));
            return {
                tabs,
                open: document.getElementById('sidebar')?.classList.contains('open') || document.getElementById('sidebar')?.style.display !== 'none'
            };
        })()
    `);
    console.log('Browser Sidebar info:', JSON.stringify(sidebarInfo, null, 2));

    let imgSidebar = await winMain.webContents.capturePage();
    fs.writeFileSync(path.join(scratchDir, 'browser_sidebar_updated.png'), imgSidebar.toPNG());

    winMain.close();
    app.quit();
});
