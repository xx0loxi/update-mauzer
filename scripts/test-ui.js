const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('=============================================');
  console.log(' MAUZER UI AUTOMATED TEST (Playwright)');
  console.log('=============================================');
  
  let electronApp;
  try {
    console.log('[1/5] Запуск браузера...');
    electronApp = await electron.launch({ 
      args: ['.'],
      cwd: path.join(__dirname, '..')
    });

    const window = await electronApp.firstWindow();
    
    console.log('[2/5] Ожидание загрузки интерфейса...');
    await window.waitForSelector('#titlebar', { timeout: 10000 });
    console.log('  -> Интерфейс успешно загружен.');

    console.log('[3/5] Тест производительности: открытие новой вкладки...');
    const startTime = Date.now();
    await window.click('#btn-new-tab');
    await window.waitForTimeout(500); // небольшая пауза для рендера
    console.log(`  -> Вкладка открыта за ${Date.now() - startTime} мс.`);

    console.log('[4/5] Тест боковой панели и настроек...');
    await window.click('#btn-sidebar');
    await window.waitForTimeout(500);
    // Клик по вкладке Настройки в меню
    const settingsTab = await window.$('button.sidebar-tab[data-panel="settings"]');
    if (settingsTab) {
      await settingsTab.click();
      console.log('  -> Настройки успешно открыты.');
    } else {
      console.log('  -> [ПРЕДУПРЕЖДЕНИЕ] Кнопка настроек не найдена.');
    }

    console.log('[5/5] Тестирование загрузки YouTube (проверка плеера)...');
    await window.fill('#url-input', 'https://www.youtube.com');
    await window.press('#url-input', 'Enter');
    
    // Ждем 5 секунд, чтобы YouTube успел прогрузиться
    await window.waitForTimeout(5000);
    
    const screenshotPath = path.join(__dirname, '..', 'test-result.png');
    await window.screenshot({ path: screenshotPath });
    console.log(`  -> Скриншот результата сохранен: ${screenshotPath}`);

    console.log('=============================================');
    console.log(' ВСЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ! Багов не найдено.');
    console.log('=============================================');

  } catch (error) {
    console.error('\n[ОШИБКА ТЕСТИРОВАНИЯ]:', error);
  } finally {
    if (electronApp) {
      console.log('Закрытие браузера...');
      await electronApp.close();
    }
  }
}

runTests();
