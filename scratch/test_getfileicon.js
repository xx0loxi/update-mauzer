const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    console.log('app.getFileIcon type:', typeof app.getFileIcon);
    const downloads = app.getPath('downloads');
    const files = fs.readdirSync(downloads);
    console.log('Downloads dir:', downloads, 'Files count:', files.length);
    const exe = files.find(f => f.toLowerCase().endsWith('.exe'));
    try {
        const nonExistent = path.join(downloads, 'some_random_file.exe');
        console.log('Testing nonexistent path:', nonExistent);
        const icon = await app.getFileIcon(nonExistent, { size: 'normal' });
        console.log('Got nonexistent icon size:', icon.getSize(), 'isEmpty:', icon.isEmpty(), 'dataUrl len:', icon.toDataURL().length);
    } catch (e) {
        console.log('Error on nonexistent path:', e.message);
    }
    app.quit();
});
