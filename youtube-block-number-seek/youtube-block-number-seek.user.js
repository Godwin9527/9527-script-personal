// ==UserScript==
// @name         9527数字键快捷键拦截
// @namespace    https://github.com/Godwin9527
// @version      2.0.0
// @description  按网站名单拦截主键盘与小键盘数字键，避免网页自带快捷键抢占数字键，同时不影响正常输入
// @author       Godwin9527
// @run-at       document-start
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-block-number-seek/youtube-block-number-seek.user.js
// @updateURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-block-number-seek/youtube-block-number-seek.meta.js
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'number-key-blocker-settings-v1';
    const PANEL_HOST_ID = 'number-key-blocker-panel';
    const TOAST_HOST_ID = 'number-key-blocker-toast';
    const DEBUG = false;
    const DEFAULT_SETTINGS = {
        mode: 'blacklist',
        strict: false,
        domains: ['youtube.com']
    };
    const DIGIT_CODES = new Set([
        'Digit0',
        'Digit1',
        'Digit2',
        'Digit3',
        'Digit4',
        'Digit5',
        'Digit6',
        'Digit7',
        'Digit8',
        'Digit9',
        'Numpad0',
        'Numpad1',
        'Numpad2',
        'Numpad3',
        'Numpad4',
        'Numpad5',
        'Numpad6',
        'Numpad7',
        'Numpad8',
        'Numpad9'
    ]);

    let settings = loadSettings();
    let panelHost = null;

    function cloneDefaultSettings() {
        return {
            mode: DEFAULT_SETTINGS.mode,
            strict: DEFAULT_SETTINGS.strict,
            domains: [...DEFAULT_SETTINGS.domains]
        };
    }

    function normalizeDomain(value) {
        if (typeof value !== 'string') {
            return null;
        }

        const input = value.trim().toLowerCase();
        if (!input || input.includes('*')) {
            return null;
        }

        try {
            const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
            const url = new URL(hasScheme ? input : `http://${input}`);
            let hostname = url.hostname.toLowerCase().replace(/\.+$/, '');

            if (!hostname) {
                return null;
            }

            if (hostname.startsWith('www.')) {
                hostname = hostname.slice(4);
            }

            return hostname || null;
        } catch (error) {
            return null;
        }
    }

    function normalizeSettings(value) {
        const source = value && typeof value === 'object' ? value : {};
        const defaults = cloneDefaultSettings();
        const hasDomains = Array.isArray(source.domains);
        const domains = hasDomains
            ? source.domains.map(normalizeDomain).filter(Boolean)
            : defaults.domains;

        return {
            mode: source.mode === 'whitelist' ? 'whitelist' : defaults.mode,
            strict: Boolean(source.strict),
            domains: [...new Set(domains)].sort((left, right) => left.localeCompare(right))
        };
    }

    function loadSettings() {
        try {
            if (typeof GM_getValue === 'function') {
                return normalizeSettings(GM_getValue(STORAGE_KEY, null));
            }
        } catch (error) {
            console.warn('[9527数字键快捷键拦截] 读取设置失败:', error);
        }

        return normalizeSettings(null);
    }

    function commitSettings(nextSettings, message) {
        const previousSettings = settings;
        const normalizedSettings = normalizeSettings(nextSettings);

        try {
            if (typeof GM_setValue !== 'function') {
                throw new Error('GM_setValue 不可用');
            }
            GM_setValue(STORAGE_KEY, normalizedSettings);
        } catch (error) {
            settings = previousSettings;
            console.warn('[9527数字键快捷键拦截] 保存设置失败:', error);
            showToast('设置保存失败，请检查脚本管理器权限。', 'error');
            renderPanel('保存失败，请检查脚本管理器权限。');
            return false;
        }

        settings = normalizedSettings;
        renderPanel(message);
        return true;
    }

    function domainMatches(hostname, rule) {
        const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
        return host === rule || host.endsWith(`.${rule}`);
    }

    function findCoveringRule(hostname) {
        return settings.domains.find((rule) => domainMatches(hostname, rule)) || null;
    }

    function shouldInterceptHost(hostname) {
        const listed = settings.domains.some((rule) => domainMatches(hostname, rule));
        return settings.mode === 'blacklist' ? listed : !listed;
    }

    function isEditableTarget(event) {
        const path = typeof event.composedPath === 'function'
            ? event.composedPath()
            : [event.target];

        for (const node of path) {
            if (!(node instanceof Element)) {
                continue;
            }

            if (node.isContentEditable) {
                return true;
            }

            if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
                return true;
            }

            const role = node.getAttribute('role');
            if (role === 'textbox' || role === 'searchbox') {
                return true;
            }
        }

        return false;
    }

    function isDigitKey(event) {
        return DIGIT_CODES.has(event.code) && /^[0-9]$/.test(event.key);
    }

    function onKeyDown(event) {
        if (
            event.isComposing ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            isEditableTarget(event) ||
            !shouldInterceptHost(window.location.hostname) ||
            !isDigitKey(event)
        ) {
            return;
        }

        if (settings.strict) {
            event.stopImmediatePropagation();
        } else {
            event.stopPropagation();
        }
        event.preventDefault();

        if (DEBUG) {
            console.debug(
                '[9527数字键快捷键拦截] 已拦截',
                window.location.hostname,
                event.code,
                event.key
            );
        }
    }

    function getModeLabel(mode = settings.mode) {
        return mode === 'whitelist' ? '仅名单外拦截' : '仅名单内拦截';
    }

    function getCurrentStatus() {
        const active = shouldInterceptHost(window.location.hostname);
        return {
            active,
            label: active ? '当前拦截' : '当前放行'
        };
    }

    function addDomain(value) {
        const domain = normalizeDomain(value);
        if (!domain) {
            renderPanel('请输入有效域名，暂不支持通配符。');
            return false;
        }

        if (settings.domains.includes(domain)) {
            renderPanel(`规则名单中已有 ${domain}。`);
            return false;
        }

        const domains = [...settings.domains, domain];
        if (!commitSettings({ ...settings, domains }, `已加入 ${domain}。`)) {
            return false;
        }

        showToast(`已加入规则名单：${domain}`);
        return true;
    }

    function removeDomain(domain) {
        if (!settings.domains.includes(domain)) {
            return false;
        }

        const domains = settings.domains.filter((item) => item !== domain);
        if (!commitSettings({ ...settings, domains }, `已移出 ${domain}。`)) {
            return false;
        }

        showToast(`已移出规则名单：${domain}`);
        return true;
    }

    function openPanel() {
        settings = loadSettings();

        if (!panelHost || !panelHost.isConnected) {
            panelHost = createPanel();
        }

        panelHost.hidden = false;
        renderPanel();

        const input = panelHost.shadowRoot?.querySelector('[data-field="domain-input"]');
        input?.focus();
    }

    function closePanel() {
        if (panelHost) {
            panelHost.hidden = true;
        }
    }

    function createPanel() {
        const host = document.createElement('div');
        host.id = PANEL_HOST_ID;
        host.hidden = true;

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    all: initial;
                    color-scheme: light;
                }

                :host([hidden]) {
                    display: none !important;
                }

                .overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 2147483647;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    box-sizing: border-box;
                    background: rgba(0, 0, 0, 0.42);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                }

                .dialog {
                    width: min(560px, 100%);
                    max-height: min(760px, calc(100vh - 32px));
                    overflow: auto;
                    box-sizing: border-box;
                    padding: 22px;
                    border-radius: 8px;
                    background: #ffffff;
                    color: #18191c;
                    box-shadow: 0 18px 55px rgba(0, 0, 0, 0.24);
                }

                h2 {
                    margin: 0 0 18px;
                    font-size: 19px;
                    line-height: 1.35;
                    font-weight: 650;
                }

                .current {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 14px;
                    padding: 14px;
                    border: 1px solid #e3e5e7;
                    border-radius: 8px;
                    background: #f7f8fa;
                }

                .eyebrow,
                .section-title,
                .list-title {
                    color: #61666d;
                    font-size: 13px;
                }

                .current-host {
                    margin-top: 5px;
                    overflow-wrap: anywhere;
                    font-size: 16px;
                    font-weight: 650;
                }

                .status {
                    flex: 0 0 auto;
                    padding: 5px 9px;
                    border-radius: 6px;
                    background: #eceef0;
                    color: #5b6068;
                    font-size: 13px;
                    font-weight: 600;
                }

                .status.active {
                    background: #e7f3ec;
                    color: #176b3a;
                }

                .current-action {
                    display: flex;
                    justify-content: flex-end;
                    margin-top: 10px;
                }

                .section {
                    margin-top: 18px;
                }

                .section-title,
                .list-title {
                    margin-bottom: 8px;
                    font-weight: 600;
                }

                .mode-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }

                .mode-option {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-height: 42px;
                    box-sizing: border-box;
                    padding: 0 12px;
                    border: 1px solid #d0d3d7;
                    border-radius: 8px;
                    background: #ffffff;
                    cursor: pointer;
                }

                .mode-option:has(input:checked) {
                    border-color: #2563eb;
                    background: #eff5ff;
                    color: #1747a6;
                }

                input[type="radio"],
                input[type="checkbox"] {
                    accent-color: #2563eb;
                }

                .list-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .rule-count {
                    color: #8a8f98;
                    font-size: 13px;
                }

                .rule-list {
                    max-height: 240px;
                    overflow: auto;
                    border: 1px solid #e3e5e7;
                    border-radius: 8px;
                    background: #ffffff;
                }

                .rule-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    min-height: 42px;
                    padding: 0 12px;
                    border-bottom: 1px solid #eceef0;
                    box-sizing: border-box;
                }

                .rule-row:last-child {
                    border-bottom: 0;
                }

                .rule-domain {
                    min-width: 0;
                    overflow-wrap: anywhere;
                    font-size: 14px;
                }

                .empty {
                    padding: 16px 12px;
                    color: #8a8f98;
                    font-size: 13px;
                    text-align: center;
                }

                .add-row {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 8px;
                    margin-top: 8px;
                }

                input[type="text"] {
                    width: 100%;
                    min-height: 38px;
                    padding: 0 11px;
                    border: 1px solid #d0d3d7;
                    border-radius: 6px;
                    box-sizing: border-box;
                    color: #18191c;
                    background: #ffffff;
                    font: inherit;
                    font-size: 14px;
                }

                input[type="text"]:focus {
                    border-color: #2563eb;
                    outline: 2px solid rgba(37, 99, 235, 0.15);
                }

                button {
                    min-height: 38px;
                    padding: 0 14px;
                    border: 1px solid #d0d3d7;
                    border-radius: 6px;
                    background: #ffffff;
                    color: #18191c;
                    font: inherit;
                    font-size: 14px;
                    cursor: pointer;
                }

                button:hover {
                    border-color: #9499a0;
                    background: #f1f2f3;
                }

                button:disabled {
                    color: #8a8f98;
                    background: #f4f5f6;
                    cursor: default;
                }

                button.primary {
                    border-color: #2563eb;
                    background: #2563eb;
                    color: #ffffff;
                }

                button.primary:hover {
                    border-color: #1d4ed8;
                    background: #1d4ed8;
                }

                button.danger {
                    min-height: 30px;
                    padding: 0 9px;
                    border-color: transparent;
                    color: #c0324a;
                    background: transparent;
                }

                button.danger:hover {
                    border-color: #f0c8cf;
                    background: #fff1f3;
                }

                .message {
                    min-height: 20px;
                    margin: 10px 0 0;
                    color: #61666d;
                    font-size: 13px;
                    line-height: 1.5;
                }

                .strict-row {
                    display: flex;
                    align-items: flex-start;
                    gap: 9px;
                    margin-top: 18px;
                    padding-top: 16px;
                    border-top: 1px solid #eceef0;
                    cursor: pointer;
                }

                .strict-copy {
                    display: grid;
                    gap: 3px;
                }

                .strict-title {
                    font-size: 14px;
                    font-weight: 600;
                }

                .strict-hint {
                    color: #7b8088;
                    font-size: 12px;
                    line-height: 1.45;
                }

                .close {
                    width: 100%;
                    margin-top: 18px;
                }

                @media (max-width: 460px) {
                    .dialog {
                        padding: 18px;
                    }

                    .mode-grid,
                    .add-row {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
            <div class="overlay">
                <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
                    <h2 id="title">数字键快捷键拦截</h2>

                    <div class="current">
                        <div>
                            <div class="eyebrow">当前网站</div>
                            <div class="current-host" data-field="current-host"></div>
                        </div>
                        <div class="status" data-field="current-status"></div>
                    </div>
                    <div class="current-action">
                        <button class="primary" type="button" data-action="current-rule"></button>
                    </div>

                    <div class="section">
                        <div class="section-title">拦截模式</div>
                        <div class="mode-grid">
                            <label class="mode-option">
                                <input type="radio" name="block-mode" value="blacklist">
                                <span>仅名单内拦截</span>
                            </label>
                            <label class="mode-option">
                                <input type="radio" name="block-mode" value="whitelist">
                                <span>仅名单外拦截</span>
                            </label>
                        </div>
                    </div>

                    <div class="section">
                        <div class="list-toolbar">
                            <div class="list-title">规则名单</div>
                            <div class="rule-count" data-field="rule-count"></div>
                        </div>
                        <div class="rule-list" data-field="rule-list"></div>
                        <div class="add-row">
                            <input
                                type="text"
                                data-field="domain-input"
                                placeholder="例如：example.com"
                                autocomplete="off"
                                spellcheck="false"
                            >
                            <button class="primary" type="button" data-action="add-domain">添加</button>
                        </div>
                        <p class="message" data-field="message" aria-live="polite"></p>
                    </div>

                    <label class="strict-row">
                        <input type="checkbox" data-field="strict">
                        <span class="strict-copy">
                            <span class="strict-title">严格拦截</span>
                            <span class="strict-hint">默认关闭；开启后可能影响页面级扩展快捷键</span>
                        </span>
                    </label>

                    <button class="close" type="button" data-action="close">关闭</button>
                </section>
            </div>
        `;

        const overlay = shadow.querySelector('.overlay');
        const input = shadow.querySelector('[data-field="domain-input"]');
        const strictInput = shadow.querySelector('[data-field="strict"]');
        const currentRuleButton = shadow.querySelector('[data-action="current-rule"]');
        const addButton = shadow.querySelector('[data-action="add-domain"]');
        const closeButton = shadow.querySelector('[data-action="close"]');

        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) {
                closePanel();
            }
        });

        for (const modeInput of shadow.querySelectorAll('input[name="block-mode"]')) {
            modeInput.addEventListener('change', () => {
                if (!modeInput.checked) {
                    return;
                }

                const mode = modeInput.value === 'whitelist' ? 'whitelist' : 'blacklist';
                if (commitSettings({ ...settings, mode }, `已切换为“${getModeLabel(mode)}”。`)) {
                    showToast(`拦截模式：${getModeLabel(mode)}`);
                }
            });
        }

        strictInput.addEventListener('change', () => {
            const strict = strictInput.checked;
            if (commitSettings({ ...settings, strict }, strict ? '严格拦截已开启。' : '严格拦截已关闭。')) {
                showToast(strict ? '严格拦截已开启' : '严格拦截已关闭');
            }
        });

        currentRuleButton.addEventListener('click', () => {
            const domain = normalizeDomain(window.location.hostname);
            if (!domain) {
                renderPanel('无法识别当前网站域名。');
                return;
            }

            if (settings.domains.includes(domain)) {
                removeDomain(domain);
            } else {
                addDomain(domain);
            }
        });

        addButton.addEventListener('click', () => {
            if (addDomain(input.value)) {
                input.value = '';
            }
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (addDomain(input.value)) {
                    input.value = '';
                }
            }
        });

        shadow.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel();
            }
        });

        closeButton.addEventListener('click', closePanel);

        const mountPoint = document.documentElement || document.body;
        mountPoint.appendChild(host);
        return host;
    }

    function renderPanel(message) {
        if (!panelHost || !panelHost.shadowRoot) {
            return;
        }

        const shadow = panelHost.shadowRoot;
        const hostname = window.location.hostname || window.location.href;
        const status = getCurrentStatus();
        const currentHost = shadow.querySelector('[data-field="current-host"]');
        const currentStatus = shadow.querySelector('[data-field="current-status"]');
        const currentRuleButton = shadow.querySelector('[data-action="current-rule"]');
        const ruleCount = shadow.querySelector('[data-field="rule-count"]');
        const ruleList = shadow.querySelector('[data-field="rule-list"]');
        const strictInput = shadow.querySelector('[data-field="strict"]');
        const messageField = shadow.querySelector('[data-field="message"]');

        if (currentHost) {
            currentHost.textContent = hostname;
        }

        if (currentStatus) {
            currentStatus.textContent = status.label;
            currentStatus.classList.toggle('active', status.active);
        }

        if (currentRuleButton) {
            const exactDomain = normalizeDomain(hostname);
            const coveringRule = findCoveringRule(hostname);
            const hasExactRule = Boolean(exactDomain && settings.domains.includes(exactDomain));

            currentRuleButton.disabled = !hasExactRule && Boolean(coveringRule);
            currentRuleButton.textContent = hasExactRule
                ? '移出当前网站'
                : coveringRule
                    ? `由 ${coveringRule} 覆盖`
                    : '加入当前网站';
        }

        for (const modeInput of shadow.querySelectorAll('input[name="block-mode"]')) {
            modeInput.checked = modeInput.value === settings.mode;
        }

        if (strictInput) {
            strictInput.checked = settings.strict;
        }

        if (ruleCount) {
            ruleCount.textContent = `${settings.domains.length} 条`;
        }

        if (ruleList) {
            ruleList.replaceChildren();

            if (settings.domains.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = '名单为空';
                ruleList.appendChild(empty);
            } else {
                for (const domain of settings.domains) {
                    const row = document.createElement('div');
                    row.className = 'rule-row';

                    const label = document.createElement('div');
                    label.className = 'rule-domain';
                    label.textContent = domain;

                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.className = 'danger';
                    removeButton.textContent = '删除';
                    removeButton.setAttribute('aria-label', `删除 ${domain}`);
                    removeButton.addEventListener('click', () => {
                        removeDomain(domain);
                    });

                    row.append(label, removeButton);
                    ruleList.appendChild(row);
                }
            }
        }

        if (messageField) {
            if (message) {
                messageField.textContent = message;
            } else if (settings.mode === 'whitelist' && settings.domains.length === 0) {
                messageField.textContent = '当前未设置例外网站，所有网页都会拦截数字键。';
            } else {
                messageField.textContent = '';
            }
        }
    }

    function showToast(message, type = 'info') {
        let host = document.getElementById(TOAST_HOST_ID);
        if (!host || !host.isConnected) {
            host = document.createElement('div');
            host.id = TOAST_HOST_ID;
            host.attachShadow({ mode: 'open' });
            (document.documentElement || document.body).appendChild(host);
        }

        const shadow = host.shadowRoot;
        shadow.innerHTML = `
            <style>
                :host {
                    all: initial;
                    color-scheme: light;
                }

                .toast {
                    position: fixed;
                    left: 50%;
                    bottom: 32px;
                    z-index: 2147483646;
                    max-width: min(460px, calc(100vw - 32px));
                    box-sizing: border-box;
                    padding: 11px 16px;
                    transform: translateX(-50%);
                    border: 1px solid rgba(255, 255, 255, 0.18);
                    border-radius: 7px;
                    background: #232528;
                    color: #ffffff;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
                    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                    text-align: center;
                }

                .toast.error {
                    background: #8f2337;
                }
            </style>
            <div class="toast ${type === 'error' ? 'error' : ''}" role="status"></div>
        `;
        shadow.querySelector('.toast').textContent = message;

        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => {
            host.remove();
        }, 3200);
    }

    window.addEventListener('keydown', onKeyDown, true);

    if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('数字键拦截设置', openPanel);
    }
})();
