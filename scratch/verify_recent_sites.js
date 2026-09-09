const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'newtab.html'));
    await new Promise(r => setTimeout(r, 1000));

    const metrics = await win.webContents.executeJavaScript(`
        (() => {
            const logo = document.querySelector('.logo-block').getBoundingClientRect();
            const recent = document.getElementById('recent-sites-wrap').getBoundingClientRect();
            const search = document.querySelector('.search-wrap').getBoundingClientRect();
            const chips = document.querySelectorAll('.recent-chip');
            return {
                logo: { top: Math.round(logo.top), bottom: Math.round(logo.bottom) },
                recent: { top: Math.round(recent.top), bottom: Math.round(recent.bottom), count: chips.length },
                search: { top: Math.round(search.top), bottom: Math.round(search.bottom) },
                gapLogoToRecent: Math.round(recent.top - logo.bottom),
                gapRecentToSearch: Math.round(search.top - recent.bottom)
            };
        })()
    `);
    console.log('Layout metrics:', metrics);

    const shotDark = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'recent_sites_dark.png'), shotDark.toPNG());

    // Switch to light theme
    await win.webContents.executeJavaScript(`
        document.documentElement.setAttribute('data-theme', 'light');
    `);
    await new Promise(r => setTimeout(r, 300));

    const shotLight = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'recent_sites_light.png'), shotLight.toPNG());

    console.log('Recent sites verification completed!');
    app.quit();
});
