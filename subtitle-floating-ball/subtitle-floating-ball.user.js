// ==UserScript==
// @name         9527字幕悬浮球助手
// @name:zh-CN   9527字幕悬浮球助手
// @namespace    https://github.com/Godwin9527
// @version      1.6.0
// @description  Subtitle loader for MissAV and Jable: auto search & load, page-level subtitle overlay, style tweaks, draggable floating ball.
// @description:zh-CN 为 MissAV 与 Jable 提供本地字幕加载、在线字幕自动搜索与加载、页面级字幕浮层（不挂在播放器容器内）、字幕样式调节与可拖拽悬浮球面板。
// @author       9527
// @match        *://missav123.com/*
// @match        *://missav.ws/*
// @match        *://missav.ai/*
// @match        *://missav.com/*
// @match        *://missav.live/*
// @match        *://jable.tv/*
// @match        *://www.jable.tv/*
// @noframes
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @inject-into  content
// @connect      api-shoulei-ssl.xunlei.com
// @connect      xunlei.com
// @connect      geilijiasu.com
// @connect      v.geilijiasu.com
// @license      MIT
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/subtitle-floating-ball/subtitle-floating-ball.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/subtitle-floating-ball/subtitle-floating-ball.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const PLAYER_STATE_EVENT = 'missav-player-state';
    const PLAYER_STATE_ATTR = 'data-missav-player-state';
    const PLAYER_BRIDGE_ID = 'missav-player-bridge';
    const FLOATING_BUTTON_POSITION_KEY = 'missavFloatingButtonPosition';
    const FLOATING_UI_GAP = 8;
    const VIDEO_QUERY_SELECTORS = [
        'video#player',
        '.plyr video',
        '.video-js video',
        '.jwplayer video',
        'video'
    ];

    // --- Styles ---
    addStyle(`
        .custom-control-panel {
            position: fixed;
            left: 12px;
            bottom: 78px;
            background: linear-gradient(135deg, rgba(30, 30, 40, 0.95), rgba(40, 40, 55, 0.95));
            color: white;
            padding: 10px 12px;
            z-index: 9999;
            border-radius: 10px;
            width: min(292px, calc(100vw - 24px));
            max-height: min(420px, calc(100vh - 120px));
            overflow-y: auto;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            display: none;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 10px;
            align-items: end;
        }
        .custom-control-panel label {
            margin-right: 0;
            display: block;
            min-width: 0;
            text-align: left;
            color: rgba(255, 255, 255, 0.9);
            font-weight: 500;
            font-size: 11px;
            line-height: 1.2;
        }
        .custom-control-panel input[type="number"],
        .custom-control-panel input[type="text"],
        .custom-control-panel input[type="color"] {
            width: 100%;
            margin-right: 0;
            color: white;
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(100, 150, 255, 0.3);
            border-radius: 6px;
            padding: 4px 6px;
            box-sizing: border-box;
            transition: all 0.2s ease;
            font-size: 12px;
            height: 30px;
        }
        .custom-control-panel input[type="number"]:focus,
        .custom-control-panel input[type="text"]:focus,
        .custom-control-panel input[type="color"]:focus {
            outline: none;
            border-color: rgba(100, 150, 255, 0.6);
            background: rgba(255, 255, 255, 0.18);
            box-shadow: 0 0 8px rgba(100, 150, 255, 0.3);
        }
        .custom-control-panel input[type="color"] {
            padding: 2px;
            min-width: 56px;
            cursor: pointer;
        }
         /* Specific width for offset/position inputs */
        .custom-control-panel input[data-key-name="subtitleOffset"],
        .custom-control-panel input[data-key-name="subtitlePosition"] {
             width: 100%;
        }
        .custom-control-panel button {
            background: linear-gradient(135deg, #4a90e2, #357abd);
            border: none;
            color: white;
            padding: 7px 8px;
            border-radius: 6px;
            cursor: pointer;
            margin: 0;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(58, 123, 200, 0.3);
            white-space: nowrap;
            min-height: 30px;
        }
        .custom-control-panel button:hover {
            background: linear-gradient(135deg, #5aa0f2, #4589cd);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(58, 123, 200, 0.4);
        }
        .custom-control-panel button:active {
            transform: translateY(0);
            box-shadow: 0 1px 4px rgba(58, 123, 200, 0.3);
        }
        .custom-control-panel .input-group {
            margin-bottom: 0;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 56px;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }
        .custom-control-panel .button-group {
            grid-column: 1 / -1;
            margin-top: 2px;
            border-top: 1px solid rgba(255, 255, 255, 0.15);
            padding-top: 8px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
        }
        /* 页面级浮层：不依赖播放器容器，坐标由 JS 按 video 的实际位置计算。
           这样不会被播放器的 overflow / transform / 层级裁掉或盖住。 */
        .custom-subtitle {
            position: fixed;
            left: 0;
            top: 0;
            right: auto;
            bottom: auto;
            transform: translateX(-50%);
            color: #ffffff;
            font-size: 26px;
            font-weight: bold;
            line-height: 1.3;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.9);
            background: transparent;
            padding: 4px 10px;
            border-radius: 6px;
            max-width: 96vw;
            text-align: center;
            white-space: pre-line;
            box-sizing: border-box;
            z-index: 2147483000;
            pointer-events: none;
            will-change: left, top;
        }
        .subtitle-list {
            position: fixed;
            left: 12px;
            bottom: 140px;
            background: linear-gradient(135deg, rgba(30, 30, 40, 0.95), rgba(40, 40, 55, 0.95));
            color: white;
            max-height: min(320px, calc(100vh - 180px));
            width: min(280px, calc(100vw - 24px));
            overflow-y: auto;
            padding: 10px;
            border-radius: 10px;
            z-index: 10001;
            border: 1px solid rgba(100, 150, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(10px);
        }
        .subtitle-item {
            padding: 7px 8px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 11px;
            border-radius: 6px;
            margin-bottom: 4px;
            transition: all 0.2s ease;
        }
        .subtitle-item:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }
        .subtitle-item:hover {
            background: rgba(100, 150, 255, 0.25);
            transform: translateX(4px);
            border-color: rgba(100, 150, 255, 0.3);
        }
        .show-controls-button {
            position: fixed;
            left: 14px;
            bottom: 16px;
            background: linear-gradient(135deg, #4a90e2, #357abd);
            color: white;
            width: 52px;
            height: 52px;
            padding: 0;
            border: none;
            border-radius: 999px;
            cursor: pointer;
            z-index: 9998;
            font-size: 11px;
            font-weight: 500;
            box-shadow: 0 4px 16px rgba(58, 123, 200, 0.4);
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            cursor: grab;
        }
        .show-controls-button:hover {
            background: linear-gradient(135deg, #5aa0f2, #4589cd);
            transform: translateY(-2px) scale(1.02);
            box-shadow: 0 6px 20px rgba(58, 123, 200, 0.5);
        }
        .show-controls-button.dragging {
            transition: none;
            transform: none;
            cursor: grabbing;
        }
        .custom-control-panel .auto-load-row {
            grid-column: 1 / -1;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 2px 0 0;
            color: rgba(255, 255, 255, 0.9);
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
        }
        .custom-control-panel .auto-load-row input[type="checkbox"] {
            width: 14px;
            height: 14px;
            margin: 0;
            padding: 0;
            flex: 0 0 auto;
            accent-color: #4a90e2;
            cursor: pointer;
        }
        .custom-control-panel button.full-width {
            grid-column: 1 / -1;
        }
        @media (max-width: 640px) {
            .custom-control-panel {
                left: 10px;
                width: auto;
                max-height: calc(100vh - 108px);
                bottom: 74px;
            }
            .subtitle-list {
                left: 10px;
                width: auto;
            }
            .show-controls-button {
                left: 12px;
                bottom: 14px;
            }
        }
    `);

    // --- Global Variables ---
    let subtitleOffset = parseFloat(localStorage.getItem('missavSubtitleOffset')) || 0;
    let subtitleVerticalPositionPercent = parseFloat(localStorage.getItem('missavSubtitlePosition')) || 15; // Default 15% from bottom
    let subtitleFontSize = parseFloat(localStorage.getItem('missavSubtitleSize')) || 26;
    let subtitleColor = normalizeHexColor(localStorage.getItem('missavSubtitleColor')) || '#ffffff';
    let autoLoadEnabled = localStorage.getItem('missavAutoLoadSubtitle') !== '0'; // 默认开启
    let floatingButtonPosition = null;
    let floatingButtonDragState = null;
    let suppressFloatingButtonClick = false;
    let videoElement = null;
    let playerMonitorInterval = null;
    let hasShownPlayerReadyToast = false;
    let playerBridgeState = {
        currentTime: 0,
        paused: true,
        ended: false,
        seeking: false,
        reason: ''
    };
    let playerBridgeUpdatedAt = 0;
    let isBridgeActive = false;
    let subtitles = [];
    let originalSubtitleText = '';

    // --- Subtitle source / auto-load state ---
    let lastSearchResults = [];       // 当前番号可用的 SRT 候选列表
    let lastSearchVideoId = '';       // lastSearchResults 对应的番号
    let currentSubtitleUrl = '';      // 正在使用的字幕地址
    let currentSubtitleName = '';     // 正在使用的字幕名称
    let loadSeq = 0;                  // 加载请求序号，用于丢弃过期响应
    let subtitleRenderTimer = null;   // 字幕渲染循环
    let autoLoadAttemptedFor = '';    // 已自动加载过的番号
    let autoLoadSuppressed = false;   // 用户手动清空后，本页不再自动加载

    // --- 字幕浮层状态 ---
    let subtitleText = '';            // 当前应显示的文本
    let subtitleNoticeText = '';      // 加载后的短暂提示（用于确认浮层真的在工作）
    let subtitleNoticeUntil = 0;
    let lastActiveVideoBindAt = 0;
    let subtitleLoadedAt = 0;         // 本次字幕加载时间，用于时间轴不匹配提醒
    let cueEverMatched = false;       // 是否命中过至少一条字幕
    let timelineWarned = false;

    // --- UI Elements ---
    let controlPanel;
    let subtitleElement;
    let subtitleList = null;
    let showControlsButton = null;

    // --- Functions ---

    function addStyle(css) {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function normalizeHexColor(value) {
        if (typeof value !== 'string') return null;

        const normalized = value.trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/i.test(normalized)) {
            return normalized;
        }

        if (/^#[0-9a-f]{3}$/i.test(normalized)) {
            return `#${normalized.slice(1).split('').map((char) => char + char).join('')}`;
        }

        return null;
    }

    function getViewportMargin() {
        return window.innerWidth <= 640 ? 10 : 12;
    }

    function loadFloatingButtonPosition() {
        try {
            const raw = localStorage.getItem(FLOATING_BUTTON_POSITION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
                return null;
            }
            return { left: parsed.left, top: parsed.top };
        } catch (error) {
            console.warn('9527字幕悬浮球: Failed to load floating button position.', error);
            return null;
        }
    }

    function saveFloatingButtonPosition() {
        if (!floatingButtonPosition) return;

        try {
            localStorage.setItem(FLOATING_BUTTON_POSITION_KEY, JSON.stringify(floatingButtonPosition));
        } catch (error) {
            console.warn('9527字幕悬浮球: Failed to save floating button position.', error);
        }
    }

    function clampFloatingButtonPosition(position) {
        const margin = getViewportMargin();
        const buttonWidth = showControlsButton?.offsetWidth || 52;
        const buttonHeight = showControlsButton?.offsetHeight || 52;

        return {
            left: clamp(position.left, margin, Math.max(margin, window.innerWidth - buttonWidth - margin)),
            top: clamp(position.top, margin, Math.max(margin, window.innerHeight - buttonHeight - margin))
        };
    }

    function getDefaultFloatingButtonPosition() {
        const margin = getViewportMargin();
        const buttonHeight = showControlsButton?.offsetHeight || 52;
        return clampFloatingButtonPosition({
            left: margin + 2,
            top: window.innerHeight - buttonHeight - 16
        });
    }

    function applyFloatingButtonPosition() {
        if (!showControlsButton) return;

        if (!floatingButtonPosition) {
            floatingButtonPosition = loadFloatingButtonPosition() || getDefaultFloatingButtonPosition();
        }

        floatingButtonPosition = clampFloatingButtonPosition(floatingButtonPosition);
        showControlsButton.style.left = `${floatingButtonPosition.left}px`;
        showControlsButton.style.top = `${floatingButtonPosition.top}px`;
        showControlsButton.style.right = 'auto';
        showControlsButton.style.bottom = 'auto';
    }

    function getBallAnchorRect() {
        if (!showControlsButton) return null;
        applyFloatingButtonPosition();

        if (showControlsButton.style.display !== 'none') {
            const rect = showControlsButton.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return rect;
            }
        }

        const buttonWidth = showControlsButton.offsetWidth || 52;
        const buttonHeight = showControlsButton.offsetHeight || 52;
        const position = floatingButtonPosition || getDefaultFloatingButtonPosition();

        return {
            left: position.left,
            top: position.top,
            right: position.left + buttonWidth,
            bottom: position.top + buttonHeight,
            width: buttonWidth,
            height: buttonHeight
        };
    }

    function positionControlPanel() {
        if (!controlPanel || controlPanel.style.display === 'none') return;

        const anchorRect = getBallAnchorRect();
        if (!anchorRect) return;

        const margin = getViewportMargin();
        const gap = FLOATING_UI_GAP;
        const panelWidth = Math.min(controlPanel.offsetWidth || 292, Math.max(220, window.innerWidth - margin * 2));
        controlPanel.style.width = `${panelWidth}px`;
        controlPanel.style.maxHeight = `${Math.max(200, window.innerHeight - margin * 2)}px`;

        const panelHeight = Math.min(controlPanel.scrollHeight, window.innerHeight - margin * 2);
        const alignRight = anchorRect.left > window.innerWidth / 2;
        const preferredLeft = alignRight ? anchorRect.right - panelWidth : anchorRect.left;
        const left = clamp(preferredLeft, margin, Math.max(margin, window.innerWidth - panelWidth - margin));

        const spaceAbove = anchorRect.top - margin - gap;
        const spaceBelow = window.innerHeight - anchorRect.bottom - margin - gap;
        const shouldOpenAbove = spaceAbove >= panelHeight || spaceAbove >= spaceBelow;
        const preferredTop = shouldOpenAbove
            ? anchorRect.top - panelHeight - gap
            : anchorRect.bottom + gap;
        const top = clamp(preferredTop, margin, Math.max(margin, window.innerHeight - panelHeight - margin));

        controlPanel.style.left = `${left}px`;
        controlPanel.style.top = `${top}px`;
        controlPanel.style.right = 'auto';
        controlPanel.style.bottom = 'auto';
    }

    function cleanupFloatingButtonDrag() {
        document.removeEventListener('pointermove', handleFloatingButtonPointerMove);
        document.removeEventListener('pointerup', handleFloatingButtonPointerUp);
        document.removeEventListener('pointercancel', handleFloatingButtonPointerUp);
    }

    function handleFloatingButtonPointerMove(event) {
        if (!floatingButtonDragState) return;

        const deltaX = event.clientX - floatingButtonDragState.startX;
        const deltaY = event.clientY - floatingButtonDragState.startY;
        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
            suppressFloatingButtonClick = true;
        }

        floatingButtonPosition = clampFloatingButtonPosition({
            left: floatingButtonDragState.originLeft + deltaX,
            top: floatingButtonDragState.originTop + deltaY
        });

        applyFloatingButtonPosition();
        positionControlPanel();
        positionSubtitleList();
    }

    function handleFloatingButtonPointerUp(event) {
        if (showControlsButton?.classList.contains('dragging')) {
            showControlsButton.classList.remove('dragging');
        }

        if (showControlsButton && floatingButtonDragState && event.pointerId !== undefined && showControlsButton.hasPointerCapture?.(event.pointerId)) {
            showControlsButton.releasePointerCapture(event.pointerId);
        }

        cleanupFloatingButtonDrag();

        if (floatingButtonDragState && suppressFloatingButtonClick) {
            saveFloatingButtonPosition();
        }

        floatingButtonDragState = null;
    }

    function handleFloatingButtonPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        if (!showControlsButton) return;

        applyFloatingButtonPosition();
        const rect = showControlsButton.getBoundingClientRect();
        floatingButtonDragState = {
            startX: event.clientX,
            startY: event.clientY,
            originLeft: rect.left,
            originTop: rect.top
        };
        suppressFloatingButtonClick = false;
        showControlsButton.classList.add('dragging');

        if (event.pointerId !== undefined) {
            showControlsButton.setPointerCapture?.(event.pointerId);
        }

        document.addEventListener('pointermove', handleFloatingButtonPointerMove);
        document.addEventListener('pointerup', handleFloatingButtonPointerUp);
        document.addEventListener('pointercancel', handleFloatingButtonPointerUp);
    }

    function handleFloatingButtonClick(event) {
        if (suppressFloatingButtonClick) {
            suppressFloatingButtonClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        showControlPanel();
    }

    function handleViewportChange() {
        applyFloatingButtonPosition();
        positionControlPanel();
        positionSubtitleList();
        applySubtitlePresentation();
    }

    /** 进出全屏时浮层的宿主会变，需要重新挂载并按新坐标系定位。 */
    function handleFullscreenChange() {
        ensureSubtitleMounted();
        applySubtitlePresentation();
    }

    function openInNewTab(url) {
        try {
            if (typeof GM !== 'undefined' && typeof GM.openInTab === 'function') {
                return GM.openInTab(url, false);
            }
            if (typeof GM_openInTab === 'function') {
                return GM_openInTab(url, { active: true, insert: true });
            }
        } catch (error) {
            console.warn('9527字幕悬浮球: GM.openInTab failed, falling back to window.open.', error);
        }

        return window.open(url, '_blank', 'noopener');
    }

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            const timeoutSeconds = details.timeout ? Math.ceil(details.timeout / 1000) : 0;
            const request = {
                ...details,
                onload: (response) => resolve(response),
                onerror: (error) => reject(error instanceof Error ? error : new Error('网络错误或请求被阻止')),
                ontimeout: () => reject(new Error(`请求超时${timeoutSeconds ? ` (${timeoutSeconds}秒)` : ''}`))
            };

            try {
                if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
                    GM.xmlHttpRequest(request);
                    return;
                }

                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest(request);
                    return;
                }
            } catch (error) {
                reject(error);
                return;
            }

            reject(new Error('当前脚本管理器不支持 GM.xmlHttpRequest'));
        });
    }

    function parseJsonResponse(response) {
        if (response?.response && typeof response.response === 'object') {
            return response.response;
        }

        if (typeof response?.responseText === 'string' && response.responseText.trim()) {
            return JSON.parse(response.responseText);
        }

        throw new Error('无法解析服务器响应 (JSON)');
    }

    function getResponseText(response) {
        if (typeof response?.responseText === 'string') {
            return response.responseText;
        }

        if (typeof response?.response === 'string') {
            return response.response;
        }

        return '';
    }

    function scoreVideoElement(video) {
        if (!video) return -Infinity;

        const rect = video.getBoundingClientRect();
        const style = getComputedStyle(video);
        const isVisible = style.display !== 'none'
            && style.visibility !== 'hidden'
            && parseFloat(style.opacity || '1') !== 0
            && rect.width >= 160
            && rect.height >= 90;
        const hasSource = Boolean(video.currentSrc || video.src);
        const isLikelyPlayer = video.id === 'player'
            || video.closest('.plyr')
            || video.closest('.player')
            || video.closest('.video-js')
            || video.closest('.jwplayer')
            || video.closest('[class*="video-player"]');
        const isPlaying = !video.paused && !video.ended;

        return (isLikelyPlayer ? 1_000_000 : 0)
            + (isVisible ? 100_000 : 0)
            + (isPlaying ? 10_000 : 0)
            + (video.currentTime > 0 ? 5_000 : 0)
            + (hasSource ? 1_000 : 0)
            + Math.round(rect.width * rect.height);
    }

    function injectPlayerBridge() {
        if (document.getElementById(PLAYER_BRIDGE_ID)) return;

        const bridgeScript = document.createElement('script');
        bridgeScript.id = PLAYER_BRIDGE_ID;
        bridgeScript.textContent = `
            (() => {
                const EVENT_NAME = ${JSON.stringify(PLAYER_STATE_EVENT)};
                const STATE_ATTR = ${JSON.stringify(PLAYER_STATE_ATTR)};
                const VIDEO_SELECTORS = ${JSON.stringify(VIDEO_QUERY_SELECTORS)};
                if (window.__MISSAV_PLAYER_BRIDGE__) return;
                window.__MISSAV_PLAYER_BRIDGE__ = true;

                let boundPlayer = null;
                let media = null;
                let rafId = null;
                let rvfcId = null;

                const mediaEvents = ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'ended', 'loadedmetadata', 'ratechange'];
                const findMediaElement = () => {
                    for (const selector of VIDEO_SELECTORS) {
                        const candidate = document.querySelector(selector);
                        if (candidate instanceof HTMLVideoElement) {
                            return candidate;
                        }
                    }
                    return document.querySelector('video');
                };

                const emit = (reason) => {
                    const currentTime = media && typeof media.currentTime === 'number'
                        ? media.currentTime
                        : boundPlayer && typeof boundPlayer.currentTime === 'number'
                            ? boundPlayer.currentTime
                            : 0;

                    const root = document.documentElement;
                    if (root) {
                        root.setAttribute(STATE_ATTR, JSON.stringify({
                            currentTime,
                            paused: media ? !!media.paused : !(boundPlayer && !boundPlayer.paused),
                            ended: media ? !!media.ended : false,
                            seeking: media ? !!media.seeking : false,
                            reason
                        }));
                    }

                    document.dispatchEvent(new CustomEvent(EVENT_NAME));
                };

                const stopLoop = () => {
                    if (media && typeof media.cancelVideoFrameCallback === 'function' && rvfcId !== null) {
                        try { media.cancelVideoFrameCallback(rvfcId); } catch (error) {}
                    }
                    if (rafId !== null) {
                        cancelAnimationFrame(rafId);
                    }
                    rafId = null;
                    rvfcId = null;
                };

                const frameStep = () => {
                    emit('frame');
                    startLoop();
                };

                const startLoop = () => {
                    stopLoop();
                    if (!media || media.paused || media.ended || document.visibilityState === 'hidden') {
                        return;
                    }

                    if (typeof media.requestVideoFrameCallback === 'function') {
                        rvfcId = media.requestVideoFrameCallback(() => frameStep());
                    } else {
                        rafId = requestAnimationFrame(frameStep);
                    }
                };

                const onMediaEvent = (event) => {
                    emit(event.type);
                    if (event.type === 'pause' || event.type === 'waiting' || event.type === 'ended') {
                        stopLoop();
                        return;
                    }
                    startLoop();
                };

                const cleanupMedia = () => {
                    stopLoop();
                    if (media) {
                        mediaEvents.forEach((eventName) => media.removeEventListener(eventName, onMediaEvent));
                    }
                };

                const bindMedia = (nextMedia, player = null) => {
                    if (!nextMedia) return false;

                    if (boundPlayer === player && media === nextMedia && nextMedia.isConnected) {
                        return true;
                    }

                    cleanupMedia();
                    boundPlayer = player;
                    media = nextMedia;
                    mediaEvents.forEach((eventName) => media.addEventListener(eventName, onMediaEvent, { passive: true }));
                    emit('bind');
                    startLoop();
                    return true;
                };

                const bindPlayer = (player) => {
                    if (!player) return false;
                    const nextMedia = player.media || findMediaElement();
                    return bindMedia(nextMedia, player);
                };

                const getPlayerCandidates = () => {
                    const candidates = [];
                    if (window.player) candidates.push(window.player);
                    if (window.plyr) candidates.push(window.plyr);
                    if (typeof window.videojs === 'function' && typeof window.videojs.getPlayers === 'function') {
                        candidates.push(...Object.values(window.videojs.getPlayers()));
                    }
                    return candidates.filter(Boolean);
                };

                document.addEventListener('visibilitychange', () => {
                    emit('visibilitychange');
                    if (document.visibilityState === 'hidden') {
                        stopLoop();
                    } else {
                        startLoop();
                    }
                });

                setInterval(() => {
                    for (const candidate of getPlayerCandidates()) {
                        if (bindPlayer(candidate)) {
                            return;
                        }
                    }

                    if (bindMedia(findMediaElement())) {
                        return;
                    }

                    if (media && media.isConnected) {
                        emit('poll');
                    }
                }, 1000);
            })();
        `;

        (document.documentElement || document.head || document.body).appendChild(bridgeScript);
        bridgeScript.remove();
    }

    function handlePlayerStateEvent() {
        const detailText = document.documentElement?.getAttribute(PLAYER_STATE_ATTR);
        if (!detailText) return;

        let detail;
        try {
            detail = JSON.parse(detailText);
        } catch (error) {
            console.warn('9527字幕悬浮球: Failed to parse bridged player state.', error);
            return;
        }

        playerBridgeState = {
            currentTime: Number.isFinite(detail.currentTime) ? detail.currentTime : 0,
            paused: Boolean(detail.paused),
            ended: Boolean(detail.ended),
            seeking: Boolean(detail.seeking),
            reason: typeof detail.reason === 'string' ? detail.reason : ''
        };
        isBridgeActive = true;
        playerBridgeUpdatedAt = Date.now();

        const currentVideo = findVideoElement();
        if (currentVideo) {
            bindVideoElement(currentVideo);
        }

        updateSubtitle();
    }

    function setupPlayerBridge() {
        document.removeEventListener(PLAYER_STATE_EVENT, handlePlayerStateEvent);
        document.addEventListener(PLAYER_STATE_EVENT, handlePlayerStateEvent);
        injectPlayerBridge();
    }

    /** 全屏元素（进入全屏后只有它的子树会被渲染）。 */
    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    /** 字幕浮层的宿主：平时挂在 body，全屏时挂进全屏元素，否则全屏下看不到。 */
    function getSubtitleHost() {
        return getFullscreenElement() || document.body || document.documentElement || null;
    }

    /** 取当前真正在用的 video：播放中的优先，其次按可见面积打分。 */
    function getActiveVideo() {
        const videos = Array.from(document.querySelectorAll('video')).filter((v) => v.isConnected);
        if (!videos.length) {
            return videoElement && videoElement.isConnected ? videoElement : null;
        }

        const playing = videos.filter((v) => !v.paused && !v.ended && v.readyState > 0);
        const pool = playing.length ? playing : videos;

        let best = pool[0];
        let bestScore = -Infinity;
        for (const video of pool) {
            const score = scoreVideoElement(video) + (video === videoElement ? 5000 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = video;
            }
        }
        return best;
    }

    function formatClock(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const total = Math.floor(seconds);
        const mm = String(Math.floor(total / 60)).padStart(2, '0');
        const ss = String(total % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    }

    /**
     * 按 video 的实际屏幕位置算出浮层坐标。
     * 视频不在视野内、尺寸过小时返回 null（此时不显示字幕）。
     */
    function computeSubtitleGeometry() {
        const video = getActiveVideo();
        if (!video) return null;

        const rect = video.getBoundingClientRect();
        if (!(rect.width >= 120 && rect.height >= 80)) return null;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        if (visibleWidth < 120 || visibleHeight < 60) return null;

        const host = getSubtitleHost();
        const inFullscreen = Boolean(getFullscreenElement());
        const hostRect = (inFullscreen && host && host.getBoundingClientRect)
            ? host.getBoundingClientRect()
            : { left: 0, top: 0 };

        const percent = clamp(
            Number.isFinite(subtitleVerticalPositionPercent) ? subtitleVerticalPositionPercent : 15,
            0,
            90
        );

        // 字幕中心点：视频水平居中，垂直按「距底部百分比」换算
        const centerX = rect.left + rect.width / 2 - hostRect.left;
        const centerY = rect.bottom - rect.height * (percent / 100) - hostRect.top;

        const width = Math.max(160, Math.min(rect.width * 0.94, viewportWidth - 24));

        return {
            position: inFullscreen ? 'absolute' : 'fixed',
            left: centerX,
            top: clamp(centerY, Math.max(0, rect.top - hostRect.top) + 12,
                Math.max(12, rect.bottom - hostRect.top - 12)),
            width
        };
    }

    /** 把文本、位置、样式一次性刷到浮层上。 */
    function applySubtitlePresentation() {
        if (!subtitleElement) return;

        const text = subtitleText || '';
        if (!text) {
            subtitleElement.style.display = 'none';
            return;
        }

        const geometry = computeSubtitleGeometry();
        if (!geometry) {
            subtitleElement.style.display = 'none';
            return;
        }

        if (subtitleElement.style.display !== 'block') {
            subtitleElement.style.display = 'block';
        }
        subtitleElement.style.position = geometry.position;
        subtitleElement.style.left = `${Math.round(geometry.left)}px`;
        subtitleElement.style.top = `${Math.round(geometry.top)}px`;
        subtitleElement.style.width = `${Math.round(geometry.width)}px`;
    }

    function setSubtitleText(text) {
        if (!subtitleElement) return;

        const normalizedText = typeof text === 'string' ? text : '';
        if (normalizedText !== subtitleText) {
            subtitleText = normalizedText;
            subtitleElement.textContent = normalizedText;
        }
        applySubtitlePresentation();
    }

    /** 加载完成后短暂显示一条状态，用来确认浮层本身是否渲染成功。 */
    function setSubtitleNotice(text, duration = 2600) {
        subtitleNoticeText = text || '';
        subtitleNoticeUntil = subtitleNoticeText ? Date.now() + duration : 0;
    }

    function getSubtitleNotice() {
        if (!subtitleNoticeText) return '';
        if (Date.now() > subtitleNoticeUntil) {
            subtitleNoticeText = '';
            return '';
        }
        return subtitleNoticeText;
    }

    /** 每次换成新字幕时重置时间轴诊断状态。 */
    function markSubtitleLoaded() {
        subtitleLoadedAt = Date.now();
        cueEverMatched = false;
        timelineWarned = false;
    }

    function positionSubtitleList() {
        if (!subtitleList) return;

        const margin = getViewportMargin();
        const gap = FLOATING_UI_GAP;
        const panelVisible = controlPanel && controlPanel.style.display !== 'none';
        const anchorRect = panelVisible
            ? controlPanel.getBoundingClientRect()
            : getBallAnchorRect();

        if (!anchorRect) return;

        subtitleList.style.width = `${Math.min(280, Math.max(220, window.innerWidth - margin * 2))}px`;
        const listWidth = subtitleList.offsetWidth || 280;
        const maxHeight = Math.max(160, window.innerHeight - margin * 2);
        subtitleList.style.maxHeight = `${maxHeight}px`;
        const listHeight = Math.min(subtitleList.scrollHeight, maxHeight);

        let left = anchorRect.left;
        let top = anchorRect.top - listHeight - gap;

        if (panelVisible && window.innerWidth > 640) {
            const spaceRight = window.innerWidth - anchorRect.right - margin;
            const spaceLeft = anchorRect.left - margin;

            if (spaceRight >= listWidth + gap) {
                left = anchorRect.right + gap;
                top = anchorRect.top;
            } else if (spaceLeft >= listWidth + gap) {
                left = anchorRect.left - listWidth - gap;
                top = anchorRect.top;
            }
        }

        left = clamp(left, margin, Math.max(margin, window.innerWidth - listWidth - margin));
        top = clamp(top, margin, Math.max(margin, window.innerHeight - listHeight - margin));

        subtitleList.style.left = `${left}px`;
        subtitleList.style.top = `${top}px`;
        subtitleList.style.right = 'auto';
        subtitleList.style.bottom = 'auto';
    }

    function findVideoElement() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) return null;

        return videos
            .sort((left, right) => scoreVideoElement(right) - scoreVideoElement(left))[0] || null;
    }

    function handleVideoTimeUpdate() {
        updateSubtitle();
    }

    /** 取当前播放时间：优先真实 video 元素，桥接状态作为兜底且要求足够新。 */
    function getPlaybackTime() {
        const video = getActiveVideo();

        if (video && Number.isFinite(video.currentTime) && video.readyState > 0) {
            // 绑定到别的 video（站点多个 video / 重建播放器）时顺手纠正一次
            if (video !== videoElement && Date.now() - lastActiveVideoBindAt > 1500) {
                lastActiveVideoBindAt = Date.now();
                if (!videoElement || !videoElement.isConnected || videoElement.paused) {
                    bindVideoElement(video);
                }
            }
            return video.currentTime;
        }

        if (isBridgeActive && Date.now() - playerBridgeUpdatedAt < 3000) {
            return playerBridgeState.currentTime;
        }

        return video && Number.isFinite(video.currentTime) ? video.currentTime : NaN;
    }

    /** 保证字幕浮层挂在正确宿主上（body，或全屏时的全屏元素）。 */
    function ensureSubtitleMounted() {
        if (!subtitleElement) return false;

        const host = getSubtitleHost();
        if (!host) return false;

        if (subtitleElement.parentElement !== host) {
            host.appendChild(subtitleElement);
        }
        return true;
    }

    /** 独立渲染循环：不依赖 timeupdate，暂停或视频未就绪时也能出字幕。 */
    function startSubtitleRenderLoop() {
        if (subtitleRenderTimer) return;

        let tick = 0;
        subtitleRenderTimer = setInterval(() => {
            tick += 1;
            // 每 1 秒校正一次宿主（应对全屏切换、body 重建）
            if (tick % 10 === 0) ensureSubtitleMounted();

            if (!subtitles.length) {
                if (subtitleText) setSubtitleText('');
                return;
            }

            updateSubtitle();

            // 跟随页面滚动 / 窗口缩放 / 播放器布局变化重新定位
            if (subtitleText && tick % 3 === 0) applySubtitlePresentation();

            // 字幕已加载、视频在播、但一直没命中过任何一条：多半是时间轴不匹配
            if (!cueEverMatched && !timelineWarned && Date.now() - subtitleLoadedAt > 25000) {
                const activeVideo = getActiveVideo();
                if (activeVideo && !activeVideo.paused && activeVideo.currentTime > 8) {
                    timelineWarned = true;
                    showToast('字幕一直没对上，可能是时间轴不匹配。可打开面板调整「字幕偏移」', 5000);
                }
            }
        }, 100);
    }

    function bindVideoElement(video) {
        if (!video) return false;

        if (videoElement && videoElement !== video) {
            videoElement.removeEventListener('timeupdate', handleVideoTimeUpdate);
            videoElement.removeEventListener('seeking', handleVideoTimeUpdate);
            videoElement.removeEventListener('seeked', handleVideoTimeUpdate);
            videoElement.removeEventListener('loadedmetadata', handleVideoTimeUpdate);
            videoElement.removeEventListener('emptied', handleVideoTimeUpdate);
        }

        if (videoElement === video) {
            return true;
        }

        videoElement = video;
        videoElement.addEventListener('timeupdate', handleVideoTimeUpdate);
        videoElement.addEventListener('seeking', handleVideoTimeUpdate);
        videoElement.addEventListener('seeked', handleVideoTimeUpdate);
        videoElement.addEventListener('loadedmetadata', handleVideoTimeUpdate);
        videoElement.addEventListener('emptied', handleVideoTimeUpdate);

        console.log('9527字幕悬浮球: HTML5 video element bound.', videoElement);
        ensureSubtitleMounted();
        startSubtitleRenderLoop();
        updateSubtitle();

        if (!hasShownPlayerReadyToast) {
            hasShownPlayerReadyToast = true;
            showToast('播放器初始化完成', 1500);
        }

        setTimeout(maybeAutoLoadSubtitle, 1500);

        return true;
    }

    /** 记录垂直位置（距视频底部百分比），实际坐标在渲染时按 video 尺寸换算。 */
    function updateSubtitlePositionStyle(positionPercent) {
        if (typeof positionPercent !== 'number' || !Number.isFinite(positionPercent)) return;
        subtitleVerticalPositionPercent = clamp(positionPercent, 0, 90);
        applySubtitlePresentation();
    }

    function updateSubtitleAppearanceStyle() {
        if (!subtitleElement) return;

        const clampedFontSize = clamp(
            Number.isFinite(subtitleFontSize) ? subtitleFontSize : 26,
            12,
            72
        );
        const normalizedColor = normalizeHexColor(subtitleColor) || '#ffffff';

        subtitleFontSize = clampedFontSize;
        subtitleColor = normalizedColor;
        subtitleElement.style.fontSize = `${clampedFontSize}px`;
        subtitleElement.style.color = normalizedColor;
    }

    /**
     * Creates and appends the main control panel to the page.
     */
    function createControlPanel() {
        if (document.querySelector('.custom-control-panel')) return;

        controlPanel = document.createElement('div');
        controlPanel.className = 'custom-control-panel';

        const createInputGroup = (labelText, inputType, value, onInputHandler, keyName, options = {}) => {
            const group = document.createElement('div');
            group.className = 'input-group';
            const label = document.createElement('label');
            label.textContent = labelText;
            const input = document.createElement('input');
            input.type = inputType;
            input.value = value;
            input.setAttribute('data-key-name', keyName);
            if (inputType === 'number') {
                input.min = options.min ?? '';
                input.max = options.max ?? '';
                input.step = options.step ?? 'any';
            }
            if (inputType === 'color') {
                input.value = normalizeHexColor(value) || '#ffffff';
            }
            input.oninput = onInputHandler;
            group.append(label, input);
            return group;
        };

        // 字幕显示设置
        controlPanel.append(
            createInputGroup('字幕偏移', 'number', subtitleOffset, async (e) => {
                const val = parseFloat(e.target.value);
                if (!Number.isFinite(val)) return;
                subtitleOffset = val;
                if (originalSubtitleText) {
                    try {
                        subtitles = await parseSRT(originalSubtitleText);
                        updateSubtitle();
                    } catch (error) {
                        showToast(`应用字幕偏移失败: ${error.message}`);
                    }
                }
            }, 'subtitleOffset', { step: 0.1 }),
            createInputGroup('字幕位置', 'number', subtitleVerticalPositionPercent, (e) => {
                const val = parseFloat(e.target.value);
                if (!Number.isFinite(val)) return;
                subtitleVerticalPositionPercent = val;
                updateSubtitlePositionStyle(subtitleVerticalPositionPercent);
            }, 'subtitlePosition', { min: 0, max: 90, step: 1 }),
            createInputGroup('字幕大小', 'number', subtitleFontSize, (e) => {
                const val = parseFloat(e.target.value);
                if (!Number.isFinite(val)) return;
                subtitleFontSize = clamp(val, 12, 72);
                updateSubtitleAppearanceStyle();
            }, 'subtitleSize', { min: 12, max: 72, step: 1 }),
            createInputGroup('字幕颜色', 'color', subtitleColor, (e) => {
                const nextColor = normalizeHexColor(e.target.value);
                if (!nextColor) return;
                subtitleColor = nextColor;
                updateSubtitleAppearanceStyle();
            }, 'subtitleColor')
        );

        // 自动加载开关
        const autoLoadRow = document.createElement('label');
        autoLoadRow.className = 'auto-load-row';
        const autoLoadCheckbox = document.createElement('input');
        autoLoadCheckbox.type = 'checkbox';
        autoLoadCheckbox.checked = autoLoadEnabled;
        autoLoadCheckbox.onchange = (e) => {
            autoLoadEnabled = e.target.checked;
            localStorage.setItem('missavAutoLoadSubtitle', autoLoadEnabled ? '1' : '0');
            showToast(autoLoadEnabled ? '已开启自动加载字幕' : '已关闭自动加载字幕', 1500);
            if (autoLoadEnabled) {
                autoLoadSuppressed = false;
                autoLoadAttemptedFor = '';
                maybeAutoLoadSubtitle();
            }
        };
        const autoLoadText = document.createElement('span');
        autoLoadText.textContent = '打开视频后自动加载字幕';
        autoLoadRow.append(autoLoadCheckbox, autoLoadText);
        controlPanel.appendChild(autoLoadRow);

        // --- Buttons ---
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-group';

        const subtitleInput = document.createElement('input');
        subtitleInput.type = 'file';
        subtitleInput.accept = '.srt';
        subtitleInput.style.display = 'none';
        subtitleInput.onchange = handleLocalSubtitleFile;

        const createButton = (text, onClickHandler) => {
            const button = document.createElement('button');
            button.textContent = text;
            button.onclick = onClickHandler;
            return button;
        };

        buttonContainer.append(
            createButton('本地字幕', () => subtitleInput.click()),
            createButton('在线搜索', searchSubtitleOnline2),
            createButton('更换字幕', changeSubtitle),
            createButton('站点搜索', searchSubtitleOnline1),
            createButton('清空字幕', clearSubtitles),
            createButton('保存设置', saveSettings)
        );

        const hideButton = createButton('收起面板', hideControlPanel);
        hideButton.className = 'full-width';
        buttonContainer.appendChild(hideButton);
        buttonContainer.appendChild(subtitleInput);

        controlPanel.appendChild(buttonContainer);
        document.body.appendChild(controlPanel);
    }

    /**
     * Creates the initially hidden button to show the control panel.
     */
    function createShowControlsButton() {
        if (showControlsButton) return;

        showControlsButton = document.createElement('button');
        showControlsButton.className = 'show-controls-button';
        showControlsButton.textContent = '字幕';
        showControlsButton.style.display = 'flex';
        showControlsButton.addEventListener('pointerdown', handleFloatingButtonPointerDown);
        showControlsButton.addEventListener('click', handleFloatingButtonClick);
        document.body.appendChild(showControlsButton);
        applyFloatingButtonPosition();
    }

    /** Hides the main control panel and shows the 'Show Controls' button. */
    function hideControlPanel() {
        if (controlPanel) controlPanel.style.display = 'none';
        if (showControlsButton) showControlsButton.style.display = 'flex';
        if (subtitleList) subtitleList.style.display = 'none';
    }

    /** Shows the main control panel and hides the 'Show Controls' button. */
    function showControlPanel() {
        if (controlPanel) controlPanel.style.display = 'grid';
        positionControlPanel();
        if (showControlsButton) showControlsButton.style.display = 'none';
        if (subtitleList) {
            subtitleList.style.display = 'block';
            positionSubtitleList();
        }
    }

    /** 创建字幕浮层（挂在 body 上，位置由渲染循环按 video 坐标实时计算）。 */
    function setupSubtitleDisplay() {
        subtitleElement = document.createElement('div');
        subtitleElement.className = 'custom-subtitle';
        subtitleElement.style.display = 'none';
        updateSubtitleAppearanceStyle();
        updateSubtitlePositionStyle(subtitleVerticalPositionPercent);

        ensureSubtitleMounted();

        // 反复确认挂载状态：body 被站点重建、全屏切换时都能自动接回
        setInterval(() => {
            ensureSubtitleMounted();
        }, 1000);

        setTimeout(() => {
            if (!getActiveVideo()) {
                console.warn('9527字幕悬浮球: 暂未找到 video 元素（播放器可能还没加载）');
            }
        }, 8000);
    }

    /** Handles the selection of a local SRT file. */
    async function handleLocalSubtitleFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = null; // Reset input

        try {
            const text = await file.text();
            const parsed = await parseSRT(text);
            if (!parsed.length) throw new Error('未解析到有效字幕条目');

            originalSubtitleText = text;
            subtitles = parsed;
            currentSubtitleUrl = '';
            currentSubtitleName = file.name;
            autoLoadSuppressed = true;

            ensureSubtitleMounted();
            startSubtitleRenderLoop();
            markSubtitleLoaded();
            setSubtitleNotice(`字幕已就绪 · ${parsed.length} 条 · ${formatClock(getActiveVideo()?.currentTime)}`);
            updateSubtitle();
            if (subtitleList) closeSubtitleList();
            showToast('本地字幕加载成功');
        } catch (error) {
            console.error("Subtitle load error:", error);
            showToast(`本地字幕加载失败: ${error.message}`);
            clearSubtitles();
        }
    }

    /** Parses SRT text into subtitle objects, applying the current offset. */
    async function parseSRT(text) {
         return new Promise((resolve) => {
            const subs = text
                .replace(/\r/g, '') // Remove carriage returns
                .split(/\n\n+/) // Split into blocks
                .filter(Boolean) // Remove empty blocks
                .map(block => {
                    try {
                        const lines = block.split('\n');
                        if (lines.length < 2) return null; // Need at least time + text

                        let timeLineIndex = lines[0].includes('-->') ? 0 : (lines.length > 1 && lines[1].includes('-->') ? 1 : -1); // Allow time on line 0 or 1

                        if (timeLineIndex === -1) return null; // Invalid time line format

                        const [startStr, endStr] = lines[timeLineIndex].split(' --> ');
                        const rawStart = parseTime(startStr) + subtitleOffset;
                        const rawEnd = parseTime(endStr) + subtitleOffset;
                        // 负偏移落在地平线之前的字幕保留可见部分，而不是整条丢掉
                        const start = Math.max(0, rawStart);
                        const end = rawEnd;
                        const textContent = lines.slice(timeLineIndex + 1).join('\n').trim();

                        if (isNaN(start) || isNaN(end) || end <= 0 || start > end || !textContent) return null;

                        return { start, end, text: textContent };
                    } catch (e) {
                        console.warn("Skipping invalid SRT block:", block, e);
                        return null; // Skip malformed blocks
                    }
                })
                .filter(Boolean); // Remove any null results from map
            resolve(subs.sort((a, b) => a.start - b.start)); // 保证升序，便于线性查找提前退出
        });
    }

    /** Parses SRT time string (HH:MM:SS,ms) into seconds. */
    function parseTime(timeStr) {
        try {
             const [hms, msPart] = timeStr.split(/[,.]/);
             const ms = msPart ? parseInt(msPart.padEnd(3, '0').slice(0, 3), 10) : 0; // Ensure 3 digits for ms, handle missing ms
             const [h, m, s] = hms.split(':');
             const hours = parseInt(h, 10) || 0;
             const minutes = parseInt(m, 10) || 0;
             const seconds = parseInt(s, 10) || 0;

             if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(ms)) {
                 throw new Error("Invalid time component");
             }
             return (hours * 3600) + (minutes * 60) + seconds + (ms / 1000);
         } catch (e) {
             console.error("Failed to parse time string:", timeStr, e);
             return NaN; // Return NaN on failure
         }
    }

    /** Updates the displayed subtitle based on the current video time. */
    function updateSubtitle() {
        if (!subtitleElement) return;

        if (!subtitles || subtitles.length === 0) {
            setSubtitleText('');
            return;
        }

        try {
            const currentTime = getPlaybackTime();
            if (!Number.isFinite(currentTime)) {
                setSubtitleText(getSubtitleNotice());
                return;
            }

            let activeCue = null;
            for (let i = 0; i < subtitles.length; i += 1) {
                const cue = subtitles[i];
                if (currentTime >= cue.start && currentTime <= cue.end) {
                    activeCue = cue;
                    break;
                }
                if (cue.start > currentTime) break; // 字幕按时间升序，越界即可停
            }

            // 已经正常出过字幕，就不需要再提示了
            if (activeCue) {
                cueEverMatched = true;
                if (subtitleNoticeText) {
                    subtitleNoticeText = '';
                    subtitleNoticeUntil = 0;
                }
            }

            // 没有命中的条目时，加载后的几秒内显示状态提示（确认浮层在工作）
            setSubtitleText(activeCue ? activeCue.text : getSubtitleNotice());
        } catch (e) {
            console.error("Error updating subtitle:", e);
        }
    }

    /** Initializes connection with the HTML5 video element. */
    function initPlayer() {
        let attempts = 0;

        if (playerMonitorInterval) {
            clearInterval(playerMonitorInterval);
            playerMonitorInterval = null;
        }

        const checkPlayerInterval = setInterval(() => {
            attempts += 1;
            const currentVideo = findVideoElement();

            if (currentVideo && bindVideoElement(currentVideo)) {
                clearInterval(checkPlayerInterval);
                playerMonitorInterval = setInterval(() => {
                    const refreshedVideo = findVideoElement();
                    if (!refreshedVideo) return;

                    if (!videoElement || !videoElement.isConnected || refreshedVideo !== videoElement) {
                        bindVideoElement(refreshedVideo);
                    }
                }, 1000);
                return;
            }

            if (attempts >= 30) {
                clearInterval(checkPlayerInterval);
                console.error('9527字幕悬浮球: Failed to find HTML5 video after 15 seconds.');
                showToast('错误：无法连接到播放器实例', 5000);
            }
        }, 500);
    }

    /** 按番号跳转 Subtitlecat 搜索。 */
    function searchSubtitleOnline1() {
        const videoID = getCurrentVideoID();
        if (!videoID) {
            showToast('无法获取当前视频番号');
            return;
        }
        const searchUrl = `https://subtitlecat.com/index.php?search=${encodeURIComponent(videoID)}`;
        openInNewTab(searchUrl);
        showToast(`正在打开 Subtitlecat 搜索: ${videoID}`);
    }

    /** 拉取某番号下的 SRT 候选列表。 */
    async function requestSubtitleCandidates(videoID) {
        const apiUrl = `https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=${encodeURIComponent(videoID)}`;
        const data = await fetchSubtitleAPI(apiUrl);

        if (data?.code !== 0 || !Array.isArray(data.data)) {
            return [];
        }

        return data.data.filter((item) => item && item.url && item.url.toLowerCase().includes('.srt'));
    }

    function cacheSearchResults(videoID, list) {
        lastSearchResults = Array.isArray(list) ? list : [];
        lastSearchVideoId = videoID || '';
    }

    /** 手动在线搜索：展示候选列表。 */
    async function searchSubtitleOnline2() {
        const videoID = getCurrentVideoID();
        if (!videoID) {
            showToast('无法获取当前视频番号');
            return;
        }

        showToast(`正在搜索字幕: ${videoID}...`);
        closeSubtitleList();

        try {
            const list = await requestSubtitleCandidates(videoID);
            cacheSearchResults(videoID, list);

            if (list.length) {
                showSubtitleList(list);
            } else {
                showToast(`未找到 ${videoID} 的字幕`);
            }
        } catch (error) {
            console.error('Subtitle search error:', error);
            showToast(`字幕搜索出错: ${error.message}`);
        }
    }

    /** 在候选里随机挑一条，排除当前正在用的那条。 */
    function pickRandomCandidate(excludeUrl) {
        const pool = lastSearchResults.filter((item) => item.url !== excludeUrl);
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** 面板「更换字幕」：没有候选就现搜一次，然后随机换一条。 */
    async function changeSubtitle() {
        const videoID = getCurrentVideoID();
        if (!videoID) {
            showToast('无法获取当前视频番号');
            return;
        }

        if (!lastSearchResults.length || lastSearchVideoId !== videoID) {
            showToast(`正在获取字幕列表: ${videoID}...`);
            try {
                const list = await requestSubtitleCandidates(videoID);
                cacheSearchResults(videoID, list);
            } catch (error) {
                showToast(`字幕搜索出错: ${error.message}`);
                return;
            }
        }

        if (!lastSearchResults.length) {
            showToast('该视频没有可用字幕');
            return;
        }

        const next = pickRandomCandidate(currentSubtitleUrl);
        if (!next) {
            showToast('只有一条字幕，无法更换');
            return;
        }

        const total = lastSearchResults.length;
        const index = lastSearchResults.indexOf(next) + 1;
        const ok = await loadRemoteSubtitle(next.url, {
            name: next.name,
            silent: true
        });

        if (ok) {
            showToast(`已换字幕 (${index}/${total}): ${next.name}`, 2200);
        }
    }

    /** 打开视频后自动搜一次并随机加载一条。 */
    function maybeAutoLoadSubtitle() {
        if (!autoLoadEnabled || autoLoadSuppressed) return;
        if (subtitles.length) return;

        const videoID = getCurrentVideoID();
        if (!videoID) return;
        if (autoLoadAttemptedFor === videoID) return;

        autoLoadAttemptedFor = videoID;
        autoLoadSubtitle(videoID);
    }

    async function autoLoadSubtitle(videoID) {
        try {
            const list = await requestSubtitleCandidates(videoID);
            cacheSearchResults(videoID, list);

            if (!list.length) {
                console.log('9527字幕悬浮球: 自动加载未找到字幕', videoID);
                return;
            }

            // 期间用户可能已经手动加载或关闭开关
            if (!autoLoadEnabled || autoLoadSuppressed || currentSubtitleUrl) return;

            const pick = list[Math.floor(Math.random() * list.length)];
            const ok = await loadRemoteSubtitle(pick.url, {
                name: pick.name,
                silent: true
            });

            if (ok) {
                showToast(`自动加载字幕: ${pick.name}`, 2000);
            }
        } catch (error) {
            console.warn('9527字幕悬浮球: 自动加载失败', error);
        }
    }

    /** Fetches data via GM.xmlHttpRequest. */
    function fetchSubtitleAPI(url) {
        return gmRequest({
            method: 'GET',
            url,
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache'
            },
            responseType: 'json',
            timeout: 15000
        }).then((response) => {
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`服务器错误 ${response.status}`);
            }

            return parseJsonResponse(response);
        });
    }

    /** Displays list of found subtitles. */
    function showSubtitleList(items) {
         closeSubtitleList(); // Ensure only one list is open

        subtitleList = document.createElement('div');
        subtitleList.className = 'subtitle-list';

        const title = document.createElement('div');
        title.textContent = '选择在线字幕:';
        title.style.cssText = 'color:#ccc; margin-bottom:8px; font-weight: bold;';
        subtitleList.appendChild(title);

        if (items.length === 0) {
            const noSubs = document.createElement('div');
            noSubs.textContent = '未找到相关字幕。';
            noSubs.style.padding = '5px';
            subtitleList.appendChild(noSubs);
        } else {
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'subtitle-item';
                div.textContent = `${item.name}${item.extra_name ? ` (${item.extra_name})` : ''}`;
                div.title = `点击加载: ${item.name}`;
                div.onclick = (e) => {
                    e.stopPropagation();
                    loadRemoteSubtitle(item.url, { name: item.name });
                };
                subtitleList.appendChild(div);
            });
        }

         const closeBtn = document.createElement('button');
         closeBtn.textContent = '关闭列表';
         closeBtn.style.cssText = 'margin-top: 10px; padding: 4px 6px; font-size: 11px; background: #555; border: none; color: white; border-radius: 3px; cursor: pointer; display: block; margin-left: auto; margin-right: auto;';
         closeBtn.onclick = closeSubtitleList;
         subtitleList.appendChild(closeBtn);

         document.body.appendChild(subtitleList);
         positionSubtitleList();

         setTimeout(() => {
             document.addEventListener('click', handleClickOutsideList, true);
         }, 0);
    }

    /** Closes the subtitle list. */
    function handleClickOutsideList(event) {
        if (subtitleList
            && !subtitleList.contains(event.target)
            && !event.target.closest('.custom-control-panel button')
            && !event.target.closest('.show-controls-button')) {
            closeSubtitleList();
        }
    }

    /** Removes subtitle list and listener. */
    function closeSubtitleList() {
        if (subtitleList) {
            subtitleList.remove();
            subtitleList = null;
        }
        document.removeEventListener('click', handleClickOutsideList, true);
    }

    /**
     * 加载在线字幕。
     * @param {string} url SRT 地址
     * @param {{name?: string, silent?: boolean}} meta 名称与是否静默
     * @returns {Promise<boolean>} 是否成功
     */
    async function loadRemoteSubtitle(url, meta = {}) {
        const seq = ++loadSeq;
        const silent = Boolean(meta.silent);

        if (!silent) showToast('正在加载在线字幕...');
        closeSubtitleList();

        try {
            const response = await gmRequest({
                method: 'GET',
                url,
                headers: {
                    Accept: 'text/plain,*/*'
                },
                responseType: 'text',
                timeout: 20000
            });

            if (seq !== loadSeq) return false; // 已被更新的请求取代

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`下载失败 (HTTP ${response.status})`);
            }

            const srtContent = getResponseText(response);
            if (!srtContent.trim()) {
                throw new Error('字幕内容为空');
            }

            const parsed = await parseSRT(srtContent);
            if (seq !== loadSeq) return false;
            if (!parsed.length) {
                throw new Error('未解析到有效字幕条目');
            }

            originalSubtitleText = srtContent;
            subtitles = parsed;
            currentSubtitleUrl = url;
            currentSubtitleName = meta.name || '';

            // 关键：加载完立刻挂载并渲染一次，不再等 timeupdate
            ensureSubtitleMounted();
            startSubtitleRenderLoop();
            markSubtitleLoaded();

            const activeVideo = getActiveVideo();
            setSubtitleNotice(activeVideo
                ? `字幕已就绪 · ${parsed.length} 条 · ${formatClock(activeVideo.currentTime)}`
                : `字幕已就绪 · ${parsed.length} 条 · 未找到播放器`);

            updateSubtitle();

            if (!silent) {
                showToast(meta.name ? `字幕已加载: ${meta.name}` : '在线字幕加载成功');
            }
            return true;
        } catch (error) {
            if (seq !== loadSeq) return false;
            console.error("Error loading remote subtitle:", error);
            if (!silent) {
                showToast(`在线字幕加载失败: ${error.message}`);
            }
            return false;
        }
    }

    /** Clears current subtitles. */
    function clearSubtitles() {
        loadSeq += 1; // 丢弃还在路上的请求
        subtitles = [];
        originalSubtitleText = '';
        currentSubtitleUrl = '';
        currentSubtitleName = '';
        autoLoadSuppressed = true; // 用户主动清空后，本页不再自动加载
        setSubtitleNotice('');
        setSubtitleText('');
        showToast('字幕已清除', 1500);
    }

    /** Extracts video ID from URL. */
    function getCurrentVideoID() {
         try {
            const path = window.location.pathname;
            const segments = path.split('/').filter(s => s.length > 0);

            if (segments.length === 0) return '';

            // Check last segment first (most common case)
            const lastSegment = segments[segments.length - 1];
            let idMatch = lastSegment.match(/^([a-zA-Z]{2,6})[-_]?(\d{2,5})/i); // Common format: ABC-123 or ABC_123 or ABC123
            if (idMatch) return `${idMatch[1].toUpperCase()}-${idMatch[2]}`;

            // Check if last segment is just the ID without prefix like /ja/1234567 (less common for standard IDs)
            // if (lastSegment.match(/^\d{5,}$/)) { } // Maybe ignore purely numeric IDs unless sure?

            // Check second to last segment (e.g., /videos/abc-123/play)
            if (segments.length >= 2) {
                const secondLastSegment = segments[segments.length - 2];
                idMatch = secondLastSegment.match(/^([a-zA-Z]{2,6})[-_]?(\d{2,5})/i);
                if (idMatch) return `${idMatch[1].toUpperCase()}-${idMatch[2]}`;
            }

            // Fallback: Check entire path for the pattern
            idMatch = path.match(/([a-zA-Z]{2,6})[-_]?(\d{2,5})/i);
            if (idMatch) return `${idMatch[1].toUpperCase()}-${idMatch[2]}`;

            // Final fallback: Return last segment if it contains a hyphen (might be an ID)
            if(lastSegment.includes('-') && lastSegment.length > 3) return lastSegment.toUpperCase();

            console.warn("Could not determine Video ID from path:", path);
            return ''; // Return empty if no ID found

        } catch (error) {
            console.error("Error getting Video ID:", error);
            return '';
        }
    }

    /** Saves settings to localStorage. */
    function saveSettings() {
        try {
            subtitleFontSize = clamp(
                Number.isFinite(subtitleFontSize) ? subtitleFontSize : 26,
                12,
                72
            );
            subtitleColor = normalizeHexColor(subtitleColor) || '#ffffff';
            localStorage.setItem('missavSubtitleOffset', subtitleOffset);
            localStorage.setItem('missavSubtitlePosition', subtitleVerticalPositionPercent);
            localStorage.setItem('missavSubtitleSize', subtitleFontSize);
            localStorage.setItem('missavSubtitleColor', subtitleColor);
            localStorage.setItem('missavAutoLoadSubtitle', autoLoadEnabled ? '1' : '0');
            showToast('设置已保存');
        } catch (e) {
            console.error("Error saving settings:", e);
            showToast('保存设置失败');
        }
    }

    /** Displays a toast message. */
    function showToast(message, duration = 3000) {
         const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.75);
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            z-index: 10002;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
            max-width: 300px; /* Prevent overly wide toasts */
            text-align: center;
        `;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; }, 50);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, duration);
    }

    // --- Initialization ---
    function initializeScript() {
        console.log("9527字幕悬浮球: Initializing...");
        setupSubtitleDisplay();
        createControlPanel();
        createShowControlsButton();
        hideControlPanel();
        window.addEventListener('resize', handleViewportChange);
        setupPlayerBridge();
        initPlayer();
        startSubtitleRenderLoop();
        setInterval(maybeAutoLoadSubtitle, 3000); // 兜底：SPA 换集 / 视频晚到
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        console.log("9527字幕悬浮球: Initialization complete.");
    }

    // Use MutationObserver or fallback timer to start initialization
    let initStarted = false;
    const observer = new MutationObserver((mutationsList, obs) => {
        const playerElement = findVideoElement();
        if (playerElement && !initStarted) {
             console.log("9527字幕悬浮球: Player element detected, running main script.");
             initStarted = true;
             obs.disconnect();
             initializeScript();
         }
    });

    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

    setTimeout(() => {
        if (!initStarted) {
             console.log("9527字幕悬浮球: Fallback timer triggered, attempting initialization.");
             initStarted = true; // Prevent double initialization
             observer.disconnect();
             initializeScript();
         }
     }, 4000); // Increased fallback timer slightly

})(); // End of IIFE
