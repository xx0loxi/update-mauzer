; (function () {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================
    const state = {
        tabs: [],
        activeTabId: null,
        closedTabs: [],
        tabIdCounter: 0,
        isIncognito: false,
        sidebarOpen: false,
        sidebarPanel: 'bookmarks',
        settings: {},
        currentTheme: null,
        zoomLevels: {},
        frostTimers: {},
        frozenTabs: new Set(),
        introShown: false,
        loadTimers: {},
        commandPaletteOpen: false,
        menuOpen: false,
        downloadsList: [],
    };

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    // ============================================================
    // i18n TRANSLATIONS
    // ============================================================
    const I18N = {
        ru: {
            newTab: 'Новая вкладка', urlPlaceholder: 'Введите адрес или поисковый запрос',
            skip: 'Пропустить', minimize: 'Свернуть', maximize: 'Развернуть',
            restore: 'Восстановить', close: 'Закрыть', back: 'Назад',
            forward: 'Вперёд', reload: 'Перезагрузить', home: 'Домой',
            sidebar: 'Боковая панель', copyUrl: 'Копировать URL', qrCode: 'QR-код страницы',
            bookmark: 'Добавить в закладки', clear: 'Очистить',
            frostMode: 'Frost Mode — Заморозка вкладок', tabCount: 'Открытых вкладок',
            settingsApplied: 'Настройки Применены', toggleMenu: 'Скрыть/показать меню',
            // Tab context menu
            cmNewTab: 'Новая вкладка', cmDuplicate: 'Дублировать', cmPin: 'Закрепить',
            cmMute: 'Выключить звук', cmCloseOthers: 'Закрыть другие',
            cmCloseRight: 'Закрыть справа', cmCloseTab: 'Закрыть вкладку',
            // Main menu
            menuNewTab: 'Новая вкладка', menuNewWindow: 'Новое окно', menuIncognito: 'Приватное окно',
            menuHistory: 'История', menuBookmarks: 'Закладки', menuDownloads: 'Загрузки',
            menuSettings: 'Настройки', menuFullscreen: 'Полный экран', menuPrint: 'Печать',
            menuScreenshot: 'Скриншот', menuAlwaysOnTop: 'Поверх всех окон',
        },
        en: {
            newTab: 'New Tab', urlPlaceholder: 'Enter address or search query',
            skip: 'Skip', minimize: 'Minimize', maximize: 'Maximize',
            restore: 'Restore', close: 'Close', back: 'Back',
            forward: 'Forward', reload: 'Reload', home: 'Home',
            sidebar: 'Sidebar', copyUrl: 'Copy URL', qrCode: 'Page QR Code',
            bookmark: 'Add Bookmark', clear: 'Clear',
            frostMode: 'Frost Mode — Freeze Tabs', tabCount: 'Open tabs',
            settingsApplied: 'Settings Applied', toggleMenu: 'Hide/show menu',
            cmNewTab: 'New Tab', cmDuplicate: 'Duplicate', cmPin: 'Pin',
            cmMute: 'Mute', cmCloseOthers: 'Close others',
            cmCloseRight: 'Close to the right', cmCloseTab: 'Close tab',
            menuNewTab: 'New Tab', menuNewWindow: 'New Window', menuIncognito: 'Incognito Window',
            menuHistory: 'History', menuBookmarks: 'Bookmarks', menuDownloads: 'Downloads',
            menuSettings: 'Settings', menuFullscreen: 'Fullscreen', menuPrint: 'Print',
            menuScreenshot: 'Screenshot', menuAlwaysOnTop: 'Always on Top',
        }
    };

    function t(key) {
        const lang = state.settings.language || 'ru';
        return (I18N[lang] && I18N[lang][key]) || I18N.ru[key] || key;
    }

    function applyLanguage() {
        // Update static UI elements
        document.getElementById('url-input')?.setAttribute('placeholder', t('urlPlaceholder'));
        document.getElementById('intro-skip')?.setAttribute('title', t('skip'));
        const skip = document.getElementById('intro-skip');
        if (skip) skip.textContent = t('skip');
        document.getElementById('btn-minimize')?.setAttribute('title', t('minimize'));
        document.getElementById('btn-maximize')?.setAttribute('title', t('maximize'));
        document.getElementById('btn-close')?.setAttribute('title', t('close'));
        document.getElementById('btn-back')?.setAttribute('title', t('back'));
        document.getElementById('btn-forward')?.setAttribute('title', t('forward'));
        document.getElementById('btn-reload')?.setAttribute('title', t('reload'));
        document.getElementById('btn-home')?.setAttribute('title', t('home'));
        document.getElementById('btn-sidebar')?.setAttribute('title', t('sidebar'));
        document.getElementById('url-copy')?.setAttribute('title', t('copyUrl'));
        document.getElementById('url-qr')?.setAttribute('title', t('qrCode'));
        document.getElementById('url-bookmark')?.setAttribute('title', t('bookmark'));
        document.getElementById('url-clear')?.setAttribute('title', t('clear'));
        document.getElementById('btn-new-tab')?.setAttribute('title', t('newTab') + ' (Ctrl+T)');
        document.getElementById('btn-fs-toggle')?.setAttribute('title', t('toggleMenu'));
        document.getElementById('tab-counter')?.setAttribute('title', t('tabCount'));
    }

    const dom = {
        introOverlay: $('#intro-overlay'),
        introVideo: $('#intro-video'),
        introSkip: $('#intro-skip'),
        toastContainer: $('#toast-container'),
        updateBanner: $('#update-banner'),
        updateBannerTitle: $('#update-banner-title'),
        updateBannerSubtitle: $('#update-banner-subtitle'),
        updateBannerBtn: $('#update-banner-btn'),
        updateBannerHide: $('#update-banner-hide'),
        updateMini: $('#update-mini'),
        shell: $('#browser-shell'),
        tabsContainer: $('#tabs-container'),
        tabStrip: $('#tab-strip'),
        tabCounter: $('#tab-counter'),
        btnNewTab: $('#btn-new-tab'),
        btnBack: $('#btn-back'),
        btnForward: $('#btn-forward'),
        btnReload: $('#btn-reload'),
        btnHome: $('#btn-home'),
        btnSidebar: $('#btn-sidebar'),
        urlInput: $('#url-input'),
        urlClear: $('#url-clear'),
        urlCopy: $('#url-copy'),
        urlQr: $('#url-qr'),
        urlBookmark: $('#url-bookmark'),
        urlAutocomplete: $('#url-autocomplete'),
        urlSuggestions: $('#url-suggestions'),
        securityIcon: $('#security-icon'),
        pageLoadTime: $('#page-load-time'),
        loadingBar: $('#loading-bar'),
        findBar: $('#find-bar'),
        findInput: $('#find-input'),
        findCount: $('#find-count'),
        findPrev: $('#find-prev'),
        findNext: $('#find-next'),
        findClose: $('#find-close'),
        zoomIndicator: $('#zoom-indicator'),
        zoomLevel: $('#zoom-level'),
        zoomReset: $('#zoom-reset'),
        bookmarksBar: $('#bookmarks-bar'),
        bookmarksList: $('#bookmarks-list'),
        sidebar: $('#sidebar'),
        sidebarPanel: $('#sidebar-panel'),
        webviewContainer: $('#webview-container'),
        statusVersion: $('#status-version'),
        statusText: $('#status-text'),
        statusRam: $('#status-ram'),
        statusZoom: $('#status-zoom'),
        commandPalette: $('#command-palette'),
        commandInput: $('#command-input'),
        commandResults: $('#command-results'),
        pulsePanel: $('#pulse-panel'),
        pulseClose: $('#pulse-close'),
        contextMenu: $('#context-menu'),
        downloadBar: $('#download-bar'),
        downloadBarName: $('#download-bar-name'),
        downloadBarStats: $('#download-bar-stats'),
        downloadBarFill: $('#download-bar-fill'),
        downloadBarClose: $('#download-bar-close'),
        btnFrost: $('#btn-frost'),
        frostBadge: $('#frost-badge'),
        btnPulse: $('#btn-pulse'),
        btnScreenshot: $('#btn-screenshot'),
        btnMenu: $('#btn-menu'),
        btnDownloads: $('#btn-downloads'),
        downloadsPanel: $('#downloads-panel'),
        downloadsPanelList: $('#downloads-panel-list'),
        downloadsOpenFolder: $('#downloads-open-folder'),
        downloadsShowAll: $('#downloads-show-all'),
        downloadsClear: $('#downloads-clear'),
        btnMinimize: $('#btn-minimize'),
        btnMaximize: $('#btn-maximize'),
        btnClose: $('#btn-close'),
    };

    // ============================================================
    // HELPERS
    // ============================================================
    function genId() { return 'tab-' + (++state.tabIdCounter); }
    function favicon(url) {
        try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
        catch { return ''; }
    }
    function isUrl(s) {
        return /^(https?:\/\/|file:\/\/|mauzer:\/\/)/.test(s) || /^[\w-]+(\.[\w-]+)+/.test(s) || /^localhost/.test(s);
    }
    function searchUrl(q) {
        const engines = { google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
        return (engines[state.settings.searchEngine] || engines.google) + encodeURIComponent(q);
    }
    function normalizeUrl(input) {
        const s = input.trim();
        if (!s) return '';
        if (/^(mauzer|https?|file):\/\//.test(s)) return s;
        if (isUrl(s)) return 'https://' + s;
        return searchUrl(s);
    }
    function formatBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }
    function formatTime(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        return m + 'm ' + (s % 60) + 's';
    }
    function newtabUrl() {
        const theme = state.settings.theme || 'dark';
        return `file://${window.location.pathname.replace(/[^/\\]*$/, '')}newtab.html?theme=${theme}`.replace(/\\/g, '/');
    }
    function settingsUrl() {
        return `file://${window.location.pathname.replace(/[^/\\]*$/, '')}settings.html`.replace(/\\/g, '/');
    }

    // ============================================================
    // TOAST
    // ============================================================
    function toast(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = msg;
        dom.toastContainer.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    let _updateBannerAction = null;
    let _updateBannerMinimized = false;
    let _manualUpdateAvailable = false;
    let _introTimer = null;
    let _introVersion = '';
    function updateLabels() {
        const lang = state.settings.language || 'ru';
        if (lang === 'en') {
            return {
                available: 'Update available',
                version: (v) => `Version ${v}`,
                download: 'Download',
                downloading: (pct) => `Downloading ${pct}%`,
                ready: 'Update ready',
                install: 'Install',
                downloadingBtn: 'Downloading',
                hide: 'Hide',
                mini: 'Update',
            };
        }
        return {
            available: 'Доступно обновление',
            version: (v) => `Версия ${v}`,
            download: 'Скачать',
            downloading: (pct) => `Скачивание ${pct}%`,
            ready: 'Обновление готово',
            install: 'Установить',
            downloadingBtn: 'Скачивается',
            hide: 'Скрыть',
            mini: 'Обнова',
        };
    }

    function applyUpdateBannerVisibility() {
        if (!dom.updateBanner || !dom.updateMini) return;
        if (_updateBannerMinimized) {
            dom.updateBanner.classList.remove('show');
            dom.updateMini.classList.add('show');
        } else {
            dom.updateBanner.classList.add('show');
            dom.updateMini.classList.remove('show');
        }
    }

    function showUpdateBanner({ title, subtitle, button, action, disabled }) {
        if (!dom.updateBanner) return;
        const labels = updateLabels();
        dom.updateBannerTitle.textContent = title || '';
        dom.updateBannerSubtitle.textContent = subtitle || '';
        dom.updateBannerBtn.textContent = button || '';
        dom.updateBannerBtn.disabled = !!disabled;
        if (dom.updateBannerHide) dom.updateBannerHide.textContent = labels.hide;
        if (dom.updateMini) dom.updateMini.textContent = labels.mini;
        _updateBannerAction = action || null;
        applyUpdateBannerVisibility();
    }

    function hideUpdateBanner() {
        if (!dom.updateBanner) return;
        dom.updateBanner.classList.remove('show');
        dom.updateMini?.classList.remove('show');
        _updateBannerAction = null;
        _updateBannerMinimized = false;
        _manualUpdateAvailable = false;
    }

    // ============================================================
    // TABS
    // ============================================================
    let _preloadPath = ''; // Cached preload path from main process

    function createTab(url = '', opts = {}) {
        // Reuse existing Settings tab if requested
        const settingsHref = settingsUrl();
        if (url && url.includes('settings.html')) {
            const existingSettings = state.tabs.find(tab => (tab.url || '').includes('settings.html'));
            if (existingSettings) { switchTab(existingSettings.id); return existingSettings.id; }
        }

        // Block creating duplicate MAUZER home tabs (unless forced)
        const isHomeTab = !url && !opts.incognito;
        const allowDuplicateHome = !!opts._force || !!opts.allowDuplicateHome;
        if (isHomeTab && !allowDuplicateHome) {
            const existing = state.tabs.find(tab => !tab.url || tab.url.includes('newtab.html'));
            if (existing) { switchTab(existing.id); return existing.id; }
        }

        const id = genId();
        // In Incognito Window, ALL tabs are incognito by default
        const isIncog = state.isIncognitoWindow || opts.incognito || false;
        const tab = {
            id, url: url || '', title: isIncog ? (state.settings.language === 'en' ? 'Incognito' : 'Инкогнито') : (isHomeTab ? 'MAUZER' : (opts.title || t('newTab'))),
            favicon: url ? favicon(url) : '', loading: false,
            canGoBack: false, canGoForward: false,
            pinned: opts.pinned || false, muted: false, audible: false, zoom: 1,
            incognito: isIncog,
        };
        state.tabs.push(tab);

        const wv = document.createElement('webview');
        wv.id = 'wv-' + id;
        // Shared partition for Incognito Window to allow session sharing between tabs
        if (isIncog) {
             if (state.isIncognitoWindow) wv.setAttribute('partition', 'incognito');
             else wv.setAttribute('partition', 'incognito-' + id);
        }
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('plugins', '');
        // Security & Compatibility: Enable sandbox and disable node integration for guest pages
        // This fixes YouTube/Google interface issues by making the environment look like a standard browser
        wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no, enableRemoteModule=no, plugins=yes');
        // Add preload for local file:// URLs so they get window.mauzer API
        const targetUrl = url || (isIncog ? incognitoUrl() : newtabUrl());
        if (targetUrl.startsWith('file://') && _preloadPath) {
            wv.setAttribute('preload', 'file:///' + _preloadPath.replace(/\\/g, '/'));
        }
        wv.src = targetUrl;
        dom.webviewContainer.appendChild(wv);
        setupWebview(id, wv);
        renderTabElement(tab);
        switchTab(id);
        updateTabCounter();
        if (state.tabs.length >= (state.settings.tabCountWarning || 50))
            toast(`Открыто ${state.tabs.length} вкладок`, 'error');
        
        saveSessionState();
        return id;
    }

    function incognitoUrl() {
        return 'file:///' + __dirname.replace(/\\/g, '/') + '/incognito.html';
    }

    function createIncognitoTab() {
        // Open new Incognito Window instead of tab
        window.mauzer.window.newIncognito();
    }

    // Handle Incognito Window Mode
    window.mauzer.on.incognito((val) => {
        if (val) {
            state.isIncognitoWindow = true;
            document.body.classList.add('incognito-window');
            // Close the default tab created on start and create an incognito one
            if (state.tabs.length > 0) {
                const defId = state.tabs[0].id;
                closeTab(defId); 
            }
            createTab('', { incognito: true, _force: true });
        }
    });

    function renderTabElement(tab) {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.pinned ? ' pinned' : '') + (tab.incognito ? ' incognito' : '');
        el.id = 'tab-el-' + tab.id;
        el.dataset.tabId = tab.id;
        el.draggable = true;
        el.innerHTML = `
      <div class="tab-loading" id="tab-load-${tab.id}"></div>
      <img class="tab-favicon" id="tab-fav-${tab.id}" src="${tab.favicon || ''}" onerror="this.style.display='none'" style="${tab.favicon ? '' : 'display:none'}">
      <span class="tab-title" id="tab-title-${tab.id}">${tab.title}</span>
      <span class="tab-audio" id="tab-audio-${tab.id}" title="Звук"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg></span>
      <span class="tab-close" id="tab-close-${tab.id}" title="Закрыть"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>
    `;
        el.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) { closeTab(tab.id); return; }
            if (e.target.closest('.tab-audio')) { toggleMute(tab.id); return; }
            switchTab(tab.id);
        });
        el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); showTabContextMenu(e, tab.id); });
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', tab.id); el.style.opacity = '0.5'; });
        el.addEventListener('dragend', () => { el.style.opacity = '1'; });
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.style.borderLeft = '2px solid var(--accent)'; });
        el.addEventListener('dragleave', () => { el.style.borderLeft = ''; });
        el.addEventListener('drop', (e) => { e.preventDefault(); el.style.borderLeft = ''; reorderTab(e.dataTransfer.getData('text/plain'), tab.id); });
        dom.tabsContainer.appendChild(el);
    }

    function switchTab(id) {
        state.activeTabId = id;
        state.tabs.forEach(t => {
            const el = document.getElementById('tab-el-' + t.id);
            const wv = document.getElementById('wv-' + t.id);
            if (el) el.classList.toggle('active', t.id === id);
            if (wv) wv.classList.toggle('active', t.id === id);
        });
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
            dom.urlInput.value = tab.url && !tab.url.includes('newtab.html') ? tab.url : '';
            dom.btnBack.disabled = !tab.canGoBack;
            dom.btnForward.disabled = !tab.canGoForward;
            updateSecurityIcon(tab.url);
            dom.statusZoom.textContent = Math.round((state.zoomLevels[id] || 1) * 100) + '%';
            
            // Show/Hide Incognito Indicator
            const incogInd = document.getElementById('incognito-indicator');
            if (incogInd) incogInd.style.display = tab.incognito ? '' : 'none';
        }
        if (state.frozenTabs.has(id)) { state.frozenTabs.delete(id); updateFrostBadge(); }
        saveSessionState();
    }

    function closeTab(id) {
        // Prevent double close
        const el = document.getElementById('tab-el-' + id);
        if (el && el.classList.contains('closing')) return;

        const idx = state.tabs.findIndex(t => t.id === id);
        if (idx < 0) return;
        const tab = state.tabs[idx];

        // 1. Immediately switch to neighbor if active
        if (state.activeTabId === id) {
            // Prefer right neighbor, then left
            // But visually we want to slide to the left neighbor usually
            // If we are closing the last tab, go to previous
            let nextId = null;
            if (idx < state.tabs.length - 1) nextId = state.tabs[idx + 1].id;
            else if (idx > 0) nextId = state.tabs[idx - 1].id;
            
            if (nextId) switchTab(nextId);
            else if (state.tabs.length === 1) {
                // Last tab being closed - create new one first
                createTab('', { _force: true });
            }
        }

        // 2. Animate closing
        if (el) {
            el.classList.add('closing');
            setTimeout(() => {
                finishCloseTab(id);
            }, 200);
        } else {
            finishCloseTab(id);
        }
    }

    function finishCloseTab(id) {
        const idx = state.tabs.findIndex(t => t.id === id);
        if (idx < 0) return;
        
        const tab = state.tabs[idx];
        const wasIncognito = tab.incognito;
        
        state.closedTabs.push({ ...tab, closedAt: Date.now() });
        if (state.closedTabs.length > 20) state.closedTabs.shift();
        
        state.tabs.splice(idx, 1);
        document.getElementById('tab-el-' + id)?.remove();
        document.getElementById('wv-' + id)?.remove();
        clearTimeout(state.frostTimers[id]);
        state.frozenTabs.delete(id);
        
        // If closed tab was active, switch to another
        if (state.activeTabId === id) {
            state.activeTabId = null;
            if (state.tabs.length === 0) {
                // If last tab was incognito, create normal tab (exit incognito mode behavior)
                // If last tab was normal, create normal tab (keep normal mode)
                createTab('', { _force: true });
            } else {
                // Try to switch to right neighbor, else left
                const nextTab = state.tabs[idx] || state.tabs[idx - 1];
                if (nextTab) switchTab(nextTab.id);
            }
        }
        
        updateTabCounter();
        saveSessionState();
    }

    function restoreClosedTab() {
        const last = state.closedTabs.pop();
        if (last) createTab(last.url, { title: last.title });
    }
    function duplicateTab(id) { const t = state.tabs.find(x => x.id === id); if (t) createTab(t.url); }
    function pinTab(id) {
        const t = state.tabs.find(x => x.id === id);
        if (t) { 
            t.pinned = !t.pinned; 
            document.getElementById('tab-el-' + id)?.classList.toggle('pinned', t.pinned); 
            saveSessionState();
        }
    }
    function toggleMute(id) {
        const t = state.tabs.find(x => x.id === id);
        const wv = document.getElementById('wv-' + id);
        if (t && wv) {
            t.muted = !t.muted;
            wv.setAudioMuted(t.muted);
            // Update icon inline — no toast spam
            const el = document.getElementById('tab-audio-' + id);
            if (el) {
                el.innerHTML = t.muted
                    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
                    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
            }
        }
    }
    function reorderTab(fromId, toId) {
        const fi = state.tabs.findIndex(t => t.id === fromId), ti = state.tabs.findIndex(t => t.id === toId);
        if (fi < 0 || ti < 0) return;
        const [moved] = state.tabs.splice(fi, 1);
        state.tabs.splice(ti, 0, moved);
        state.tabs.forEach(t => { const el = document.getElementById('tab-el-' + t.id); if (el) dom.tabsContainer.appendChild(el); });
    }
    function updateTabCounter() { dom.tabCounter.textContent = state.tabs.length; }

    // ============================================================
    // WEBVIEW SETUP
    // ============================================================
    function setupWebview(id, wv) {
        const updateNav = () => {
            const t = state.tabs.find(x => x.id === id);
            if (!t) return;
            t.canGoBack = wv.canGoBack(); t.canGoForward = wv.canGoForward();
            if (state.activeTabId === id) { dom.btnBack.disabled = !t.canGoBack; dom.btnForward.disabled = !t.canGoForward; }
        };

        wv.addEventListener('did-start-loading', () => {
            const t = state.tabs.find(x => x.id === id); if (t) t.loading = true;
            const ld = document.getElementById('tab-load-' + id); if (ld) ld.style.display = 'block';
            const fv = document.getElementById('tab-fav-' + id); if (fv) fv.style.display = 'none';
            if (state.activeTabId === id) dom.loadingBar.classList.add('active');
            state.loadTimers[id] = Date.now();
        });

        wv.addEventListener('did-stop-loading', () => {
            const t = state.tabs.find(x => x.id === id); if (t) t.loading = false;
            const ld = document.getElementById('tab-load-' + id); if (ld) ld.style.display = 'none';
            if (state.activeTabId === id) dom.loadingBar.classList.remove('active');
            updateNav();
            if (state.loadTimers[id] && state.activeTabId === id) {
                const ms = Date.now() - state.loadTimers[id];
                dom.pageLoadTime.textContent = ms + 'ms';
                dom.pageLoadTime.style.display = '';
                setTimeout(() => { dom.pageLoadTime.style.display = 'none'; }, 4000);
            }
            resetFrostTimer(id);
        });

        wv.addEventListener('did-navigate', (e) => {
            const t = state.tabs.find(x => x.id === id);
            if (t) { t.url = e.url; }
            if (state.activeTabId === id) {
                dom.urlInput.value = e.url.includes('newtab.html') ? '' : e.url;
                updateSecurityIcon(e.url);
            }
            updateNav();
            if (!t?.incognito && !e.url.includes('newtab.html') && !e.url.includes('incognito.html'))
                window.mauzer.history.add({ url: e.url, title: t?.title, favicon: t?.favicon });
            saveSessionState();
        });

        wv.addEventListener('did-navigate-in-page', (e) => {
            const t = state.tabs.find(x => x.id === id);
            if (t) { t.url = e.url; updateNav(); }
            if (state.activeTabId === id) dom.urlInput.value = e.url;
            saveSessionState();
        });

        wv.addEventListener('page-title-updated', (e) => {
            const t = state.tabs.find(x => x.id === id);
            if (t) { t.title = e.title; const el = document.getElementById('tab-title-' + id); if (el) el.textContent = e.title; saveSessionState(); }
        });

        wv.addEventListener('page-favicon-updated', (e) => {
            const t = state.tabs.find(x => x.id === id);
            if (t && e.favicons?.length) { t.favicon = e.favicons[0]; const el = document.getElementById('tab-fav-' + id); if (el) { el.src = e.favicons[0]; el.style.display = ''; saveSessionState(); } }
        });

        wv.addEventListener('did-fail-load', (e) => {
            if (e.errorCode === -3) return;
            const t = state.tabs.find(x => x.id === id); if (t) t.loading = false;
            const ld = document.getElementById('tab-load-' + id); if (ld) ld.style.display = 'none';
            if (state.activeTabId === id) dom.loadingBar.classList.remove('active');
        });

        wv.addEventListener('update-target-url', (e) => { dom.statusText.textContent = e.url || ''; });

        wv.addEventListener('media-started-playing', () => {
            const t = state.tabs.find(x => x.id === id); if (t) t.audible = true;
            const el = document.getElementById('tab-audio-' + id); if (el) el.classList.add('playing');
        });
        wv.addEventListener('media-paused', () => {
            const t = state.tabs.find(x => x.id === id); if (t) t.audible = false;
            const el = document.getElementById('tab-audio-' + id); if (el) el.classList.remove('playing');
        });

        wv.addEventListener('new-window', (e) => { e.preventDefault(); createTab(e.url); });

        // Ctrl+Wheel Zoom: inject into webview, relay via console-message
        wv.addEventListener('dom-ready', () => {
            wv.executeJavaScript(`
                document.addEventListener('wheel', function(e) {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('__MAUZER_ZOOM__:' + (e.deltaY < 0 ? 'in' : 'out'));
                    }
                }, { passive: false, capture: true });
            `).catch(() => { });
        });
        wv.addEventListener('console-message', (e) => {
            if (e.message && e.message.startsWith('__MAUZER_ZOOM__:')) {
                const dir = e.message.split(':')[1];
                setZoom(dir === 'in' ? 0.1 : -0.1);
            }
        });
    }

    // ============================================================
    // NAVIGATION
    // ============================================================
    function navigate(input) {
        const url = normalizeUrl(input);
        if (!url) return;
        const wv = document.getElementById('wv-' + state.activeTabId);
        if (wv) wv.src = url;
        dom.urlInput.blur();
    }

    function updateSecurityIcon(url) {
        dom.securityIcon.classList.toggle('secure', url?.startsWith('https://'));
    }

    // ============================================================
    // FROST MODE
    // ============================================================
    function resetFrostTimer(id) {
        clearTimeout(state.frostTimers[id]);
        if (!state.settings.frostEnabled) return;
        state.frostTimers[id] = setTimeout(() => {
            if (id !== state.activeTabId) { state.frozenTabs.add(id); updateFrostBadge(); }
        }, state.settings.frostTimeout || 30000);
    }
    function updateFrostBadge() {
        const c = state.frozenTabs.size;
        dom.frostBadge.textContent = c;
        dom.frostBadge.style.display = c > 0 ? '' : 'none';
    }

    // ============================================================
    // SIDEBAR
    // ============================================================
    function openSidebar(panel) {
        if (panel) state.sidebarPanel = panel;
        
        if (!state.sidebarOpen) {
            state.sidebarOpen = true;
            dom.sidebar.style.display = '';
            requestAnimationFrame(() => {
                dom.sidebar.classList.add('open');
            });
        }
        
        renderSidebarPanel(state.sidebarPanel);
    }

    function closeSidebar() {
        if (state.sidebarOpen) {
            state.sidebarOpen = false;
            dom.sidebar.classList.remove('open');
            dom.sidebar.addEventListener('transitionend', () => {
                if (!state.sidebarOpen) dom.sidebar.style.display = 'none';
            }, { once: true });
        }
    }

    function toggleSidebar() {
        if (state.sidebarOpen) closeSidebar();
        else openSidebar();
    }

    async function renderSidebarPanel(panel) {
        state.sidebarPanel = panel;
        $$('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === panel));
        const c = dom.sidebarPanel;
        c.innerHTML = '';

        if (panel === 'bookmarks') {
            const bms = await window.mauzer.bookmarks.get();
            c.innerHTML = '<div class="sidebar-panel-title">Закладки</div>';
            if (!bms.length) { c.innerHTML += '<div class="sidebar-empty">Нет закладок</div>'; return; }
            bms.forEach(b => {
                const it = document.createElement('div'); it.className = 'sidebar-item';
                it.innerHTML = `<img src="${favicon(b.url)}" onerror="this.style.display='none'"><span class="sidebar-item-title">${b.title}</span><span class="sidebar-item-delete" data-id="${b.id}">✕</span>`;
                it.addEventListener('click', (e) => { if (!e.target.closest('.sidebar-item-delete')) createTab(b.url); });
                it.querySelector('.sidebar-item-delete').addEventListener('click', async () => { await window.mauzer.bookmarks.remove(b.id); renderSidebarPanel('bookmarks'); });
                c.appendChild(it);
            });
        } else if (panel === 'history') {
            const h = await window.mauzer.history.get();
            const lang = state.settings.language || 'ru';
            const titleLbl = lang === 'en' ? 'History' : 'История';
            const emptyLbl = lang === 'en' ? 'Empty' : 'Пусто';
            const clearAllLbl = lang === 'en' ? 'Clear All' : 'Очистить всё';
            const clearDayLbl = lang === 'en' ? 'Clear' : 'Очистить';
            const todayLbl = lang === 'en' ? 'Today' : 'Сегодня';
            const yesterdayLbl = lang === 'en' ? 'Yesterday' : 'Вчера';

            c.innerHTML = `<div class="sidebar-panel-title" style="display:flex;align-items:center;justify-content:space-between;">${titleLbl}<button class="sidebar-clear-all-btn" id="history-clear-all" title="${clearAllLbl}">${clearAllLbl}</button></div>`;

            if (!h.length) { c.innerHTML += `<div class="sidebar-empty">${emptyLbl}</div>`; return; }

            // Group by date
            const groups = {};
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

            h.forEach(entry => {
                const d = new Date(entry.timestamp); d.setHours(0, 0, 0, 0);
                let label;
                if (d.getTime() === today.getTime()) label = todayLbl;
                else if (d.getTime() === yesterday.getTime()) label = yesterdayLbl;
                else label = d.toLocaleDateString(lang === 'en' ? 'en' : 'ru', { day: 'numeric', month: 'long', year: 'numeric' });
                if (!groups[label]) groups[label] = { dateMs: d.getTime(), items: [] };
                groups[label].items.push(entry);
            });

            // Sort groups newest first
            const sortedKeys = Object.keys(groups).sort((a, b) => groups[b].dateMs - groups[a].dateMs);

            sortedKeys.forEach(label => {
                const group = groups[label];
                const header = document.createElement('div');
                header.className = 'sidebar-date-header';
                header.innerHTML = `<span>${label}</span><button class="sidebar-clear-day-btn" title="${clearDayLbl} ${label}">${clearDayLbl}</button>`;
                c.appendChild(header);

                header.querySelector('.sidebar-clear-day-btn').addEventListener('click', async () => {
                    for (const entry of group.items) {
                        if (entry.id) await window.mauzer.history.remove(entry.id);
                    }
                    renderSidebarPanel('history');
                    toast(lang === 'en' ? 'Cleared' : 'Очищено', 'success');
                });

                // Sort items within group newest first
                group.items.sort((a, b) => b.timestamp - a.timestamp);
                group.items.forEach(entry => {
                    const it = document.createElement('div'); it.className = 'sidebar-item';
                    const time = new Date(entry.timestamp).toLocaleTimeString(lang === 'en' ? 'en' : 'ru', { hour: '2-digit', minute: '2-digit' });
                    it.innerHTML = `<img src="${favicon(entry.url)}" onerror="this.style.display='none'"><span class="sidebar-item-title">${entry.title || entry.url}</span><span class="sidebar-item-meta">${time}</span><span class="sidebar-item-delete" title="${lang === 'en' ? 'Delete' : 'Удалить'}">✕</span>`;
                    it.addEventListener('click', (e) => { if (!e.target.closest('.sidebar-item-delete')) createTab(entry.url); });
                    it.querySelector('.sidebar-item-delete').addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (entry.id) await window.mauzer.history.remove(entry.id);
                        it.remove();
                    });
                    c.appendChild(it);
                });
            });

            c.querySelector('#history-clear-all').addEventListener('click', async () => {
                if (confirm(lang === 'en' ? 'Clear all browsing history?' : 'Очистить всю историю?')) {
                    await window.mauzer.history.clear();
                    renderSidebarPanel('history');
                    toast(lang === 'en' ? 'History cleared' : 'История очищена', 'success');
                }
            });
        } else if (panel === 'downloads') {
            const d = await window.mauzer.downloads.get();
            c.innerHTML = '<div class="sidebar-panel-title">Загрузки</div>';
            if (!d.length) { c.innerHTML += '<div class="sidebar-empty">Пусто</div>'; return; }
            d.forEach(dl => {
                const it = document.createElement('div'); it.className = 'sidebar-item';
                it.innerHTML = `<span style="font-size:16px">📄</span><span class="sidebar-item-title">${dl.filename}</span><span class="sidebar-item-meta">${formatBytes(dl.totalBytes)}</span>`;
                it.addEventListener('click', () => window.mauzer.downloads.showInFolder(dl.path));
                c.appendChild(it);
            });
        } else if (panel === 'notes') {
            c.innerHTML = `<div class="sidebar-panel-title">Заметки</div><textarea class="note-input" id="new-note" placeholder="Написать заметку..."></textarea><button class="sidebar-action-btn" id="save-note-btn">💾 Сохранить</button><div id="notes-list" style="margin-top:8px"></div>`;
            const notes = await window.mauzer.notes.get();
            const nl = c.querySelector('#notes-list');
            notes.forEach(n => {
                const it = document.createElement('div'); it.className = 'sidebar-item';
                it.innerHTML = `<span class="sidebar-item-title">${n.text.slice(0, 50)}</span><span class="sidebar-item-delete">✕</span>`;
                it.querySelector('.sidebar-item-delete').addEventListener('click', async () => { await window.mauzer.notes.delete(n.id); renderSidebarPanel('notes'); });
                nl.appendChild(it);
            });
            c.querySelector('#save-note-btn').addEventListener('click', async () => {
                const txt = c.querySelector('#new-note').value.trim();
                if (txt) { await window.mauzer.notes.save({ text: txt }); renderSidebarPanel('notes'); toast('Заметка сохранена', 'success'); }
            });
        } else if (panel === 'readinglist') {
            const rl = await window.mauzer.readinglist.get();
            c.innerHTML = '<div class="sidebar-panel-title">Отложенное</div>';
            if (!rl.length) { c.innerHTML += '<div class="sidebar-empty">Пусто</div>'; return; }
            rl.forEach(r => {
                const it = document.createElement('div'); it.className = 'sidebar-item';
                it.innerHTML = `<img src="${favicon(r.url)}" onerror="this.style.display='none'"><span class="sidebar-item-title">${r.title}</span><span class="sidebar-item-delete">✕</span>`;
                it.addEventListener('click', (e) => { if (!e.target.closest('.sidebar-item-delete')) createTab(r.url); });
                it.querySelector('.sidebar-item-delete').addEventListener('click', async () => { await window.mauzer.readinglist.remove(r.id); renderSidebarPanel('readinglist'); });
                c.appendChild(it);
            });
        } else if (panel === 'settings') {
            // Settings now opens in a new tab
            createTab(settingsUrl(), { title: 'Настройки' });
            toggleSidebar();
        }
    }

    // ============================================================
    // ICONS (SVG Helpers)
    // ============================================================
    const ICONS = {
        settings: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        history: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7v5l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        download: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        bookmark: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        newTab: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        menu: '<svg viewBox="0 0 24 24" fill="none" class="icon"><circle cx="12" cy="12" r="1" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="5" r="1" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="19" r="1" stroke="currentColor" stroke-width="2"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" class="icon"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        print: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M6 9V2h12v7" stroke="currentColor" stroke-width="2"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke="currentColor" stroke-width="2"/><path d="M6 14h12v8H6z" stroke="currentColor" stroke-width="2"/></svg>',
        screenshot: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="2"/></svg>',
        incognito: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M3 7V5h18v2M5 11l4 9h6l4-9M12 11V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', // simplified glasses
        fullscreen: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        note: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="2"/><path d="M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        exit: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="2"/><path d="M16 17l5-5-5-5" stroke="currentColor" stroke-width="2"/><path d="M21 12H9" stroke="currentColor" stroke-width="2"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M12 17v5" stroke="currentColor" stroke-width="2"/><path d="M9 2v6l-2 2v2h12v-2l-2-2V2" stroke="currentColor" stroke-width="2"/></svg>',
        mute: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="2"/><path d="M23 9l-6 6M17 9l6 6" stroke="currentColor" stroke-width="2"/></svg>',
        sound: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="2"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" class="icon"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg>',
        qr: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" stroke="currentColor" stroke-width="2"/></svg>',
        duplicate: '<svg viewBox="0 0 24 24" fill="none" class="icon"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg>',
        window: '<svg viewBox="0 0 24 24" fill="none" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18" stroke="currentColor" stroke-width="2"/></svg>',
    };

    // ============================================================
    // DROPDOWN MENU (SVG Updates)
    // ============================================================
    function showDropdownMenu() {
        const items = [
            { label: t('menuNewTab'), icon: ICONS.newTab, kbd: 'Ctrl+T', action: () => createTab('', { allowDuplicateHome: true }) },
            { label: t('menuNewWindow'), icon: ICONS.window, kbd: 'Ctrl+N', action: () => window.mauzer.window.newWindow() },
            { label: t('menuIncognito'), icon: ICONS.incognito, kbd: 'Ctrl+Shift+N', action: () => createIncognitoTab() },
            { separator: true },
            { label: t('menuBookmarks'), icon: ICONS.bookmark, action: () => openSidebar('bookmarks') },
            { label: t('menuHistory'), icon: ICONS.history, kbd: 'Ctrl+H', action: () => openSidebar('history') },
            { label: t('menuDownloads'), icon: ICONS.download, kbd: 'Ctrl+J', action: () => openSidebar('downloads') },
            { label: state.settings.language === 'en' ? 'Notes' : 'Заметки', icon: ICONS.note, action: () => openSidebar('notes') },
            { separator: true },
            { label: state.settings.language === 'en' ? 'Find on Page' : 'Поиск на странице', icon: ICONS.search, kbd: 'Ctrl+F', action: () => toggleFindBar() },
            { label: t('menuScreenshot'), icon: ICONS.screenshot, action: takeScreenshot },
            { label: t('menuPrint'), icon: ICONS.print, kbd: 'Ctrl+P', action: printPage },
            { label: t('menuFullscreen'), icon: ICONS.fullscreen, kbd: 'F11', action: () => window.mauzer.window.fullscreen() },
            { separator: true },
            { label: t('menuSettings'), icon: ICONS.settings, action: () => createTab(settingsUrl(), { title: t('menuSettings') }) },
            { separator: true },
            { label: state.settings.language === 'en' ? 'Quit' : 'Выход', icon: ICONS.exit, action: () => window.mauzer.window.close(), danger: true },
        ];
        const rect = dom.btnMenu.getBoundingClientRect();
        showContextMenu(rect.right, rect.bottom + 8, items, { type: 'button' });
    }

    // ============================================================
    // CONTEXT MENU (SVG Updates)
    // ============================================================
    function showTabContextMenu(e, tabId) {
        const tab = state.tabs.find(x => x.id === tabId);
        showContextMenu(e.clientX, e.clientY, [
            { label: t('cmNewTab'), icon: ICONS.newTab, action: () => createTab('', { allowDuplicateHome: true }) },
            { label: t('cmDuplicate'), icon: ICONS.duplicate, action: () => duplicateTab(tabId) },
            { separator: true },
            { label: tab?.pinned ? (state.settings.language === 'en' ? 'Unpin' : 'Открепить') : t('cmPin'), icon: ICONS.pin, action: () => pinTab(tabId) },
            { label: tab?.muted ? (state.settings.language === 'en' ? 'Unmute' : 'Включить звук') : t('cmMute'), icon: tab?.muted ? ICONS.sound : ICONS.mute, action: () => toggleMute(tabId) },
            { separator: true },
            { label: t('cmCloseOthers'), icon: ICONS.close, action: () => { state.tabs.filter(x => x.id !== tabId && !x.pinned).forEach(x => closeTab(x.id)); } },
            { label: t('cmCloseRight'), icon: '<svg viewBox="0 0 24 24" fill="none" class="icon"><path d="M13 5l7 7-7 7M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>', action: () => { const idx = state.tabs.findIndex(x => x.id === tabId); state.tabs.slice(idx + 1).filter(x => !x.pinned).forEach(x => closeTab(x.id)); } },
            { separator: true },
            { label: t('cmCloseTab'), icon: ICONS.close, action: () => closeTab(tabId), danger: true },
        ], { type: 'point', x: e.clientX, y: e.clientY });
    }

    // ============================================================
    // COMMAND PALETTE (Ctrl+K)
    // ============================================================
    function toggleCommandPalette() {
        const v = dom.commandPalette.style.display !== 'none';
        dom.commandPalette.style.display = v ? 'none' : '';
        if (!v) { dom.commandInput.value = ''; dom.commandInput.focus(); renderCommands(''); }
    }

    function renderCommands(query) {
        const cmds = [
            { title: t('menuNewTab'), kbd: 'Ctrl+T', action: () => createTab() },
            { title: t('menuIncognito'), kbd: 'Ctrl+Shift+N', action: () => createIncognitoTab() },
            { title: t('menuSettings'), action: () => createTab(settingsUrl(), { title: t('menuSettings') }) },
            { title: t('menuHistory'), kbd: 'Ctrl+H', action: () => openSidebar('history') },
            { title: t('menuDownloads'), kbd: 'Ctrl+J', action: () => openSidebar('downloads') },
            { title: t('menuBookmarks'), action: () => openSidebar('bookmarks') },
            { title: state.settings.language === 'en' ? 'Restore Tab' : 'Восстановить вкладку', kbd: 'Ctrl+Shift+T', action: restoreClosedTab },
            { title: t('menuFullscreen'), kbd: 'F11', action: () => window.mauzer.window.fullscreen() },
            { title: state.settings.language === 'en' ? 'Find on Page' : 'Поиск на странице', kbd: 'Ctrl+F', action: () => toggleFindBar() },
            { title: t('menuScreenshot'), action: takeScreenshot },
            { title: 'DevTools', kbd: 'F12', action: openDevTools },
            { title: t('menuPrint'), kbd: 'Ctrl+P', action: printPage },
        ];
        state.tabs.forEach(t => cmds.push({ title: t.title, desc: t.url, icon: '🔖', action: () => switchTab(t.id) }));
        const q = query.toLowerCase();
        const filtered = q ? cmds.filter(c => c.title.toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q)) : cmds;
        dom.commandResults.innerHTML = '';
        filtered.slice(0, 12).forEach((cmd, i) => {
            const el = document.createElement('div');
            el.className = 'command-item' + (i === 0 ? ' selected' : '');
            el.innerHTML = `<div class="command-item-icon">${cmd.icon || '⚡'}</div><div class="command-item-text"><div class="command-item-title">${cmd.title}</div>${cmd.desc ? `<div class="command-item-desc">${cmd.desc}</div>` : ''}</div>${cmd.kbd ? `<span class="command-item-kbd">${cmd.kbd}</span>` : ''}`;
            el.addEventListener('click', () => { toggleCommandPalette(); cmd.action(); });
            dom.commandResults.appendChild(el);
        });
    }

    // (showTabContextMenu defined above with ICONS)

    let _outsideClickHandler = null;
    let _blurHandler = null;
    let _menuOpen = false;
    let _contextMenuAnchor = null;
    let _webviewResizeObserver = null;
    let _updatePct = -1;
    function updateWebviewSize() {
        // CSS handles sizing now (width: 100%; height: 100%)
        // Manual JS sizing can cause issues with responsive layouts
        /*
        if (dom.webviewContainer.classList.contains('split-view')) return;
        const rect = dom.webviewContainer.getBoundingClientRect();
        const w = Math.max(0, Math.ceil(rect.width));
        const h = Math.max(0, Math.ceil(rect.height));
        if (!w || !h) return;
        dom.webviewContainer.querySelectorAll('webview').forEach(wv => {
            wv.style.width = w + 'px';
            wv.style.height = h + 'px';
            wv.style.transform = 'translateZ(0)';
        });
        */
    }
    function positionContextMenu(x, y, anchor) {
        let left = x;
        let top = y;
        if (anchor && anchor.type === 'button') {
            const rect = dom.btnMenu.getBoundingClientRect();
            const menuWidth = dom.contextMenu.offsetWidth;
            left = rect.right - menuWidth;
            top = rect.bottom + 8;
        } else if (anchor && anchor.type === 'point') {
            left = anchor.x;
            top = anchor.y;
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const maxH = Math.max(0, vh - 16);
        dom.contextMenu.style.maxHeight = maxH + 'px';
        const menuWidth = dom.contextMenu.offsetWidth;
        const menuHeight = dom.contextMenu.offsetHeight;
        if (left + menuWidth > vw - 8) left = vw - menuWidth - 8;
        if (top + menuHeight > vh - 8) top = vh - menuHeight - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        dom.contextMenu.style.right = 'auto';
        dom.contextMenu.style.bottom = 'auto';
        dom.contextMenu.style.left = left + 'px';
        dom.contextMenu.style.top = top + 'px';
    }
    function showContextMenu(x, y, items, anchor) {
        hideContextMenu(); // close any existing first
        dom.contextMenu.innerHTML = '';
        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                dom.contextMenu.appendChild(sep);
                return;
            }
            const el = document.createElement('div');
            el.className = 'context-menu-item' + (item.danger ? ' danger' : '');
            // Build icon span
            const iconSpan = document.createElement('span');
            iconSpan.className = 'context-menu-icon';
            iconSpan.innerHTML = item.icon || '';
            el.appendChild(iconSpan);
            // Label text
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            labelSpan.style.flex = '1';
            el.appendChild(labelSpan);
            // Keyboard shortcut
            if (item.kbd) {
                const kbdSpan = document.createElement('span');
                kbdSpan.className = 'context-menu-kbd';
                kbdSpan.textContent = item.kbd;
                el.appendChild(kbdSpan);
            }
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                hideContextMenu();
                if (item.action) item.action();
            });
            dom.contextMenu.appendChild(el);
        });
        dom.contextMenu.style.display = '';
        dom.contextMenu.style.visibility = 'hidden';
        _contextMenuAnchor = anchor || { type: 'point', x, y };
        positionContextMenu(x, y, _contextMenuAnchor);
        dom.contextMenu.style.visibility = '';
        dom.contextMenu.classList.add('show');
        _menuOpen = true;
        // Close on outside click (mousedown + click)
        setTimeout(() => {
            _outsideClickHandler = (e) => {
                // Ignore clicks on the menu button itself so toggle works (close via handler below)
                if (dom.btnMenu && dom.btnMenu.contains(e.target)) return;
                if (!dom.contextMenu.contains(e.target)) {
                    hideContextMenu();
                }
            };
            document.addEventListener('mousedown', _outsideClickHandler, true);
            document.addEventListener('click', _outsideClickHandler, true);
        }, 100);
        // Close when webview or anything else steals focus
        _blurHandler = () => { hideContextMenu(); };
        window.addEventListener('blur', _blurHandler);
    }

    function hideContextMenu() {
        dom.contextMenu.style.display = 'none';
        dom.contextMenu.classList.remove('show');
        _menuOpen = false;
        _contextMenuAnchor = null;
        if (_outsideClickHandler) {
            document.removeEventListener('mousedown', _outsideClickHandler, true);
            document.removeEventListener('click', _outsideClickHandler, true);
            _outsideClickHandler = null;
        }
        if (_blurHandler) {
            window.removeEventListener('blur', _blurHandler);
            _blurHandler = null;
        }
    }

    // ============================================================
    // FIND BAR
    // ============================================================
    function toggleFindBar() {
        const v = dom.findBar.style.display !== 'none';
        dom.findBar.style.display = v ? 'none' : '';
        if (!v) dom.findInput.focus();
        else { const wv = document.getElementById('wv-' + state.activeTabId); if (wv) wv.stopFindInPage('clearSelection'); dom.findCount.textContent = '0/0'; }
    }

    // ============================================================
    // ZOOM
    // ============================================================
    let zoomHideTimer;
    function setZoom(delta) {
        const id = state.activeTabId, wv = document.getElementById('wv-' + id);
        if (!wv) return;
        let level = Math.max(0.25, Math.min(3, (state.zoomLevels[id] || 1) + delta));
        state.zoomLevels[id] = level; wv.setZoomFactor(level);
        const pct = Math.round(level * 100) + '%';
        dom.zoomLevel.textContent = pct; dom.statusZoom.textContent = pct;
        dom.zoomIndicator.style.display = '';
        clearTimeout(zoomHideTimer);
        zoomHideTimer = setTimeout(() => { dom.zoomIndicator.style.display = 'none'; }, 2000);
    }
    function resetZoom() {
        state.zoomLevels[state.activeTabId] = 1;
        const wv = document.getElementById('wv-' + state.activeTabId); if (wv) wv.setZoomFactor(1);
        dom.zoomLevel.textContent = '100%'; dom.statusZoom.textContent = '100%'; dom.zoomIndicator.style.display = 'none';
    }

    // ============================================================
    // DOWNLOADS PANEL
    // ============================================================
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getFileTypeClass(filename) {
        if (!filename) return '';
        const ext = filename.split('.').pop().toLowerCase();
        if (['exe', 'msi', 'dmg', 'deb', 'appimage'].includes(ext)) return 'exe';
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'zip';
        if (['mp4', 'mp3', 'avi', 'mkv', 'mov', 'wav', 'flac', 'ogg', 'webm'].includes(ext)) return 'media';
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
        return '';
    }

    function getFileIcon(typeClass) {
        switch (typeClass) {
            case 'exe': return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h8M8 14h4"/></svg>';
            case 'zip': return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 22H4a2 2 0 01-2-2V4a2 2 0 012-2h16a2 2 0 012 2v16a2 2 0 01-2 2z"/><path d="M12 2v20M9 5h3M12 8h3M9 11h3M12 14h3"/></svg>';
            case 'media': return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>';
            case 'image': return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21"/></svg>';
            default: return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        }
    }

    function renderDownloadsPanel() {
        const list = dom.downloadsPanelList;
        if (!state.downloadsList.length) {
            list.innerHTML = '<div class="downloads-empty">Нет загрузок</div>';
            return;
        }
        list.innerHTML = '';
        state.downloadsList.forEach(dl => {
            const typeClass = getFileTypeClass(dl.filename);
            const el = document.createElement('div');
            el.className = 'dl-item';
            const isActive = dl.state === 'progressing';
            el.innerHTML = `
                <div class="dl-item-icon ${typeClass}">${getFileIcon(typeClass)}</div>
                <div class="dl-item-info">
                    <div class="dl-item-name">${dl.filename}</div>
                    <div class="dl-item-meta">${isActive ? formatBytes(dl.receivedBytes) + ' / ' + formatBytes(dl.totalBytes) : formatBytes(dl.totalBytes || dl.receivedBytes)}</div>
                    ${isActive ? `<div class="dl-item-progress"><div class="dl-item-progress-fill" style="width:${dl.totalBytes > 0 ? Math.round(dl.receivedBytes / dl.totalBytes * 100) : 0}%"></div></div>` : ''}
                </div>
            `;
            el.addEventListener('dblclick', () => {
                if (!isActive && dl.path) {
                    window.mauzer.downloads.open(dl.path);
                }
            });
            list.appendChild(el);
        });
    }

    // ============================================================
    // QR CODE
    // ============================================================
    function showQrCode() {
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        if (!tab || !tab.url) { toast('Нет URL для QR-кода', 'error'); return; }
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tab.url)}`;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:9000;display:flex;align-items:center;justify-content:center;animation:qr-overlay-in 0.25s ease-out;';
        overlay.innerHTML = `
      <style>
        @keyframes qr-overlay-in { from { opacity:0; } to { opacity:1; } }
        @keyframes qr-card-in { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }
        .qr-card { background:#111; border:1px solid rgba(255,255,255,0.06); border-radius:20px; padding:28px 32px; text-align:center; box-shadow:0 24px 80px rgba(0,0,0,0.6); max-width:300px; animation:qr-card-in 0.3s cubic-bezier(0.25,0.8,0.25,1); }
        .qr-title { color:rgba(255,255,255,0.85); margin:0 0 16px 0; font-size:13px; font-weight:500; letter-spacing:0.5px; text-transform:uppercase; }
        .qr-img { width:200px; height:200px; border-radius:12px; background:#fff; padding:12px; box-shadow:0 0 30px rgba(255,255,255,0.04); }
        .qr-url { color:rgba(255,255,255,0.3); font-size:10px; margin-top:14px; word-break:break-all; max-width:260px; line-height:1.4; }
        .qr-close { margin-top:18px; padding:8px 28px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:10px; color:rgba(255,255,255,0.6); cursor:pointer; font-family:inherit; font-size:12px; transition:all 0.2s ease; }
        .qr-close:hover { background:rgba(255,255,255,0.1); color:#fff; }
      </style>
      <div class="qr-card">
        <h3 class="qr-title">QR-код страницы</h3>
        <img src="${qrUrl}" alt="QR" class="qr-img">
        <p class="qr-url">${tab.url}</p>
        <button id="qr-close-btn" class="qr-close">Закрыть</button>
      </div>
    `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.id === 'qr-close-btn') overlay.remove(); });
    }

    // ============================================================
    // FEATURES
    // ============================================================
    function openDevTools() {
        const wv = document.getElementById('wv-' + state.activeTabId);
        if (!wv) return;
        try {
            // Open DevTools docked to right
            wv.openDevTools({ mode: 'right' });
        } catch (e) {
            console.error('DevTools error:', e);
        }
    }
    function printPage() { document.getElementById('wv-' + state.activeTabId)?.print(); }
    async function takeScreenshot() {
        const r = await window.mauzer.actions.screenshot();
        if (r.success) toast('Скриншот сохранён: ' + r.path, 'success');
        else toast('Ошибка скриншота', 'error');
    }

    // URL Autocomplete
    let acTimer;
    async function showAutocomplete(q) {
        if (!q || q.length < 2) { dom.urlAutocomplete.style.display = 'none'; return; }
        clearTimeout(acTimer);
        acTimer = setTimeout(async () => {
            const res = await window.mauzer.history.search(q);
            if (!res.length) { dom.urlAutocomplete.style.display = 'none'; return; }
            dom.urlAutocomplete.innerHTML = '';
            res.slice(0, 8).forEach(r => {
                const el = document.createElement('div'); el.className = 'url-autocomplete-item';
                el.innerHTML = `<img src="${favicon(r.url)}" onerror="this.style.display='none'"><span class="url-autocomplete-title">${r.title}</span><span class="url-autocomplete-url">${r.url}</span>`;
                el.addEventListener('click', () => { dom.urlInput.value = r.url; navigate(r.url); dom.urlAutocomplete.style.display = 'none'; });
                dom.urlAutocomplete.appendChild(el);
            });
            dom.urlAutocomplete.style.display = '';
        }, 200);
    }

    // ============================================================
    // PULSE
    // ============================================================
    const pulseToggle = document.getElementById('pulse-toggle-input');
    
    // Init Pulse state
    window.mauzer.pulse.getState().then(enabled => {
        if(pulseToggle) pulseToggle.checked = enabled;
    });

    if(pulseToggle) {
        pulseToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            await window.mauzer.pulse.toggle(enabled);
            const status = state.settings.language === 'en' ? (enabled ? 'Enabled' : 'Disabled') : (enabled ? 'Включена' : 'Выключена');
            toast(`Pulse: ${status}`);

            // If disabling, add current domain to whitelist
            if (!enabled) {
                const wv = document.getElementById('wv-' + state.activeTabId);
                if (wv) {
                    try {
                        const url = wv.getURL();
                        if (url && !url.startsWith('file://') && !url.startsWith('mauzer://')) {
                            const domain = new URL(url).hostname;
                            await window.mauzer.pulse.addWhitelist(domain);
                        }
                    } catch (err) {}
                }
            }

            // Force reload to apply/remove cosmetic rules immediately
            const wv = document.getElementById('wv-' + state.activeTabId);
            if (wv) {
                // location.reload() in webview context to clear injected scripts/styles
                wv.executeJavaScript('location.reload()').catch(() => {});
            }
        });
    }

    function renderPulseStats(s) {
        const adsEl = document.getElementById('pulse-ads');
        const trackEl = document.getElementById('pulse-trackers');
        const dataEl = document.getElementById('pulse-data');
        const timeEl = document.getElementById('pulse-time');
        
        if (!s) return;
        if(adsEl) adsEl.textContent = s.adsBlocked ?? 0;
        if(trackEl) trackEl.textContent = s.trackersBlocked ?? 0;
        if(dataEl) dataEl.textContent = formatBytes((s.dataSavedKB || 0) * 1024);
        if(timeEl) timeEl.textContent = formatTime(Math.max(0, Date.now() - (s.sessionStart || Date.now())));
    }

    async function updatePulse() {
        const s = await window.mauzer.pulse.getStats();
        renderPulseStats(s);
    }

    // ============================================================
    // SETTINGS
    // ============================================================
    function applySettings() {
        const s = state.settings;
        const prevTheme = state.currentTheme;
        const theme = s.theme || 'dark';
        const accent = s.accentColor || '#808080';
        const toRgba = (hex, alpha = 1) => {
            const h = hex.replace('#', '');
            const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };
        const accentGlow = toRgba(accent, theme === 'light' ? 0.18 : 0.24);
        const accentHover = toRgba(accent, theme === 'light' ? 0.12 : 0.18);
        // Apply to shell
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
        document.documentElement.style.setProperty('--accent', accent);
        document.documentElement.style.setProperty('--accent-glow', accentGlow);
        document.documentElement.style.setProperty('--accent-hover', accentHover);
        document.documentElement.style.setProperty('--border-accent', accent);
        // Inline dynamic style to override static theme vars
        let dyn = document.getElementById('dynamic-theme-vars');
        if (!dyn) {
            dyn = document.createElement('style');
            dyn.id = 'dynamic-theme-vars';
            document.head.appendChild(dyn);
        }
        dyn.textContent = `:root { color-scheme: ${theme === 'light' ? 'light' : 'dark'}; --accent: ${accent}; --accent-glow: ${accentGlow}; --accent-hover: ${accentHover}; --border-accent: ${accent}; }`;

        // Update theme on ALL open webviews (internal + external) in real time
        state.tabs.forEach(tab => {
            const wv = document.getElementById('wv-' + tab.id);
            if (!wv) return;
            try {
                const url = wv.getURL();
                wv.executeJavaScript(`
                    try {
                        document.documentElement.style.colorScheme = '${theme === 'light' ? 'light' : 'dark'}';
                        document.documentElement.style.setProperty('--accent', '${accent}');
                        document.documentElement.style.setProperty('--accent-glow', '${accentGlow}');
                        document.documentElement.style.setProperty('--accent-hover', '${accentHover}');
                        document.documentElement.style.setProperty('--border-accent', '${accent}');
                        if (location.protocol === 'file:' || location.protocol === 'mauzer:') {
                            document.documentElement.setAttribute('data-theme', '${theme}');
                        }
                    } catch (e) {}
                `).catch(() => {});
                if (url.startsWith('file://') || url.startsWith('mauzer://')) {
                    wv.insertCSS(`:root { color-scheme: ${theme === 'light' ? 'light' : 'dark'}; --accent: ${accent}; --accent-glow: ${accentGlow}; --accent-hover: ${accentHover}; --border-accent: ${accent}; }`).catch(() => {});
                } else {
                    wv.insertCSS(`:root { color-scheme: ${theme === 'light' ? 'light' : 'dark'}; }`).catch(() => {});
                }
            } catch (e) { }
        });

        // If theme changed, force external pages (incl. YouTube/Google) to update instantly
        if (prevTheme && prevTheme !== theme) {
            state.tabs.forEach(tab => {
                const wv = document.getElementById('wv-' + tab.id);
                if (!wv) return;
                try {
                    const url = wv.getURL();
                    if (url && !url.startsWith('file://') && !url.startsWith('mauzer://')) {
                        const isYouTube = url.includes('youtube.com');
                        const isGoogle = url.includes('google.');
                        const prefVal = theme === 'dark' ? 'f6=400' : '';

                        // Update PREF cookies for Google/YouTube to sync dark mode server-side
                        if (isYouTube || isGoogle) {
                            const cookieScript = prefVal
                                ? `document.cookie = "PREF=${prefVal};path=/;domain=.${isYouTube ? 'youtube.com' : 'google.com'}";`
                                : `document.cookie = "PREF=; Max-Age=0; path=/; domain=.${isYouTube ? 'youtube.com' : 'google.com'}";`;
                            wv.executeJavaScript(cookieScript).catch(() => {});
                        }

                        // Override prefers-color-scheme in-page to avoid waiting for reload where possible
                        const prefersScript = `(() => {
                            const t = '${theme}';
                            const meta = document.querySelector('meta[name="color-scheme"]') || document.createElement('meta');
                            meta.name = 'color-scheme';
                            meta.content = t === 'light' ? 'light' : 'dark';
                            if (!meta.parentNode) document.head.prepend(meta);
                            const darkQuery = '(prefers-color-scheme: dark)';
                            const origMatch = window.matchMedia;
                            const fake = {
                                matches: t === 'dark',
                                media: darkQuery,
                                onchange: null,
                                addListener() {}, removeListener() {},
                                addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }
                            };
                            window.matchMedia = (q) => q === darkQuery ? fake : origMatch.call(window, q);
                        })();`;
                        wv.executeJavaScript(prefersScript).catch(() => {});

                        wv.reload();
                    }
                } catch (e) { }
            });
        }

        state.currentTheme = theme;

        if (s.density === 'compact') {
            document.documentElement.style.setProperty('--titlebar-h', '34px');
            document.documentElement.style.setProperty('--navbar-h', '38px');
            document.documentElement.style.setProperty('--tab-h', '28px');
        } else {
            document.documentElement.style.setProperty('--titlebar-h', '40px');
            document.documentElement.style.setProperty('--navbar-h', '44px');
            document.documentElement.style.setProperty('--tab-h', '34px');
        }
        // Always on top
        if (typeof s.alwaysOnTop !== 'undefined') {
            window.mauzer.window.alwaysOnTop(!!s.alwaysOnTop);
        }
        // Language
        applyLanguage();
    }

    // Listen for settings changes from settings page (via IPC)
    window.mauzer.settings.onChanged((newSettings) => {
        state.settings = newSettings;
        applySettings();
        const hint = document.createElement('div');
        hint.textContent = 'Настройки Применены';
        const isLight = (state.settings.theme || '').toLowerCase() === 'light';
        Object.assign(hint.style, {
            position: 'fixed', top: '96px', right: '16px',
            padding: '6px 10px',
            borderRadius: '10px',
            background: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(18,18,18,0.85)',
            border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.08)',
            color: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.6)',
            fontSize: '12px',
            fontWeight: '500',
            letterSpacing: '0.2px',
            pointerEvents: 'none', zIndex: '9000',
            animation: 'toast-in 0.3s ease-out, toast-out 0.3s ease 1.5s forwards'
        });
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 2200);
    });

    // ============================================================
    // KEYBOARD SHORTCUTS
    // ============================================================
    function handleShortcut(key, ctrl, shift) {
        if (ctrl && (key === 't' || key === 'T') && !shift) { createTab('', { allowDuplicateHome: true }); return true; }
        if (ctrl && (key === 'w' || key === 'W') && !shift) { closeTab(state.activeTabId); return true; }
        if (ctrl && !shift && (key === 'n' || key === 'N')) { window.mauzer.window.newWindow(); return true; }
        if (ctrl && shift && (key === 'n' || key === 'N')) { createIncognitoTab(); return true; }
        if (ctrl && shift && (key === 't' || key === 'T')) { restoreClosedTab(); return true; }
        if (ctrl && (key === 'k' || key === 'K') && !shift) { toggleCommandPalette(); return true; }
        if (ctrl && (key === 'f' || key === 'F') && !shift) { toggleFindBar(); return true; }
        if (ctrl && (key === 'h' || key === 'H') && !shift) {
            if (state.sidebarOpen && state.sidebarPanel === 'history') { state.sidebarOpen = false; dom.sidebar.style.display = 'none'; }
            else { state.sidebarOpen = true; dom.sidebar.style.display = ''; renderSidebarPanel('history'); }
            return true;
        }
        if (ctrl && (key === 'j' || key === 'J') && !shift) {
            if (state.sidebarOpen && state.sidebarPanel === 'downloads') { state.sidebarOpen = false; dom.sidebar.style.display = 'none'; }
            else { state.sidebarOpen = true; dom.sidebar.style.display = ''; renderSidebarPanel('downloads'); }
            return true;
        }
        if (ctrl && (key === 'l' || key === 'L') && !shift) { dom.urlInput.focus(); dom.urlInput.select(); return true; }
        if (ctrl && (key === 'p' || key === 'P') && !shift) { printPage(); return true; }
        if (ctrl && (key === 'r' || key === 'R') && !shift) { document.getElementById('wv-' + state.activeTabId)?.reload(); return true; }
        if (ctrl && (key === '=' || key === '+')) { setZoom(0.1); return true; }
        if (ctrl && key === '-') { setZoom(-0.1); return true; }
        if (ctrl && key === '0') { resetZoom(); return true; }
        if (key === 'F5') { document.getElementById('wv-' + state.activeTabId)?.reload(); return true; }
        if (key === 'F11') { window.mauzer.window.fullscreen(); return true; }
        if (key === 'F12') { openDevTools(); return true; }
        if (ctrl && key >= '1' && key <= '9') {
            const idx = parseInt(key) - 1;
            if (state.tabs[idx]) switchTab(state.tabs[idx].id);
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
        if (handleShortcut(e.key, ctrl, shift)) { e.preventDefault(); }
        if (e.key === 'Escape') {
            hideContextMenu();
            if (dom.commandPalette.style.display !== 'none') toggleCommandPalette();
            if (dom.findBar.style.display !== 'none') toggleFindBar();
        }
        if (ctrl && e.key >= '1' && e.key <= '9') { e.preventDefault(); }
    });

    // Handle shortcuts forwarded from webview via main process IPC
    window.mauzer.on.shortcut((data) => {
        handleShortcut(data.key, data.ctrl, data.shift);
    });

    // ============================================================
    // INTRO
    // ============================================================
    async function initIntro() {
        let version = '';
        try {
            const info = await window.mauzer.app.getInfo();
            version = info?.version || '';
        } catch (e) { }
        const lastIntroVersion = state.settings.lastIntroVersion || '';
        if (!version || version === lastIntroVersion) {
            hideIntro();
            return;
        }
        showIntro(version);
    }

    function hideIntro() {
        if (state.introShown) return;
        state.introShown = true;
        if (_introTimer) {
            clearTimeout(_introTimer);
            _introTimer = null;
        }
        dom.introOverlay?.classList.remove('show');
        dom.introSkip?.classList.remove('show');
        if (_introVersion && state.settings.lastIntroVersion !== _introVersion) {
            state.settings.lastIntroVersion = _introVersion;
            window.mauzer.settings.save(state.settings);
        }
    }

    function showIntro(version) {
        if (state.introShown) return;
        _introVersion = version || '';
        if (dom.introSkip) dom.introSkip.textContent = t('skip');
        const introUrl = new URL('../MAUZER PREVIEW.mp4', window.location.href).href;
        if (dom.introVideo) {
            dom.introVideo.src = introUrl;
            dom.introVideo.currentTime = 0;
            dom.introVideo.onended = hideIntro;
            dom.introVideo.play().catch(() => { });
        }
        dom.introOverlay?.classList.add('show');
        dom.introSkip?.classList.add('show');
        if (_introTimer) clearTimeout(_introTimer);
        _introTimer = setTimeout(() => hideIntro(), 15000);
        dom.introSkip?.addEventListener('click', hideIntro, { once: true });
    }

    // ============================================================
    // EVENT BINDINGS
    // ============================================================
    function bindEvents() {
        dom.btnMinimize.addEventListener('click', () => window.mauzer.window.minimize());
        dom.btnMaximize.addEventListener('click', () => window.mauzer.window.maximize());
        dom.btnClose.addEventListener('click', () => window.mauzer.window.close());

        dom.btnBack.addEventListener('click', () => document.getElementById('wv-' + state.activeTabId)?.goBack());
        dom.btnForward.addEventListener('click', () => document.getElementById('wv-' + state.activeTabId)?.goForward());
        dom.btnReload.addEventListener('click', () => document.getElementById('wv-' + state.activeTabId)?.reload());
        dom.btnHome.addEventListener('click', () => { const wv = document.getElementById('wv-' + state.activeTabId); if (wv) wv.src = newtabUrl(); });

        dom.btnNewTab.addEventListener('click', () => createTab('', { allowDuplicateHome: true }));
        dom.tabStrip.addEventListener('dblclick', (e) => { if (!e.target.closest('.tab') && !e.target.closest('.btn-new-tab')) createTab('', { allowDuplicateHome: true }); });
        dom.tabStrip.addEventListener('wheel', (e) => { e.preventDefault(); dom.tabStrip.scrollLeft += e.deltaY; }, { passive: false });

        dom.urlInput.addEventListener('keydown', (e) => {
            const items = dom.urlSuggestions.querySelectorAll('.suggestion-item');
            if (e.key === 'ArrowDown') {
                if (dom.urlSuggestions.style.display !== 'none') {
                    e.preventDefault();
                    _suggestIndex = Math.min(_suggestIndex + 1, items.length - 1);
                    updateSuggestSelection(items);
                }
            } else if (e.key === 'ArrowUp') {
                if (dom.urlSuggestions.style.display !== 'none') {
                    e.preventDefault();
                    _suggestIndex = Math.max(_suggestIndex - 1, -1);
                    updateSuggestSelection(items);
                }
            } else if (e.key === 'Enter') {
                if (_suggestIndex >= 0 && items[_suggestIndex]) {
                    e.preventDefault();
                    navigate(items[_suggestIndex].dataset.val);
                    hideUrlSuggestions();
                } else {
                    navigate(dom.urlInput.value);
                    hideUrlSuggestions();
                }
            } else if (e.key === 'Escape') {
                dom.urlInput.blur();
                hideUrlSuggestions();
            }
        });
        
        let _suggestTimer;
        let _suggestIndex = -1;

        dom.urlInput.addEventListener('input', () => {
            dom.urlClear.style.display = dom.urlInput.value ? 'flex' : 'none';
            const val = dom.urlInput.value.trim();
            clearTimeout(_suggestTimer);
            if (!val) {
                hideUrlSuggestions();
                return;
            }
            _suggestTimer = setTimeout(async () => {
                if (window.mauzer && window.mauzer.search) {
                    try {
                        const results = await window.mauzer.search.suggest(val);
                        renderUrlSuggestions(results);
                    } catch (e) {
                        hideUrlSuggestions();
                    }
                }
            }, 150);
        });

        dom.urlInput.addEventListener('focus', () => {
            dom.urlInput.select();
            if (dom.urlInput.value.trim()) dom.urlInput.dispatchEvent(new Event('input'));
        });
        
        dom.urlInput.addEventListener('blur', (e) => {
            // Delay hide to allow click
            setTimeout(() => hideUrlSuggestions(), 200);
        });

        function updateSuggestSelection(items) {
            items.forEach((item, i) => {
                item.classList.toggle('selected', i === _suggestIndex);
                if (i === _suggestIndex) {
                    // Optional: update input value but keep original query somewhere?
                    // For now just highlight
                }
            });
        }

        function renderUrlSuggestions(list) {
            if (!list || !list.length) {
                hideUrlSuggestions();
                return;
            }
            dom.urlSuggestions.innerHTML = list.map(text => `
                <li class="suggestion-item" data-val="${text.replace(/"/g, '&quot;')}">
                    <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:10px;opacity:0.6">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <span>${text}</span>
                </li>
            `).join('');
            dom.urlSuggestions.style.display = 'block';
            _suggestIndex = -1;
        }

        function hideUrlSuggestions() {
            dom.urlSuggestions.style.display = 'none';
            _suggestIndex = -1;
        }

        dom.urlSuggestions.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                navigate(item.dataset.val);
                hideUrlSuggestions();
            }
        });

        dom.urlClear.addEventListener('click', () => { dom.urlInput.value = ''; dom.urlInput.focus(); hideUrlSuggestions(); });

        dom.urlCopy.addEventListener('click', () => { navigator.clipboard.writeText(dom.urlInput.value || ''); toast('URL скопирован'); });
        dom.urlQr.addEventListener('click', showQrCode);
        dom.urlBookmark.addEventListener('click', async () => {
            const t = state.tabs.find(x => x.id === state.activeTabId);
            if (t) { await window.mauzer.bookmarks.add({ url: t.url, title: t.title, favicon: t.favicon }); toast('Закладка добавлена', 'success'); dom.urlBookmark.classList.add('bookmarked'); }
        });

        dom.btnSidebar.addEventListener('click', toggleSidebar);
        $$('.sidebar-tab').forEach(btn => btn.addEventListener('click', () => renderSidebarPanel(btn.dataset.panel)));

        dom.findInput.addEventListener('input', () => { const wv = document.getElementById('wv-' + state.activeTabId); if (wv && dom.findInput.value) wv.findInPage(dom.findInput.value); });
        dom.findNext.addEventListener('click', () => { const wv = document.getElementById('wv-' + state.activeTabId); if (wv) wv.findInPage(dom.findInput.value); });
        dom.findPrev.addEventListener('click', () => { const wv = document.getElementById('wv-' + state.activeTabId); if (wv) wv.findInPage(dom.findInput.value, { forward: false }); });
        dom.findClose.addEventListener('click', toggleFindBar);
        dom.zoomReset.addEventListener('click', resetZoom);

        // Feature buttons
        dom.btnPulse.addEventListener('click', (e) => { 
            e.stopPropagation();
            dom.pulsePanel.style.display = dom.pulsePanel.style.display === 'none' ? '' : 'none'; 
            updatePulse(); 
        });
        dom.pulseClose.addEventListener('click', () => { dom.pulsePanel.style.display = 'none'; });

        // Close Pulse panel on outside click
        document.addEventListener('mousedown', (e) => {
            if (dom.pulsePanel.style.display !== 'none' && !dom.pulsePanel.contains(e.target) && !dom.btnPulse.contains(e.target)) {
                dom.pulsePanel.style.display = 'none';
            }
        });

        // Close panels when window loses focus (e.g. clicking into webview)
        window.addEventListener('blur', () => {
            if (dom.pulsePanel.style.display !== 'none') dom.pulsePanel.style.display = 'none';
            if (dom.downloadsPanel.style.display !== 'none') dom.downloadsPanel.style.display = 'none';
            hideUrlSuggestions();
        });

        dom.btnScreenshot.addEventListener('click', takeScreenshot);

        // Downloads button
        dom.btnDownloads.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = dom.downloadsPanel;
            if (panel.style.display !== 'none') {
                panel.style.display = 'none';
            } else {
                dom.pulsePanel.style.display = 'none';
                hideContextMenu();
                panel.style.display = '';
                renderDownloadsPanel();
            }
        });
        dom.downloadsOpenFolder.addEventListener('click', () => {
            window.mauzer.actions.openDownloadsFolder?.();
        });
        dom.downloadsClear.addEventListener('click', () => {
            state.downloadsList = [];
            renderDownloadsPanel();
        });
        dom.downloadsShowAll.addEventListener('click', () => {
            dom.downloadsPanel.style.display = 'none';
            renderSidebarPanel('downloads');
            if (!state.sidebarOpen) toggleSidebar();
        });

        // MENU BUTTON → Dropdown menu (NOT command palette)
        dom.btnMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_menuOpen) {
                hideContextMenu();
            } else {
                showDropdownMenu();
            }
        });

        // Command palette input
        dom.commandInput.addEventListener('input', () => renderCommands(dom.commandInput.value));
        dom.commandPalette.addEventListener('click', (e) => { if (e.target === dom.commandPalette) toggleCommandPalette(); });

        window.addEventListener('resize', () => {
            if (dom.contextMenu.style.display !== 'none') {
                positionContextMenu(0, 0, _contextMenuAnchor);
            }
            requestAnimationFrame(updateWebviewSize);
        });

        // Close downloads panel on outside click
        document.addEventListener('mousedown', (e) => {
            if (dom.downloadsPanel.style.display !== 'none' && !dom.downloadsPanel.contains(e.target) && !dom.btnDownloads.contains(e.target)) {
                dom.downloadsPanel.style.display = 'none';
            }
        });

        // Ripple
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.nav-btn, .feature-btn, .window-btn, .btn-new-tab');
            if (!btn) return;
            const ripple = document.createElement('span'); ripple.className = 'ripple';
            const rect = btn.getBoundingClientRect();
            ripple.style.left = (e.clientX - rect.left) + 'px'; ripple.style.top = (e.clientY - rect.top) + 'px';
            btn.appendChild(ripple); setTimeout(() => ripple.remove(), 500);
        });

        // Ctrl + Mouse Wheel Zoom
        dom.webviewContainer.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            setZoom(e.deltaY < 0 ? 0.1 : -0.1);
        }, { passive: false });

        // Download bar close
        dom.downloadBarClose.addEventListener('click', () => {
            dom.downloadBar.style.display = 'none';
        });
        dom.updateBannerBtn?.addEventListener('click', () => {
            if (_updateBannerAction) _updateBannerAction();
        });
        dom.updateBannerHide?.addEventListener('click', () => {
            _updateBannerMinimized = true;
            applyUpdateBannerVisibility();
        });
        dom.updateMini?.addEventListener('click', () => {
            _updateBannerMinimized = false;
            applyUpdateBannerVisibility();
        });

        // IPC listeners
        window.mauzer.window.onStateChanged((d) => { dom.btnMaximize.title = d.maximized ? 'Восстановить' : 'Развернуть'; });
        window.mauzer.window.onFullscreenChanged((fs) => {
            dom.shell.classList.toggle('fullscreen', fs);
            if (!fs) dom.shell.classList.remove('fs-hidden'); // reset on exit fullscreen
        });
        // Live Pulse updates from main
        window.mauzer.pulse.onUpdate((data) => renderPulseStats(data));

        // Fullscreen menu toggle button
        const fsToggle = document.getElementById('btn-fs-toggle');
        fsToggle.addEventListener('click', () => {
            const hidden = dom.shell.classList.toggle('fs-hidden');
            // Flip chevron: up = hide, down = show
            fsToggle.innerHTML = hidden
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        });
        window.mauzer.on.openUrl((url) => createTab(url));
        window.mauzer.on.toast((data) => toast(data.message, data.type));
        if (window.mauzer.updater?.onStatus) {
            window.mauzer.updater.onStatus((d) => {
                if (!d || !d.status) return;
                const labels = updateLabels();
                if (d.status === 'available') {
                    _updatePct = -1;
                    const version = d.info?.version || '';
                    const manualUrl = d.info?.manualUrl || '';
                    const isManual = !!manualUrl;
                    _manualUpdateAvailable = isManual;
                    showUpdateBanner({
                        title: labels.available,
                        subtitle: version ? labels.version(version) : '',
                        button: labels.download,
                        disabled: false,
                        action: isManual ? () => {
                            window.mauzer.shell.openExternal?.(manualUrl);
                        } : async () => {
                            showUpdateBanner({
                                title: labels.available,
                                subtitle: labels.downloading(0),
                                button: labels.downloadingBtn,
                                disabled: true
                            });
                            try {
                                await window.mauzer.updater.download?.();
                            } catch (e) {
                                hideUpdateBanner();
                                toast('Ошибка обновления: ' + (e?.message || 'неизвестно'), 'error');
                            }
                        }
                    });
                } else if (d.status === 'downloading') {
                    _manualUpdateAvailable = false;
                    const pct = Math.max(0, Math.min(100, Math.round(d.percent || 0)));
                    if (_updatePct < 0 || pct === 100 || pct - _updatePct >= 5) {
                        _updatePct = pct;
                        showUpdateBanner({
                            title: labels.available,
                            subtitle: labels.downloading(pct),
                            button: labels.downloadingBtn,
                            disabled: true
                        });
                    }
                } else if (d.status === 'downloaded') {
                    _updatePct = -1;
                    _manualUpdateAvailable = false;
                    const version = d.info?.version || '';
                    showUpdateBanner({
                        title: labels.ready,
                        subtitle: version ? labels.version(version) : '',
                        button: labels.install,
                        disabled: false,
                        action: () => window.mauzer.updater.restart?.()
                    });
                } else if (d.status === 'not-available') {
                    _updatePct = -1;
                    if (_manualUpdateAvailable) return;
                    hideUpdateBanner();
                } else if (d.status === 'error') {
                    _updatePct = -1;
                    if (_manualUpdateAvailable) return;
                    hideUpdateBanner();
                    const msg = (d.message || '').toLowerCase();
                    if (msg.includes('unpublish') || msg.includes('not found') || msg.includes('publish')) return;
                    toast('Ошибка обновления: ' + (d.message || 'неизвестно'), 'error');
                }
            });
        }

        // Download progress bar + panel
        window.mauzer.downloads.onProgress((d) => {
            dom.downloadBar.style.display = '';
            dom.downloadBarName.textContent = d.filename;
            const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
            dom.downloadBarFill.style.width = pct + '%';
            dom.downloadBarStats.textContent = `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)} — ${pct}%`;
            // Update downloads panel list
            const existing = state.downloadsList.find(x => x.filename === d.filename);
            if (existing) {
                existing.receivedBytes = d.receivedBytes;
                existing.totalBytes = d.totalBytes;
                existing.state = 'progressing';
            } else {
                state.downloadsList.unshift({ filename: d.filename, receivedBytes: d.receivedBytes, totalBytes: d.totalBytes, state: 'progressing' });
            }
            if (dom.downloadsPanel.style.display !== 'none') renderDownloadsPanel();
        });

        window.mauzer.downloads.onComplete((d) => {
            dom.downloadBarName.textContent = d.filename;
            dom.downloadBarFill.style.width = '100%';
            dom.downloadBarStats.textContent = 'Готово!';
            toast(`Загружено: ${d.filename}`, 'success');
            // Auto-hide after 4 seconds
            setTimeout(() => { dom.downloadBar.style.display = 'none'; }, 4000);
            // Update panel list
            const existing = state.downloadsList.find(x => x.filename === d.filename);
            if (existing) {
                existing.state = 'completed';
                existing.totalBytes = d.totalBytes || existing.totalBytes || existing.receivedBytes;
            } else {
                state.downloadsList.unshift({ filename: d.filename, receivedBytes: d.totalBytes || 0, totalBytes: d.totalBytes || 0, state: 'completed' });
            }
            if (dom.downloadsPanel.style.display !== 'none') renderDownloadsPanel();
            if (state.sidebarPanel === 'downloads') renderSidebarPanel('downloads');
        });
    }

    // RAM monitor
    setInterval(() => { if (performance.memory) dom.statusRam.textContent = 'RAM: ' + formatBytes(performance.memory.usedJSHeapSize); }, 5000);

    // ============================================================
    // ============================================================
    // SESSION RESTORE
    // ============================================================
    let _saveSessionTimer = null;
    function saveSessionState() {
        if (state.isIncognitoWindow) return;
        
        clearTimeout(_saveSessionTimer);
        _saveSessionTimer = setTimeout(() => {
            const tabsToSave = state.tabs
                // Skip default blank/newtab/incognito pages unless pinned
                .filter(t => {
                    const isBlank = !t.url || t.url === '' || t.url.includes('newtab.html') || t.url.includes('incognito.html') || t.url.startsWith('mauzer://newtab');
                    return !(isBlank && !t.pinned);
                })
                .map(t => ({
                    url: t.url,
                    title: t.title,
                    pinned: t.pinned,
                    favicon: t.favicon,
                    active: t.id === state.activeTabId
                }));
            window.mauzer.sessions.saveCurrent(tabsToSave);
        }, 1000);
    }

    async function restoreSessionState() {
        if (state.isIncognitoWindow) return false;
        
        try {
            const sessionTabs = await window.mauzer.sessions.loadCurrent();
            if (!sessionTabs || !Array.isArray(sessionTabs) || sessionTabs.length === 0) return false;
            
            const shouldRestore = state.settings.restoreSession;
            
            let restoredCount = 0;
            for (const t of sessionTabs) {
                if (shouldRestore || t.pinned) {
                    const newId = createTab(t.url, { title: t.title, pinned: t.pinned, allowDuplicateHome: true });
                    restoredCount++;
                    if (newId && t.url && t.url.includes('youtube.com/watch')) {
                        const wv = document.getElementById('wv-' + newId);
                        if (wv) {
                            const pauseVideo = () => {
                                wv.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v) v.pause(); })();`).catch(() => {});
                            };
                            wv.addEventListener('dom-ready', pauseVideo, { once: true });
                            wv.addEventListener('did-finish-load', pauseVideo, { once: true });
                        }
                    }
                }
            }
            
            if (restoredCount > 0) {
                const activeTab = sessionTabs.find(t => t.active);
                // We could try to switch to the active tab here if needed
                // But for now, just returning true is enough
            }
            
            return restoredCount > 0;
        } catch (e) {
            console.error('Session restore failed:', e);
            return false;
        }
    }

    // ============================================================
    // INIT
    // ============================================================
    async function init() {
        state.settings = await window.mauzer.settings.load();
        if (state.settings.searchEngine === 'yandex') {
            state.settings.searchEngine = 'google';
            await window.mauzer.settings.save(state.settings);
        }
        try { 
            _preloadPath = await window.mauzer.app.getPreloadPath(); 
        } catch (e) { 
            console.error('Failed to get preload path:', e);
            const current = window.location.pathname.replace(/\\/g, '/');
            const root = current.substring(0, current.lastIndexOf('/src/'));
            if (root) _preloadPath = root + '/preload.js';
        }
        try {
            const info = await window.mauzer.app.getInfo();
            if (dom.statusVersion) {
                dom.statusVersion.textContent = info?.version ? `v${info.version}` : '';
            }
        } catch (e) { }
        applySettings();
        if (window.ResizeObserver) {
            _webviewResizeObserver = new ResizeObserver(() => {
                updateWebviewSize();
            });
            _webviewResizeObserver.observe(dom.webviewContainer);
        }
        bindEvents();
        await initIntro();
        
        // Restore session or create new tab
        const restored = await restoreSessionState();
        if (!restored) {
            createTab();
        }
        
        updateWebviewSize();
        setInterval(updatePulse, 10000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

