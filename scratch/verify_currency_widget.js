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
    // Wait for initial fetch
    await new Promise(r => setTimeout(r, 1200));

    // 1. Check rates rendered and bounding rects collapsed
    const collapsedMetrics = await win.webContents.executeJavaScript(`
        (() => {
            const w = document.getElementById('weather-widget').getBoundingClientRect();
            const c = document.getElementById('currency-widget').getBoundingClientRect();
            const usd = document.getElementById('currency-usd-val').textContent;
            const eur = document.getElementById('currency-eur-val').textContent;
            return {
                usd,
                eur,
                weather: { left: Math.round(w.left), top: Math.round(w.top), width: Math.round(w.width), height: Math.round(w.height), right: Math.round(w.right) },
                currency: { left: Math.round(c.left), top: Math.round(c.top), width: Math.round(c.width), height: Math.round(c.height) },
                gap: Math.round(c.left - w.right)
            };
        })()
    `);
    console.log('Collapsed metrics:', collapsedMetrics);

    const shotCollapsed = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'currency_collapsed.png'), shotCollapsed.toPNG());

    // 2. Expand weather
    await win.webContents.executeJavaScript(`
        document.getElementById('weather-widget').click();
    `);
    await new Promise(r => setTimeout(r, 450));

    const expandedMetrics = await win.webContents.executeJavaScript(`
        (() => {
            const w = document.getElementById('weather-widget').getBoundingClientRect();
            const c = document.getElementById('currency-widget').getBoundingClientRect();
            return {
                weather: { left: Math.round(w.left), top: Math.round(w.top), width: Math.round(w.width), height: Math.round(w.height), right: Math.round(w.right) },
                currency: { left: Math.round(c.left), top: Math.round(c.top), width: Math.round(c.width), height: Math.round(c.height) },
                gap: Math.round(c.left - w.right),
                noOverlap: c.left >= w.right
            };
        })()
    `);
    console.log('Expanded metrics:', expandedMetrics);

    const shotExpanded = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'currency_expanded.png'), shotExpanded.toPNG());

    // 3. Test light theme
    await win.webContents.executeJavaScript(`
        document.documentElement.setAttribute('data-theme', 'light');
        document.getElementById('weather-widget').click(); // collapse
    `);
    await new Promise(r => setTimeout(r, 400));

    const shotLight = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'currency_light.png'), shotLight.toPNG());

    console.log('Verification completed successfully!');
    app.quit();
});
