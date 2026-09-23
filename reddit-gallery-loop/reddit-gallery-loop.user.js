// ==UserScript==
// @name         9527Reddit图集增强
// @namespace    https://github.com/Godwin9527
// @version      1.0.1
// @description  放大 Reddit 帖子图集的左右切换箭头（悬停显示、大小可调），并支持首尾循环切换，图片放大查看时同样生效
// @author       Godwin9527
// @run-at       document-idle
// @match        *://www.reddit.com/*
// @match        *://sh.reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-gallery-loop/reddit-gallery-loop.user.js
// @updateURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-gallery-loop/reddit-gallery-loop.meta.js
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'reddit-gallery-arrow-size';
    const PANEL_HOST_ID = 'reddit-gallery-arrow-size-panel';
    const TOAST_HOST_ID = 'reddit-gallery-arrow-size-toast';
    const STORAGE_PREFIX = '9527-reddit-gallery:';
    const DEFAULT_ARROW_SIZE = 44;
    const MIN_ARROW_SIZE = 24;
    const MAX_ARROW_SIZE = 120;
    const SIZE_OPTIONS = [32, 40, 44, 48, 56, 64];
    const HOVER_TRANSITION_MS = 160;
    const RESCAN_RETRY_MS = 500;
    const RESCAN_DEBOUNCE_MS = 150;

    const loopBoundCarousels = new WeakSet();
    const hoverBoundCarousels = new WeakSet();

    let arrowSize = loadArrowSize();
    let panelHost = null;
    let rescanTimer = 0;
    let retryTimer = 0;

    function loadArrowSize() {
        let value = null;
        try {
            value = storageGet(STORAGE_KEY, DEFAULT_ARROW_SIZE);
        } catch (error) {
            console.warn('[Reddit图集增强] 读取箭头大小失败:', error);
        }
        return clampArrowSize(Number(value));
    }

    function storageGet(key, defaultValue) {
        if (typeof GM_getValue === 'function') {
            return GM_getValue(key, defaultValue);
        }
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        return raw === null ? defaultValue : JSON.parse(raw);
    }

    function storageSet(key, value) {
        if (typeof GM_setValue === 'function') {
            GM_setValue(key, value);
            return;
        }
        window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    }

    function clampArrowSize(value) {
        if (!Number.isFinite(value)) {
            return DEFAULT_ARROW_SIZE;
        }
        return Math.min(MAX_ARROW_SIZE, Math.max(MIN_ARROW_SIZE, Math.round(value)));
    }

    function saveArrowSize(value) {
        arrowSize = clampArrowSize(Number(value));
        try {
            storageSet(STORAGE_KEY, arrowSize);
        } catch (error) {
            console.warn('[Reddit图集增强] 保存箭头大小失败:', error);
            showToast('箭头大小保存失败，请检查脚本管理器权限。', 'error');
            return false;
        }
        return true;
    }

    function getIconSize(size) {
        return Math.max(14, Math.round(size * 0.45));
    }

    function collectGalleryCarousels() {
        const results = [];
        for (const host of document.querySelectorAll('gallery-carousel')) {
            const carousel = host.shadowRoot?.querySelector('faceplate-carousel');
            if (carousel) {
                results.push(carousel);
            }
        }
        return results;
    }

    function processAll() {
        let pending = false;
        for (const carousel of collectGalleryCarousels()) {
            if (!processCarousel(carousel)) {
                pending = true;
            }
        }
        if (pending) {
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(processAll, RESCAN_RETRY_MS);
        }
    }

    function processCarousel(carousel) {
        if (!carousel.shadowRoot) {
            return false;
        }
        styleArrows(carousel, carousel.matches(':hover'));
        bindHover(carousel);
        bindLoop(carousel);
        return true;
    }

    function styleArrows(carousel, shown) {
        const iconSize = getIconSize(arrowSize);
        for (const slotName of ['prevButton', 'nextButton']) {
            const slot = carousel.querySelector(`span[slot="${slotName}"]`);
            const button = slot?.querySelector('button');
            if (!button) {
                continue;
            }
            button.style.boxSizing = 'border-box';
            button.style.width = `${arrowSize}px`;
            button.style.height = `${arrowSize}px`;
            button.style.transition = `opacity ${HOVER_TRANSITION_MS}ms ease`;
            button.style.opacity = shown ? '1' : '0';
            button.style.pointerEvents = shown ? 'auto' : 'none';
            const icon = button.querySelector('svg');
            if (icon) {
                icon.setAttribute('width', String(iconSize));
                icon.setAttribute('height', String(iconSize));
            }
        }
    }

    function bindHover(carousel) {
        if (hoverBoundCarousels.has(carousel)) {
            return;
        }
        hoverBoundCarousels.add(carousel);
        carousel.addEventListener('pointerenter', () => styleArrows(carousel, true));
        carousel.addEventListener('pointerleave', () => styleArrows(carousel, false));
    }

    function bindLoop(carousel) {
        if (loopBoundCarousels.has(carousel)) {
            return;
        }
        loopBoundCarousels.add(carousel);
        carousel.shadowRoot.addEventListener('click', (event) => {
            handleCarouselClick(carousel, event);
        }, true);
    }

    function handleCarouselClick(carousel, event) {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (!button) {
            return;
        }
        const slot = button.closest('span[slot]')?.getAttribute('slot');
        if (slot !== 'nextButton' && slot !== 'prevButton') {
            return;
        }
        let pageIndex;
        let pageCount;
        try {
            pageIndex = carousel.pageIndex;
            pageCount = carousel.pageCount;
        } catch (error) {
            return;
        }
        if (!Number.isFinite(pageIndex) || !Number.isFinite(pageCount) || pageCount <= 1) {
            return;
        }
        if (slot === 'nextButton' && pageIndex >= pageCount - 1) {
            wrapToPage(carousel, 0, event);
        } else if (slot === 'prevButton' && pageIndex <= 0) {
            wrapToPage(carousel, pageCount - 1, event);
        }
    }

    function wrapToPage(carousel, page, event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof carousel.goToPage === 'function') {
            carousel.goToPage(page, true);
            return;
        }
        const slot = carousel.carouselSlot;
        if (slot) {
            slot.scrollTo({ left: page === 0 ? 0 : slot.scrollWidth, behavior: 'auto' });
        }
    }

    function openPanel() {
        if (!panelHost || !panelHost.isConnected) {
            panelHost = createPanel();
        }
        panelHost.hidden = false;
        const shadow = panelHost.shadowRoot;
        const sizeInput = shadow?.querySelector('[data-field="size-input"]');
        if (sizeInput) {
            sizeInput.value = String(arrowSize);
        }
        updatePanel('修改后点击“保存”立即生效。');
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

                .size-line {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .size-value {
                    min-width: 64px;
                    font-size: 16px;
                    font-weight: 600;
                }

                input[type="number"] {
                    width: 90px;
                    min-height: 34px;
                    padding: 0 10px;
                    border: 1px solid #d0d3d7;
                    border-radius: 6px;
                    font: inherit;
                    font-size: 14px;
                    box-sizing: border-box;
                }

                .presets {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 10px;
                }

                .presets button {
                    min-height: 32px;
                    padding: 0 12px;
                }

                .message {
                    min-height: 20px;
                    margin: 12px 0 0;
                    color: #61666d;
                    font-size: 13px;
                    line-height: 1.5;
                }

                .actions {
                    display: flex;
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
                    border-color: #ff4500;
                    background: #ff4500;
                    color: #ffffff;
                }

                button.primary:hover {
                    border-color: #e03d00;
                    background: #e03d00;
                }

                .close {
                    width: 100%;
                    margin-top: 10px;
                }
            </style>
            <div class="overlay">
                <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
                    <h2 id="title">Reddit 图集箭头大小</h2>
                    <div class="setting">
                        <div class="setting-label">箭头大小（像素，24 - 120）</div>
                        <div class="size-line">
                            <div class="size-value" data-field="size-value"></div>
                            <input type="number" data-field="size-input" min="${MIN_ARROW_SIZE}" max="${MAX_ARROW_SIZE}" step="2">
                        </div>
                        <div class="presets">
                            ${SIZE_OPTIONS.map((size) => `<button type="button" data-action="preset" data-size="${size}">${size}</button>`).join('')}
                        </div>
                    </div>
                    <p class="message" data-field="message"></p>
                    <div class="actions">
                        <button class="primary" type="button" data-action="save">保存</button>
                    </div>
                    <button class="close" type="button" data-action="close">关闭</button>
                </section>
            </div>
        `;

        const overlay = shadow.querySelector('.overlay');
        const sizeInput = shadow.querySelector('[data-field="size-input"]');
        const saveButton = shadow.querySelector('[data-action="save"]');
        const closeButton = shadow.querySelector('[data-action="close"]');

        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) {
                closePanel();
            }
        });

        for (const presetButton of shadow.querySelectorAll('[data-action="preset"]')) {
            presetButton.addEventListener('click', () => {
                sizeInput.value = presetButton.dataset.size;
                updatePanel(`已选择 ${presetButton.dataset.size} px，点击“保存”生效。`);
            });
        }

        saveButton.addEventListener('click', () => {
            const value = clampArrowSize(Number(sizeInput.value));
            sizeInput.value = String(value);
            if (!saveArrowSize(value)) {
                return;
            }
            processAll();
            updatePanel(`已保存：${arrowSize} px，移动到图集上即可看到效果。`);
            showToast(`图集箭头大小已设为 ${arrowSize} px`);
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
        const sizeValue = shadow?.querySelector('[data-field="size-value"]');
        const messageField = shadow?.querySelector('[data-field="message"]');

        if (sizeValue) {
            sizeValue.textContent = `${arrowSize} px`;
        }

        if (messageField) {
            messageField.textContent = message ?? '';
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

    function start() {
        processAll();

        const observer = new MutationObserver(() => {
            window.clearTimeout(rescanTimer);
            rescanTimer = window.setTimeout(processAll, RESCAN_DEBOUNCE_MS);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('设置图集箭头大小', openPanel);
        }
    }

    start();
})();
