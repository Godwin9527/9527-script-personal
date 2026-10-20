// ==UserScript==
// @name         9527Reddit视频焦点发声
// @namespace    https://github.com/Godwin9527
// @version      1.0.1
// @description  Reddit 滚动浏览时，视口中心的视频自动取消静音，其余视频自动静音，保证同一时刻只有一个视频发声
// @author       Godwin9527
// @run-at       document-idle
// @match        *://www.reddit.com/*
// @match        *://sh.reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-focus-unmute/reddit-focus-unmute.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-focus-unmute/reddit-focus-unmute.meta.js
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'reddit-focus-unmute-config';
    const STORAGE_PREFIX = '9527-reddit-focus-unmute:';
    const TOAST_HOST_ID = 'reddit-focus-unmute-toast';
    const LOG_PREFIX = '[焦点发声]';

    const PLAYER_SELECTOR = 'shreddit-player, shreddit-player-2';
    const MUTE_LABEL_STRICT_RE = /(mute|unmute|静音|声音|sound)/i;
    const MUTE_LABEL_LOOSE_RE = /(volume|audio|音量)/i;

    const RATIO_OPTIONS = [0.25, 0.35, 0.5, 0.65];
    const SETTLE_OPTIONS = [100, 180, 300, 500];

    const MIN_VISIBLE_PX = 120;
    const GUARD_MS = 400;
    const GESTURE_WINDOW_MS = 900;
    const HYSTERESIS_RATIO = 0.2;
    const SCAN_DEBOUNCE_MS = 400;
    const SWEEP_INTERVAL_MS = 2000;
    const DEEP_SCAN_INTERVAL_MS = 10000;
    const DEPTH_LIMIT = 6;

    const DEFAULTS = {
        enabled: true,
        minRatio: 0.35,
        settleMs: 180,
    };

    const records = new Map();
    let activeVideo = null;
    let config = loadConfig();
    let evaluateTimer = 0;
    let scanTimer = 0;
    let sweepTimer = 0;
    let lastGestureAt = 0;
    let lastDeepScanAt = 0;
    let menuIds = [];

    /* ---------------- 配置 ---------------- */

    function loadConfig() {
        let saved = null;
        try {
            saved = storageGet(STORAGE_KEY, null);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 读取配置失败:`, error);
        }
        if (!saved || typeof saved !== 'object') {
            return { ...DEFAULTS };
        }
        return {
            enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled,
            minRatio: Number.isFinite(Number(saved.minRatio)) ? clampRatio(Number(saved.minRatio)) : DEFAULTS.minRatio,
            settleMs: Number.isFinite(Number(saved.settleMs)) ? clampSettle(Number(saved.settleMs)) : DEFAULTS.settleMs,
        };
    }

    function saveConfig() {
        try {
            storageSet(STORAGE_KEY, config);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 保存配置失败:`, error);
            showToast('配置保存失败，请检查脚本管理器权限');
        }
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

    function clampRatio(value) {
        return RATIO_OPTIONS.reduce((prev, cur) => (Math.abs(cur - value) < Math.abs(prev - value) ? cur : prev), RATIO_OPTIONS[0]);
    }

    function clampSettle(value) {
        return SETTLE_OPTIONS.reduce((prev, cur) => (Math.abs(cur - value) < Math.abs(prev - value) ? cur : prev), SETTLE_OPTIONS[0]);
    }

    /* ---------------- DOM 工具 ---------------- */

    function deepQueryAll(root, selector, maxDepth = DEPTH_LIMIT) {
        const result = [];
        const seen = new Set();
        const walk = (node, depth) => {
            if (!node || depth > maxDepth) {
                return;
            }
            let matched = null;
            try {
                matched = node.querySelectorAll(selector);
            } catch (error) {
                return;
            }
            for (const el of matched) {
                if (!seen.has(el)) {
                    seen.add(el);
                    result.push(el);
                }
            }
            // 关键：根节点自身的 shadowRoot 也要进去
            if (node.shadowRoot) {
                walk(node.shadowRoot, depth + 1);
            }
            for (const el of node.querySelectorAll('*')) {
                if (el.shadowRoot) {
                    walk(el.shadowRoot, depth + 1);
                }
            }
        };
        walk(root, 0);
        return result;
    }

    function findPlayer(video) {
        let node = video.parentNode;
        while (node) {
            if (node.nodeType === 1 && /^SHREDDIT-PLAYER(-2)?$/.test(node.tagName)) {
                return node;
            }
            node = node.host || node.parentNode;
        }
        return null;
    }

    function describeElement(el) {
        const className = typeof el.className === 'string' ? el.className : '';
        return [
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid'),
            className,
        ].filter(Boolean).join(' ');
    }

    /* ---------------- 视频登记 ---------------- */

    function scanVideos() {
        const found = new Set();
        for (const video of document.querySelectorAll('video')) {
            found.add(video);
        }
        for (const player of document.querySelectorAll(PLAYER_SELECTOR)) {
            for (const video of deepQueryAll(player, 'video')) {
                found.add(video);
            }
        }
        // 兜底：结构变化导致上面都没找到时，全文档深扫一次（限频，避免拖慢页面）
        if (found.size === 0 && Date.now() - lastDeepScanAt > DEEP_SCAN_INTERVAL_MS) {
            lastDeepScanAt = Date.now();
            for (const video of deepQueryAll(document, 'video', 5)) {
                found.add(video);
            }
        }
        for (const video of found) {
            if (!records.has(video)) {
                records.set(video, createRecord(video));
            }
        }
        for (const [video, record] of records) {
            if (!video.isConnected) {
                records.delete(video);
                if (activeVideo === video) {
                    activeVideo = null;
                }
            } else if (!record.player || !record.player.isConnected) {
                record.player = findPlayer(video);
            }
        }
    }

    function createRecord(video) {
        const record = {
            video,
            player: findPlayer(video),
            layer: 0,
            guardUntil: 0,
            overrideAt: 0,
            button: null,
            buttonMisses: 0,
        };

        video.addEventListener('volumechange', () => {
            if (Date.now() < record.guardUntil) {
                return;
            }
            if (Date.now() - lastGestureAt > GESTURE_WINDOW_MS) {
                return;
            }
            record.overrideAt = Date.now();
        });

        video.addEventListener('loadedmetadata', () => scheduleEvaluate());
        video.addEventListener('play', () => scheduleEvaluate());

        return record;
    }

    /* ---------------- 静音控制 ---------------- */

    function findMuteButton(record) {
        if (record.button && record.button.isConnected) {
            return record.button;
        }
        record.button = null;

        const scopes = [];
        if (record.player && record.player.isConnected) {
            scopes.push(record.player);
        }
        const root = record.video.getRootNode();
        if (root && root !== document) {
            scopes.push(root);
        }
        if (record.video.parentElement) {
            scopes.push(record.video.parentElement);
        }

        const candidates = [];
        for (const scope of scopes) {
            for (const el of deepQueryAll(scope, 'button, [role="button"]')) {
                if (isSliderLike(el)) {
                    continue;
                }
                const text = describeElement(el);
                if (MUTE_LABEL_STRICT_RE.test(text)) {
                    record.button = el;
                    return el;
                }
                if (MUTE_LABEL_LOOSE_RE.test(text)) {
                    candidates.push(el);
                }
            }
        }

        record.button = candidates[0] || null;
        return record.button;
    }

    function isSliderLike(el) {
        if (el.tagName === 'INPUT') {
            return true;
        }
        const role = el.getAttribute('role');
        return role === 'slider' || role === 'spinbutton';
    }

    function setMutedViaPlayer(record, muted) {
        const player = record.player;
        if (!player) {
            return false;
        }
        try {
            if (typeof player.setMuted === 'function') {
                player.setMuted(muted);
                if (record.video.muted === muted) {
                    return true;
                }
            }
            if (typeof player.toggleMute === 'function' && record.video.muted !== muted) {
                player.toggleMute();
                if (record.video.muted === muted) {
                    return true;
                }
            }
            if ('muted' in player) {
                player.muted = muted;
                if (record.video.muted === muted) {
                    return true;
                }
            }
        } catch (error) {
            return false;
        }
        return false;
    }

    function applyMute(record, muted) {
        const video = record.video;
        if (!video || !video.isConnected || video.muted === muted) {
            return;
        }

        record.guardUntil = Date.now() + GUARD_MS;

        const button = record.buttonMisses >= 2 ? null : findMuteButton(record);
        if (button) {
            try {
                button.click();
            } catch (error) {
                // 忽略，交给下一层
            }
            if (video.muted === muted) {
                record.buttonMisses = 0;
                record.layer = 1;
                return;
            }
            record.buttonMisses += 1;
        }

        if (setMutedViaPlayer(record, muted)) {
            record.layer = 2;
            return;
        }

        try {
            video.muted = muted;
            record.layer = 3;
        } catch (error) {
            console.warn(`${LOG_PREFIX} 设置静音失败:`, error);
        }
    }

    /* ---------------- 焦点判定 ---------------- */

    function measure(record) {
        const video = record.video;
        if (!video.isConnected || video.readyState < 1) {
            return null;
        }
        const rect = video.getBoundingClientRect();
        if (rect.height < 1 || rect.width < 1) {
            return null;
        }
        const viewportHeight = window.innerHeight;
        const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        if (visible < MIN_VISIBLE_PX) {
            return null;
        }
        return {
            ratio: Math.min(1, visible / rect.height),
            distance: Math.abs((rect.top + rect.bottom) / 2 - viewportHeight / 2),
            viewportHeight,
        };
    }

    function pickTarget() {
        let best = null;
        let bestDistance = Infinity;

        for (const record of records.values()) {
            const metrics = measure(record);
            if (!metrics || metrics.ratio < config.minRatio) {
                continue;
            }
            if (metrics.distance < bestDistance) {
                bestDistance = metrics.distance;
                best = record;
            }
        }

        const current = activeVideo ? records.get(activeVideo) : null;
        if (current && best && current !== best) {
            const currentMetrics = measure(current);
            if (currentMetrics && currentMetrics.ratio >= config.minRatio * 0.8) {
                if (currentMetrics.distance <= bestDistance + currentMetrics.viewportHeight * HYSTERESIS_RATIO) {
                    return current;
                }
            }
        }

        return best;
    }

    function evaluate() {
        if (!config.enabled) {
            return;
        }
        scanVideos();
        const target = pickTarget();
        setActive(target ? target.video : null);
    }

    function setActive(video) {
        if (activeVideo !== video) {
            activeVideo = video;
            for (const record of records.values()) {
                record.overrideAt = 0;
            }
        }

        for (const record of records.values()) {
            if (record.overrideAt) {
                continue;
            }
            applyMute(record, record.video !== video);
        }
    }

    function enforceSingleSound() {
        if (!config.enabled || !activeVideo) {
            return;
        }
        for (const record of records.values()) {
            if (record.overrideAt || record.video === activeVideo) {
                continue;
            }
            if (record.video.muted === false) {
                applyMute(record, true);
            }
        }
    }

    /* ---------------- 调度 ---------------- */

    function scheduleEvaluate(delay) {
        const wait = Number.isFinite(delay) ? delay : config.settleMs;
        window.clearTimeout(evaluateTimer);
        evaluateTimer = window.setTimeout(() => {
            if (document.visibilityState === 'hidden') {
                return;
            }
            evaluate();
        }, wait);
    }

    function scheduleScan() {
        window.clearTimeout(scanTimer);
        scanTimer = window.setTimeout(() => {
            scanVideos();
            scheduleEvaluate(0);
        }, SCAN_DEBOUNCE_MS);
    }

    /* ---------------- 提示 ---------------- */

    function showToast(message) {
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
                :host { all: initial; color-scheme: light; }
                .toast {
                    position: fixed;
                    left: 50%;
                    bottom: 32px;
                    z-index: 2147483647;
                    max-width: min(420px, calc(100vw - 32px));
                    box-sizing: border-box;
                    padding: 10px 16px;
                    transform: translateX(-50%);
                    border-radius: 7px;
                    background: #232528;
                    color: #ffffff;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
                    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                    text-align: center;
                }
            </style>
            <div class="toast" role="status"></div>
        `;
        shadow.querySelector('.toast').textContent = message;

        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => host.remove(), 2600);
    }

    /* ---------------- 菜单 ---------------- */

    function toggleEnabled() {
        config.enabled = !config.enabled;
        saveConfig();
        refreshMenus();
        showToast(config.enabled ? '焦点发声已开启' : '焦点发声已关闭');
        if (config.enabled) {
            scheduleEvaluate(0);
        }
    }

    function cycleRatio() {
        const index = RATIO_OPTIONS.indexOf(config.minRatio);
        config.minRatio = RATIO_OPTIONS[(index + 1) % RATIO_OPTIONS.length];
        saveConfig();
        refreshMenus();
        showToast(`可见阈值：${Math.round(config.minRatio * 100)}%`);
        scheduleEvaluate(0);
    }

    function cycleSettle() {
        const index = SETTLE_OPTIONS.indexOf(config.settleMs);
        config.settleMs = SETTLE_OPTIONS[(index + 1) % SETTLE_OPTIONS.length];
        saveConfig();
        refreshMenus();
        showToast(`响应延迟：${config.settleMs} ms`);
    }

    function dumpDiagnostics() {
        scanVideos();
        const lines = [];
        lines.push(`${LOG_PREFIX} 视频=${records.size} 当前焦点=${activeVideo ? '有' : '无'} 开关=${config.enabled ? '开' : '关'} 阈值=${Math.round(config.minRatio * 100)}% 延迟=${config.settleMs}ms`);
        for (const record of records.values()) {
            const metrics = measure(record);
            lines.push([
                `  ${record.player ? record.player.tagName.toLowerCase() : '独立video'}`,
                `muted=${record.video.muted}`,
                `paused=${record.video.paused}`,
                `可见=${metrics ? Math.round(metrics.ratio * 100) + '%' : '-'}`,
                `层级=${record.layer}`,
                `手动=${record.overrideAt ? '是' : '否'}`,
                `焦点=${record.video === activeVideo ? '是' : '否'}`,
            ].join(' '));
        }
        if (records.size === 0) {
            lines.push('  未发现可控制的视频（redgifs 等跨域 iframe 无法控制）');
        }
        console.log(lines.join('\n'));
        showToast('诊断信息已输出到控制台');
    }

    function refreshMenus() {
        if (typeof GM_registerMenuCommand !== 'function') {
            return;
        }
        if (typeof GM_unregisterMenuCommand === 'function') {
            for (const id of menuIds) {
                try {
                    GM_unregisterMenuCommand(id);
                } catch (error) {
                    // 忽略
                }
            }
        }
        menuIds = [];
        const register = (label, handler) => {
            const id = GM_registerMenuCommand(label, handler);
            if (id !== undefined && id !== null) {
                menuIds.push(id);
            }
        };
        register(`${config.enabled ? '✅' : '⛔'} 焦点发声：${config.enabled ? '已开启' : '已关闭'}`, toggleEnabled);
        register(`🎯 可见阈值：${Math.round(config.minRatio * 100)}%（点击切换）`, cycleRatio);
        register(`⏱ 响应延迟：${config.settleMs} ms（点击切换）`, cycleSettle);
        register('🩺 输出诊断信息', dumpDiagnostics);
    }

    /* ---------------- 事件绑定 ---------------- */

    function bindEvents() {
        window.addEventListener('scroll', () => scheduleEvaluate(), { passive: true, capture: true });

        window.addEventListener('resize', () => scheduleEvaluate(300), { passive: true });

        document.addEventListener('pointerdown', () => {
            lastGestureAt = Date.now();
        }, { passive: true, capture: true });

        document.addEventListener('keydown', () => {
            lastGestureAt = Date.now();
        }, { passive: true, capture: true });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                scheduleEvaluate(0);
            }
        });

        for (const eventName of ['afterRoute', 'beforeRoute']) {
            window.addEventListener(eventName, () => {
                activeVideo = null;
                scheduleScan();
            });
        }

        const observer = new MutationObserver(() => scheduleScan());
        observer.observe(document.documentElement, { childList: true, subtree: true });

        sweepTimer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                enforceSingleSound();
            }
        }, SWEEP_INTERVAL_MS);
    }

    function start() {
        bindEvents();
        refreshMenus();
        scanVideos();
        scheduleEvaluate(300);
    }

    start();
})();
