// ==UserScript==
// @name         9527YouTube滚动小窗
// @namespace    https://github.com/Godwin9527
// @version      1.0.0
// @description  YouTube 页面向下滚动后自动将播放器固定为可拖动、可缩放的悬浮小窗，并记忆位置和尺寸
// @author       Godwin9527
// @run-at       document-start
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-scroll-miniplayer/youtube-scroll-miniplayer.user.js
// @updateURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-scroll-miniplayer/youtube-scroll-miniplayer.meta.js
// ==/UserScript==

(() => {
    'use strict';

    // ==================== 可调配置 ====================

    const CONFIG = {
        // 首次使用时的小窗尺寸与右下角边距
        defaultWidth: 480,
        defaultMargin: 24,

        // 手动缩放时允许的最小尺寸
        minWidth: 240,
        minHeight: 135,

        // 原播放器底部距离视口顶部不超过该值时进入小窗模式
        activateWhenPlayerBottom: 96,

        // 原播放器底部重新露出该高度时退出小窗模式，形成防抖区间
        deactivateWhenPlayerBottom: 184,

        // 影院模式使用 #player-full-bleed-container，可单独关闭
        enableTheaterMode: true,

        debug: false
    };

    const STORAGE_KEY = 'yt-scroll-miniplayer-geometry';
    const STYLE_ID = 'yt9527-scroll-miniplayer-style';
    const ACTIVE_CLASS = 'yt9527-scroll-miniplayer-active';
    const INTERACTING_CLASS = 'yt9527-scroll-miniplayer-interacting';
    const CONTROLS_CLASS = 'yt9527-scroll-miniplayer-controls';
    const HTML_INTERACTING_CLASS = 'yt9527-scroll-miniplayer-html-interacting';
    const RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

    const state = {
        active: false,
        target: null,
        controls: null,
        preferredGeometry: loadGeometry(),
        currentGeometry: null,
        naturalBottomDocumentY: null,
        suppressUntilScrollY: null,
        interaction: false,
        interactionCleanup: null,
        scrollFrame: 0
    };

    // ==================== 持久化 ====================

    function storageGet(key, defaultValue) {
        if (typeof GM_getValue === 'function') {
            try {
                return GM_getValue(key, defaultValue);
            } catch (error) {
                logDebug('GM_getValue 读取失败，改用 localStorage', error);
            }
        }

        try {
            const raw = window.localStorage.getItem(`9527:${key}`);
            return raw === null ? defaultValue : JSON.parse(raw);
        } catch (error) {
            logDebug('localStorage 读取失败', error);
            return defaultValue;
        }
    }

    function storageSet(key, value) {
        if (typeof GM_setValue === 'function') {
            try {
                GM_setValue(key, value);
                return;
            } catch (error) {
                logDebug('GM_setValue 保存失败，改用 localStorage', error);
            }
        }

        try {
            window.localStorage.setItem(`9527:${key}`, JSON.stringify(value));
        } catch (error) {
            logDebug('localStorage 保存失败', error);
        }
    }

    function loadGeometry() {
        let value = storageGet(STORAGE_KEY, null);
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch (error) {
                return null;
            }
        }

        if (!value || typeof value !== 'object') {
            return null;
        }

        const geometry = {
            x: Number(value.x),
            y: Number(value.y),
            width: Number(value.width),
            height: Number(value.height)
        };

        if (!Object.values(geometry).every(Number.isFinite)) {
            return null;
        }

        if (geometry.width <= 0 || geometry.height <= 0) {
            return null;
        }

        return geometry;
    }

    function saveGeometry(geometry) {
        const saved = {
            x: Math.round(geometry.x),
            y: Math.round(geometry.y),
            width: Math.round(geometry.width),
            height: Math.round(geometry.height)
        };
        state.preferredGeometry = saved;
        storageSet(STORAGE_KEY, saved);
    }

    // ==================== 几何计算 ====================

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getViewportLimits() {
        const maxWidth = Math.max(160, Math.floor(window.innerWidth - 8));
        const maxHeight = Math.max(90, Math.floor(window.innerHeight - 8));
        return {
            minWidth: Math.min(CONFIG.minWidth, maxWidth),
            minHeight: Math.min(CONFIG.minHeight, maxHeight),
            maxWidth,
            maxHeight
        };
    }

    function clampGeometry(geometry) {
        const limits = getViewportLimits();
        const width = clamp(Math.round(geometry.width), limits.minWidth, limits.maxWidth);
        const height = clamp(Math.round(geometry.height), limits.minHeight, limits.maxHeight);
        return {
            x: clamp(Math.round(geometry.x), 0, Math.max(0, window.innerWidth - width)),
            y: clamp(Math.round(geometry.y), 0, Math.max(0, window.innerHeight - height)),
            width,
            height
        };
    }

    function getDefaultGeometry() {
        const limits = getViewportLimits();
        const width = Math.min(CONFIG.defaultWidth, limits.maxWidth);
        const height = clamp(Math.round(width * 9 / 16), limits.minHeight, limits.maxHeight);
        const margin = Math.max(0, Math.min(CONFIG.defaultMargin, window.innerWidth - width, window.innerHeight - height));

        return {
            x: Math.max(0, window.innerWidth - width - margin),
            y: Math.max(0, window.innerHeight - height - margin),
            width,
            height
        };
    }

    function getAppliedGeometry() {
        return clampGeometry(state.preferredGeometry || getDefaultGeometry());
    }

    function applyGeometry(geometry) {
        const next = clampGeometry(geometry);
        state.currentGeometry = next;

        if (!state.target) {
            return;
        }

        state.target.style.setProperty('--yt9527-mini-left', `${next.x}px`);
        state.target.style.setProperty('--yt9527-mini-top', `${next.y}px`);
        state.target.style.setProperty('--yt9527-mini-width', `${next.width}px`);
        state.target.style.setProperty('--yt9527-mini-height', `${next.height}px`);
    }

    function clearGeometryVariables(target) {
        if (!target) {
            return;
        }

        target.style.removeProperty('--yt9527-mini-left');
        target.style.removeProperty('--yt9527-mini-top');
        target.style.removeProperty('--yt9527-mini-width');
        target.style.removeProperty('--yt9527-mini-height');
    }

    // ==================== 样式与小窗 UI ====================

    function ensureStyle() {
        if (document.getElementById(STYLE_ID) || !document.documentElement) {
            return false;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #player-container.${ACTIVE_CLASS},
            #player-full-bleed-container.${ACTIVE_CLASS} {
                position: fixed !important;
                top: var(--yt9527-mini-top, 24px) !important;
                left: var(--yt9527-mini-left, 24px) !important;
                right: auto !important;
                bottom: auto !important;
                width: var(--yt9527-mini-width, 480px) !important;
                height: var(--yt9527-mini-height, 270px) !important;
                min-width: 0 !important;
                min-height: 0 !important;
                max-width: none !important;
                max-height: none !important;
                margin: 0 !important;
                padding: 0 !important;
                transform: none !important;
                aspect-ratio: auto !important;
                box-sizing: border-box !important;
                z-index: 2147483000 !important;
                visibility: visible !important;
                pointer-events: auto !important;
                overflow: hidden !important;
                border-radius: 8px !important;
                background: #000 !important;
                box-shadow: 0 10px 32px rgba(0, 0, 0, 0.38) !important;
            }

            .${CONTROLS_CLASS} {
                position: absolute !important;
                inset: 0 !important;
                z-index: 2147483647 !important;
                pointer-events: none !important;
                font-family: Arial, sans-serif !important;
            }

            .yt9527-miniplayer-drag-handle {
                position: absolute !important;
                top: 0 !important;
                left: 50% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 104px !important;
                height: 26px !important;
                transform: translateX(-50%) !important;
                border-radius: 0 0 8px 8px !important;
                background: rgba(18, 18, 18, 0.76) !important;
                opacity: 0.28 !important;
                cursor: grab !important;
                pointer-events: auto !important;
                touch-action: none !important;
                transition: opacity 140ms ease, background-color 140ms ease !important;
            }

            .${ACTIVE_CLASS}:hover .yt9527-miniplayer-drag-handle,
            .yt9527-miniplayer-drag-handle:focus-visible {
                opacity: 0.96 !important;
            }

            .yt9527-miniplayer-drag-handle::before {
                width: 32px !important;
                height: 4px !important;
                border-radius: 999px !important;
                background: rgba(255, 255, 255, 0.94) !important;
                box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22) !important;
                content: "" !important;
            }

            .${ACTIVE_CLASS}.${INTERACTING_CLASS} .yt9527-miniplayer-drag-handle {
                opacity: 1 !important;
                cursor: grabbing !important;
                background: rgba(20, 20, 20, 0.94) !important;
            }

            .yt9527-miniplayer-resize-handle {
                position: absolute !important;
                z-index: 2 !important;
                border: 0 !important;
                background: rgba(255, 255, 255, 0.72) !important;
                opacity: 0 !important;
                pointer-events: auto !important;
                touch-action: none !important;
                transition: opacity 120ms ease !important;
            }

            .${ACTIVE_CLASS}:hover .yt9527-miniplayer-resize-handle {
                opacity: 0.3 !important;
            }

            .yt9527-miniplayer-resize-handle:hover,
            .${ACTIVE_CLASS}.${INTERACTING_CLASS} .yt9527-miniplayer-resize-handle {
                opacity: 0.92 !important;
            }

            .yt9527-miniplayer-resize-n,
            .yt9527-miniplayer-resize-s {
                left: 14px !important;
                right: 14px !important;
                height: 5px !important;
                cursor: ns-resize !important;
            }

            .yt9527-miniplayer-resize-n {
                top: 0 !important;
            }

            .yt9527-miniplayer-resize-s {
                bottom: 0 !important;
            }

            .yt9527-miniplayer-resize-e,
            .yt9527-miniplayer-resize-w {
                top: 14px !important;
                bottom: 14px !important;
                width: 5px !important;
                cursor: ew-resize !important;
            }

            .yt9527-miniplayer-resize-e {
                right: 0 !important;
            }

            .yt9527-miniplayer-resize-w {
                left: 0 !important;
            }

            .yt9527-miniplayer-resize-ne,
            .yt9527-miniplayer-resize-nw,
            .yt9527-miniplayer-resize-se,
            .yt9527-miniplayer-resize-sw {
                width: 13px !important;
                height: 13px !important;
            }

            .yt9527-miniplayer-resize-ne {
                top: 0 !important;
                right: 0 !important;
                cursor: nesw-resize !important;
            }

            .yt9527-miniplayer-resize-nw {
                top: 0 !important;
                left: 0 !important;
                cursor: nwse-resize !important;
            }

            .yt9527-miniplayer-resize-se {
                right: 0 !important;
                bottom: 0 !important;
                cursor: nwse-resize !important;
            }

            .yt9527-miniplayer-resize-sw {
                bottom: 0 !important;
                left: 0 !important;
                cursor: nesw-resize !important;
            }

            html.${HTML_INTERACTING_CLASS},
            html.${HTML_INTERACTING_CLASS} * {
                user-select: none !important;
            }
        `;

        document.documentElement.appendChild(style);
        return true;
    }

    function createControls() {
        const controls = document.createElement('div');
        controls.className = CONTROLS_CLASS;

        const dragHandle = document.createElement('div');
        dragHandle.className = 'yt9527-miniplayer-drag-handle';
        dragHandle.tabIndex = 0;
        dragHandle.setAttribute('role', 'button');
        dragHandle.setAttribute('aria-label', '拖动小窗，双击恢复默认位置和大小');
        dragHandle.title = '拖动小窗；双击恢复默认位置和大小';
        dragHandle.addEventListener('pointerdown', (event) => beginPointerAction(event, 'move'));
        dragHandle.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetGeometry();
        });
        dragHandle.addEventListener('keydown', onDragHandleKeyDown);
        controls.appendChild(dragHandle);

        for (const direction of RESIZE_DIRECTIONS) {
            const handle = document.createElement('div');
            handle.className = `yt9527-miniplayer-resize-handle yt9527-miniplayer-resize-${direction}`;
            handle.dataset.resizeDirection = direction;
            handle.title = '拖动调整小窗大小';
            handle.addEventListener('pointerdown', (event) => beginPointerAction(event, 'resize', direction));
            controls.appendChild(handle);
        }

        return controls;
    }

    function onDragHandleKeyDown(event) {
        const steps = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1]
        };
        const direction = steps[event.key];

        if (!direction || !state.active || !state.currentGeometry) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const distance = event.shiftKey ? 20 : 5;
        applyGeometry({
            ...state.currentGeometry,
            x: state.currentGeometry.x + direction[0] * distance,
            y: state.currentGeometry.y + direction[1] * distance
        });
        saveGeometry(state.currentGeometry);
    }

    // ==================== 拖动与缩放 ====================

    function beginPointerAction(event, action, direction = '') {
        if (event.button !== 0 || !state.active || !state.currentGeometry) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (state.interaction) {
            finishInteraction(false);
        }

        const startGeometry = { ...state.currentGeometry };
        const startX = event.clientX;
        const startY = event.clientY;
        state.interaction = true;
        state.target?.classList.add(INTERACTING_CLASS);
        document.documentElement.classList.add(HTML_INTERACTING_CLASS);

        const onPointerMove = (moveEvent) => {
            if (!state.active || !state.currentGeometry) {
                finishInteraction(false);
                return;
            }

            moveEvent.preventDefault();
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            const next = action === 'move'
                ? getMovedGeometry(startGeometry, dx, dy)
                : getResizedGeometry(startGeometry, direction, dx, dy);
            applyGeometry(next);
        };

        const onPointerEnd = () => finishInteraction(true);
        const onPointerCancel = () => finishInteraction(true);

        state.interactionCleanup = () => {
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', onPointerEnd, true);
            window.removeEventListener('pointercancel', onPointerCancel, true);
        };

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerEnd, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
    }

    function getMovedGeometry(start, dx, dy) {
        return {
            ...start,
            x: clamp(start.x + dx, 0, Math.max(0, window.innerWidth - start.width)),
            y: clamp(start.y + dy, 0, Math.max(0, window.innerHeight - start.height))
        };
    }

    function getResizedGeometry(start, direction, dx, dy) {
        const limits = getViewportLimits();
        const next = { ...start };
        const right = start.x + start.width;
        const bottom = start.y + start.height;

        if (direction.includes('e')) {
            const maxWidth = Math.max(limits.minWidth, window.innerWidth - start.x);
            next.width = clamp(start.width + dx, limits.minWidth, maxWidth);
        }

        if (direction.includes('w')) {
            const maxWidth = Math.max(limits.minWidth, right);
            next.width = clamp(start.width - dx, limits.minWidth, maxWidth);
            next.x = right - next.width;
        }

        if (direction.includes('s')) {
            const maxHeight = Math.max(limits.minHeight, window.innerHeight - start.y);
            next.height = clamp(start.height + dy, limits.minHeight, maxHeight);
        }

        if (direction.includes('n')) {
            const maxHeight = Math.max(limits.minHeight, bottom);
            next.height = clamp(start.height - dy, limits.minHeight, maxHeight);
            next.y = bottom - next.height;
        }

        return next;
    }

    function finishInteraction(save) {
        if (!state.interaction && !state.interactionCleanup) {
            return;
        }

        state.interaction = false;
        state.interactionCleanup?.();
        state.interactionCleanup = null;
        state.target?.classList.remove(INTERACTING_CLASS);
        document.documentElement.classList.remove(HTML_INTERACTING_CLASS);

        if (save && state.currentGeometry) {
            saveGeometry(state.currentGeometry);
        }
    }

    function resetGeometry() {
        state.preferredGeometry = null;
        storageSet(STORAGE_KEY, null);

        if (state.active) {
            applyGeometry(getDefaultGeometry());
        }
    }

    // ==================== 播放器定位与小窗状态 ====================

    function isWatchPage() {
        return location.pathname === '/watch' || location.pathname.endsWith('/watch');
    }

    function isFullscreen() {
        return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function isTheaterMode() {
        if (!CONFIG.enableTheaterMode) {
            return false;
        }

        const watchFlexy = document.querySelector('ytd-watch-flexy');
        return Boolean(watchFlexy?.hasAttribute('theater'));
    }

    function getPlayerTarget() {
        if (isTheaterMode()) {
            const fullBleed = document.querySelector('#player-full-bleed-container');
            if (fullBleed?.querySelector('#player-container')) {
                return fullBleed;
            }
        }

        const playerContainer = document.querySelector('#player-container');
        return playerContainer || null;
    }

    function activateMiniplayer(target) {
        state.active = true;
        state.target = target;
        applyGeometry(getAppliedGeometry());
        target.classList.add(ACTIVE_CLASS);
        state.controls = createControls();
        target.appendChild(state.controls);
    }

    function deactivateMiniplayer() {
        finishInteraction(false);

        if (state.controls) {
            state.controls.remove();
            state.controls = null;
        }

        if (state.target) {
            state.target.classList.remove(ACTIVE_CLASS, INTERACTING_CLASS);
            clearGeometryVariables(state.target);
        }

        state.active = false;
        state.target = null;
        state.currentGeometry = null;
        state.naturalBottomDocumentY = null;
    }

    function updateMiniplayer() {
        if (!isWatchPage()) {
            deactivateMiniplayer();
            return;
        }

        if (isFullscreen()) {
            deactivateMiniplayer();
            return;
        }

        if (state.interaction) {
            return;
        }

        if (state.suppressUntilScrollY !== null) {
            if (Math.abs(window.scrollY - state.suppressUntilScrollY) <= 64) {
                return;
            }
            state.suppressUntilScrollY = null;
        }

        if (state.active) {
            if (!state.target?.isConnected) {
                deactivateMiniplayer();
                return;
            }

            if (!state.controls?.isConnected) {
                state.controls = createControls();
                state.target.appendChild(state.controls);
            }

            if (
                state.naturalBottomDocumentY !== null
                && window.scrollY <= state.naturalBottomDocumentY - CONFIG.deactivateWhenPlayerBottom
            ) {
                deactivateMiniplayer();
            }
            return;
        }

        const target = getPlayerTarget();
        if (!target) {
            return;
        }

        const rect = target.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 68) {
            return;
        }

        if (rect.bottom <= CONFIG.activateWhenPlayerBottom) {
            state.naturalBottomDocumentY = rect.bottom + window.scrollY;
            activateMiniplayer(target);
            logDebug('进入小窗模式', state.currentGeometry);
        }
    }

    function scheduleUpdate() {
        if (state.scrollFrame) {
            return;
        }

        state.scrollFrame = window.requestAnimationFrame(() => {
            state.scrollFrame = 0;
            ensureStyle();
            updateMiniplayer();
        });
    }

    // ==================== 事件与启动 ====================

    function onNavigationStart() {
        deactivateMiniplayer();
        state.suppressUntilScrollY = null;
    }

    function onNavigationFinish() {
        deactivateMiniplayer();
        state.suppressUntilScrollY = null;
        window.setTimeout(scheduleUpdate, 0);
    }

    function onFullscreenChange() {
        if (isFullscreen()) {
            state.suppressUntilScrollY = null;
            deactivateMiniplayer();
            return;
        }

        state.suppressUntilScrollY = window.scrollY;
        window.setTimeout(scheduleUpdate, 0);
    }

    function onWindowResize() {
        if (state.active && !state.interaction) {
            applyGeometry(getAppliedGeometry());
        }
        scheduleUpdate();
    }

    function logDebug(...args) {
        if (CONFIG.debug) {
            console.debug('[9527YouTube滚动小窗]', ...args);
        }
    }

    function start() {
        ensureStyle();

        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', onWindowResize, { passive: true });
        window.addEventListener('popstate', onNavigationFinish);
        window.addEventListener('yt-navigate-start', onNavigationStart);
        window.addEventListener('yt-navigate-finish', onNavigationFinish);
        document.addEventListener('yt-navigate-start', onNavigationStart);
        document.addEventListener('yt-navigate-finish', onNavigationFinish);
        window.addEventListener('blur', () => finishInteraction(true));
        document.addEventListener('fullscreenchange', onFullscreenChange, true);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange, true);
        document.addEventListener('click', (event) => {
            if (event.target instanceof Element && event.target.closest('.ytp-size-button')) {
                window.setTimeout(scheduleUpdate, 0);
            }
        }, true);

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('恢复小窗默认位置和大小', resetGeometry);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scheduleUpdate, { once: true });
        }

        window.setTimeout(scheduleUpdate, 0);
        window.setTimeout(scheduleUpdate, 600);
        window.setTimeout(scheduleUpdate, 1600);
    }

    start();
})();
