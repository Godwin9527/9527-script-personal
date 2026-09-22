// ==UserScript==
// @name         9527哔哩哔哩稍后再看快捷键删除
// @namespace    https://github.com/Godwin9527
// @version      1.0.0
// @description  在哔哩哔哩“稍后再看”页面，通过自定义快捷键删除当前播放视频，并交由站内逻辑自动切换下一项
// @author       Godwin9527
// @run-at       document-idle
// @match        *://www.bilibili.com/list/watchlater*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-watchlater-delete-hotkey/bilibili-watchlater-delete-hotkey.user.js
// @updateURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-watchlater-delete-hotkey/bilibili-watchlater-delete-hotkey.meta.js
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'watchlater-delete-hotkey';
    const PANEL_HOST_ID = 'bili-watchlater-delete-hotkey-panel';
    const TOAST_HOST_ID = 'bili-watchlater-delete-hotkey-toast';
    const DELETE_BUTTON_WAIT_MS = 2500;
    const DELETE_REFRESH_WAIT_MS = 5000;
    const MODIFIER_CODES = new Set([
        'AltLeft',
        'AltRight',
        'ControlLeft',
        'ControlRight',
        'MetaLeft',
        'MetaRight',
        'ShiftLeft',
        'ShiftRight'
    ]);
    const CODE_LABELS = {
        ArrowDown: '方向键下',
        ArrowLeft: '方向键左',
        ArrowRight: '方向键右',
        ArrowUp: '方向键上',
        Backquote: '`',
        Backslash: '\\',
        Backspace: 'Backspace',
        BracketLeft: '[',
        BracketRight: ']',
        Comma: ',',
        Delete: 'Delete',
        End: 'End',
        Enter: 'Enter',
        Equal: '=',
        Escape: 'Esc',
        Home: 'Home',
        Insert: 'Insert',
        Minus: '-',
        NumpadAdd: '小键盘 +',
        NumpadDecimal: '小键盘 .',
        NumpadDivide: '小键盘 /',
        NumpadEnter: '小键盘 Enter',
        NumpadMultiply: '小键盘 *',
        NumpadSubtract: '小键盘 -',
        PageDown: 'Page Down',
        PageUp: 'Page Up',
        Period: '.',
        Quote: "'",
        Semicolon: ';',
        Slash: '/',
        Space: '空格',
        Tab: 'Tab'
    };

    let hotkey = loadHotkey();
    let panelHost = null;
    let recording = false;
    let deleting = false;

    function normalizeHotkey(value) {
        if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !value.code) {
            return null;
        }

        return {
            code: value.code,
            ctrl: Boolean(value.ctrl),
            alt: Boolean(value.alt),
            shift: Boolean(value.shift),
            meta: Boolean(value.meta)
        };
    }

    function loadHotkey() {
        try {
            return normalizeHotkey(GM_getValue(STORAGE_KEY, null));
        } catch (error) {
            console.warn('[稍后再看快捷键删除] 读取快捷键失败:', error);
            return null;
        }
    }

    function saveHotkey(value) {
        hotkey = normalizeHotkey(value);

        try {
            GM_setValue(STORAGE_KEY, hotkey);
        } catch (error) {
            console.warn('[稍后再看快捷键删除] 保存快捷键失败:', error);
            showToast('快捷键保存失败，请检查脚本管理器权限。', 'error');
            return;
        }

        updatePanel();
    }

    function getHotkeyLabel(value = hotkey) {
        if (!value) {
            return '未设置';
        }

        const parts = [];
        if (value.ctrl) parts.push('Ctrl');
        if (value.alt) parts.push('Alt');
        if (value.shift) parts.push('Shift');
        if (value.meta) parts.push('Meta');
        parts.push(getCodeLabel(value.code));
        return parts.join(' + ');
    }

    function getCodeLabel(code) {
        if (CODE_LABELS[code]) {
            return CODE_LABELS[code];
        }

        if (/^Key[A-Z]$/.test(code)) {
            return code.slice(3);
        }

        if (/^Digit[0-9]$/.test(code)) {
            return code.slice(5);
        }

        if (/^Numpad[0-9]$/.test(code)) {
            return `小键盘 ${code.slice(6)}`;
        }

        if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
            return code;
        }

        return code;
    }

    function isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        if (target.isContentEditable) {
            return true;
        }

        return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    }

    function matchesHotkey(event, value) {
        return Boolean(
            value &&
            event.code === value.code &&
            event.ctrlKey === value.ctrl &&
            event.altKey === value.alt &&
            event.shiftKey === value.shift &&
            event.metaKey === value.meta
        );
    }

    function getCurrentBvid() {
        try {
            const bvid = new URL(window.location.href).searchParams.get('bvid');
            if (bvid) {
                return bvid;
            }
        } catch (error) {
            console.warn('[稍后再看快捷键删除] 解析当前页面地址失败:', error);
        }

        const activeItem = document.querySelector(
            '.action-list-item-wrap.current[data-key],' +
            '.action-list-item-wrap.is-current[data-key],' +
            '.action-list-item-wrap.active[data-key],' +
            '.action-list-item-wrap.is-active[data-key]'
        );
        return activeItem?.dataset.key || null;
    }

    function escapeAttributeValue(value) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function delay(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    async function waitForDeleteButton(bvid) {
        const selector = `.action-list-item-wrap[data-key="${escapeAttributeValue(bvid)}"]`;
        const deadline = Date.now() + DELETE_BUTTON_WAIT_MS;
        let row = null;

        while (Date.now() < deadline) {
            row = document.querySelector(selector);
            const button = row?.querySelector('.del-btn');
            if (button) {
                return { row, button };
            }
            await delay(100);
        }

        return { row, button: null };
    }

    async function waitForRowRemoval(bvid) {
        const selector = `.action-list-item-wrap[data-key="${escapeAttributeValue(bvid)}"]`;
        const deadline = Date.now() + DELETE_REFRESH_WAIT_MS;

        while (Date.now() < deadline) {
            if (!document.querySelector(selector)) {
                return true;
            }
            await delay(150);
        }

        return false;
    }

    async function deleteCurrentVideo() {
        if (deleting) {
            showToast('正在处理上一次删除，请稍候。');
            return;
        }

        const bvid = getCurrentBvid();
        if (!bvid) {
            showToast('未能识别当前播放视频，请确认页面地址中包含当前视频编号。', 'error');
            return;
        }

        deleting = true;

        try {
            const { row, button } = await waitForDeleteButton(bvid);
            if (!row) {
                showToast('列表中没有找到当前视频，请等待列表加载后重试。', 'error');
                return;
            }

            if (!button) {
                showToast('未找到删除按钮。随机播放模式下 B 站会禁用删除，也可能尚未加载完成。', 'error');
                return;
            }

            button.click();
            showToast('已触发删除，等待 B 站自动切换下一项。');

            const removed = await waitForRowRemoval(bvid);
            if (removed) {
                showToast('已删除，B 站正在自动播放下一项。');
            } else {
                showToast('删除请求已发送，但列表尚未刷新；请检查网络或随机播放模式。', 'error');
            }
        } catch (error) {
            console.error('[稍后再看快捷键删除] 删除当前视频失败:', error);
            showToast('删除失败，请打开控制台查看错误信息。', 'error');
        } finally {
            deleting = false;
        }
    }

    function onKeyDown(event) {
        if (recording) {
            event.preventDefault();
            event.stopImmediatePropagation();
            handleHotkeyRecording(event);
            return;
        }

        if (
            !hotkey ||
            event.repeat ||
            (panelHost && !panelHost.hidden) ||
            isEditableTarget(event.target) ||
            !matchesHotkey(event, hotkey)
        ) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        void deleteCurrentVideo();
    }

    function handleHotkeyRecording(event) {
        if (event.code === 'Escape') {
            recording = false;
            updatePanel('已取消录制。');
            return;
        }

        if (MODIFIER_CODES.has(event.code)) {
            updatePanel('请继续按下非修饰键。');
            return;
        }

        recording = false;
        saveHotkey({
            code: event.code,
            ctrl: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
            meta: event.metaKey
        });
        updatePanel(`已保存：${getHotkeyLabel()}`);
    }

    function openPanel() {
        if (!panelHost) {
            panelHost = createPanel();
        }

        panelHost.hidden = false;
        updatePanel();
    }

    function closePanel() {
        recording = false;
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
                    width: min(420px, 100%);
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

                .setting {
                    padding: 14px;
                    border: 1px solid #e3e5e7;
                    border-radius: 8px;
                    background: #f7f8fa;
                }

                .setting-label {
                    margin-bottom: 7px;
                    color: #61666d;
                    font-size: 13px;
                }

                .hotkey {
                    min-height: 22px;
                    overflow-wrap: anywhere;
                    font-size: 16px;
                    font-weight: 600;
                }

                .message {
                    min-height: 20px;
                    margin: 12px 0 0;
                    color: #61666d;
                    font-size: 13px;
                    line-height: 1.5;
                }

                .actions {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    margin-top: 18px;
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

                button.primary {
                    border-color: #00a1d6;
                    background: #00a1d6;
                    color: #ffffff;
                }

                button.primary:hover {
                    border-color: #008fbe;
                    background: #008fbe;
                }

                button.danger {
                    color: #d03050;
                }

                .close {
                    width: 100%;
                    margin-top: 10px;
                }

                @media (max-width: 420px) {
                    .actions {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
            <div class="overlay">
                <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
                    <h2 id="title">稍后再看删除快捷键</h2>
                    <div class="setting">
                        <div class="setting-label">当前快捷键</div>
                        <div class="hotkey" data-field="hotkey"></div>
                    </div>
                    <p class="message" data-field="message"></p>
                    <div class="actions">
                        <button class="primary" type="button" data-action="record">录制快捷键</button>
                        <button class="danger" type="button" data-action="clear">清除快捷键</button>
                    </div>
                    <button class="close" type="button" data-action="close">关闭</button>
                </section>
            </div>
        `;

        const overlay = shadow.querySelector('.overlay');
        const recordButton = shadow.querySelector('[data-action="record"]');
        const clearButton = shadow.querySelector('[data-action="clear"]');
        const closeButton = shadow.querySelector('[data-action="close"]');

        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) {
                closePanel();
            }
        });

        recordButton.addEventListener('click', () => {
            recording = true;
            recordButton.textContent = '等待按键...';
            updatePanel('请按下要使用的快捷键；按 Esc 取消录制。');
        });

        clearButton.addEventListener('click', () => {
            recording = false;
            saveHotkey(null);
            updatePanel('快捷键已清除。');
        });

        closeButton.addEventListener('click', closePanel);

        document.documentElement.appendChild(host);
        return host;
    }

    function updatePanel(message) {
        if (!panelHost) {
            return;
        }

        const shadow = panelHost.shadowRoot;
        const hotkeyField = shadow?.querySelector('[data-field="hotkey"]');
        const messageField = shadow?.querySelector('[data-field="message"]');
        const recordButton = shadow?.querySelector('[data-action="record"]');

        if (hotkeyField) {
            hotkeyField.textContent = getHotkeyLabel();
        }

        if (messageField) {
            messageField.textContent = message ?? (hotkey ? '' : '默认未设置，不会触发删除。');
        }

        if (recordButton && !recording) {
            recordButton.textContent = '录制快捷键';
        }
    }

    function showToast(message, type = 'info') {
        let host = document.getElementById(TOAST_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = TOAST_HOST_ID;
            host.attachShadow({ mode: 'open' });
            document.documentElement.appendChild(host);
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
    GM_registerMenuCommand('设置稍后再看删除快捷键', openPanel);
})();
