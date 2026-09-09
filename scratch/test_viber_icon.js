const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const viberPath = 'C:\\Users\\maksi\\Downloads\\ViberSetup.exe';
    const icon = await app.getFileIcon(viberPath, { size: 'normal' });
    const buffer = icon.toPNG();
    const outPath = path.join(__dirname, 'viber_icon.png');
    fs.writeFileSync(outPath, buffer);
    console.log('Saved viber icon to:', outPath, 'bytes:', buffer.length);
    app.quit();
});
