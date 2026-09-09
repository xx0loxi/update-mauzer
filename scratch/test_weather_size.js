const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 800 });
    await win.loadFile(path.join(__dirname, '..', 'src', 'newtab.html'));
    await new Promise(r => setTimeout(r, 600));

    // Capture collapsed
    const shotCollapsed = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'test_weather_collapsed.png'), shotCollapsed.toPNG());

    // Click to expand
    await win.webContents.executeJavaScript(`
        document.getElementById('weather-widget').click();
    `);
    await new Promise(r => setTimeout(r, 500));

    const shotExpanded = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'test_weather_expanded.png'), shotExpanded.toPNG());

    const expandedSize = await win.webContents.executeJavaScript(`
        (() => {
            const w = document.getElementById('weather-widget');
            const r = w.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
        })()
    `);
    console.log('Expanded weather size:', expandedSize);
    app.quit();
});
