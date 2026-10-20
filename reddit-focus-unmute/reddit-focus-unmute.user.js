// ==UserScript==
// @name         9527Reddit视频焦点发声
// @namespace    https://github.com/Godwin9527
// @version      1.1.4
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
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      api.redgifs.com
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
    const PANEL_HOST_ID = 'reddit-focus-unmute-panel';
    const LOG_PREFIX = '[焦点发声]';

    const PLAYER_SELECTOR = 'shreddit-player, shreddit-player-2';
    const EMBED_SELECTOR = 'shreddit-embed';
    const REDGIFS_SRC_RE = /redgifs\.com\/(?:ifr|watch)\/([A-Za-z0-9]+)/i;
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
    const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
    const DEPTH_LIMIT = 6;

    const DEFAULTS = {
        enabled: true,
        minRatio: 0.35,
        settleMs: 180,
        redgifs: true,
    };

    const records = new Map();
    const embedRecords = new Map();
    const gifUrlCache = new Map();
    const embedFailures = [];
    let activeVideo = null;
    let config = loadConfig();
    let evaluateTimer = 0;
    let scanTimer = 0;
    let sweepTimer = 0;
    let lastGestureAt = 0;
    let lastDeepScanAt = 0;
    let menuIds = [];
    let redgifsToken = '';
    let redgifsTokenAt = 0;

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
            redgifs: typeof saved.redgifs === 'boolean' ? saved.redgifs : DEFAULTS.redgifs,
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
        for (const embed of document.querySelectorAll(EMBED_SELECTOR)) {
            for (const video of deepQueryAll(embed, 'video')) {
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
            owned: video.dataset.rfuOwned === '1',
            layer: 0,
            guardUntil: 0,
            overrideAt: 0,
            button: null,
            buttonMisses: 0,
            userPaused: false,
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

    /* ---------------- redgifs 嵌入接管 ---------------- */
    // Reddit 的 redgifs 帖子用 <shreddit-embed> 里的跨域 iframe 播放，父页面无法访问。
    // 这里用 redgifs 官方 API 取 mp4 直链，替换成自己的 <video>，才能控制静音。

    function findEmbedIframe(embed) {
        for (const iframe of deepQueryAll(embed, 'iframe', 3)) {
            return iframe;
        }
        return null;
    }

    function parseRedgifsId(src) {
        const match = REDGIFS_SRC_RE.exec(src || '');
        return match ? match[1] : '';
    }

    function gmRequest(url, headers) {
        return new Promise((resolve) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: headers || {},
                    timeout: 15000,
                    onload: (response) => resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        text: response.responseText || '',
                        reason: '',
                    }),
                    onerror: () => resolve({ ok: false, status: 0, text: '', reason: '网络错误' }),
                    ontimeout: () => resolve({ ok: false, status: 0, text: '', reason: '请求超时' }),
                });
                return;
            }
            fetch(url, { headers: headers || {} })
                .then(async (response) => resolve({
                    ok: response.ok,
                    status: response.status,
                    text: await response.text(),
                    reason: '',
                }))
                .catch(() => resolve({ ok: false, status: 0, text: '', reason: 'fetch 被跨域拦截（GM_xmlhttpRequest 不可用）' }));
        });
    }

    async function getRedgifsToken(force) {
        if (!force && redgifsToken && Date.now() - redgifsTokenAt < TOKEN_TTL_MS) {
            return redgifsToken;
        }
        const response = await gmRequest('https://api.redgifs.com/v2/auth/temporary');
        if (!response.ok) {
            throw new Error(`token 接口 ${response.status || response.reason}`);
        }
        const data = JSON.parse(response.text);
        if (!data || !data.token) {
            throw new Error('token 字段缺失');
        }
        redgifsToken = data.token;
        redgifsTokenAt = Date.now();
        return redgifsToken;
    }

    async function getGifUrls(id) {
        if (gifUrlCache.has(id)) {
            return { ok: true, urls: gifUrlCache.get(id) };
        }
        let reason = '';
        // 第一次常规请求；失败则换 token 并补上 Referer 再试一次
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const token = await getRedgifsToken(attempt > 0);
                const headers = { Authorization: `Bearer ${token}` };
                if (attempt > 0) {
                    headers.Referer = 'https://www.redgifs.com/';
                    headers.Origin = 'https://www.redgifs.com';
                }
                const response = await gmRequest(`https://api.redgifs.com/v2/gifs/${id}`, headers);
                if (!response.ok) {
                    reason = `接口 ${response.status || response.reason}`;
                    continue;
                }
                const data = JSON.parse(response.text);
                // 接口实际结构是 { gif: { urls: { hd, sd } }, user, niches }
                const gif = data && (data.gif || data);
                const rawUrls = gif && gif.urls ? gif.urls : null;
                const urls = rawUrls ? { hd: rawUrls.hd || '', sd: rawUrls.sd || '' } : null;
                if (!urls || (!urls.hd && !urls.sd)) {
                    const fields = data ? Object.keys(data).join(',') : '无';
                    reason = `接口未返回直链（顶层字段：${fields}）`;
                    continue;
                }
                gifUrlCache.set(id, urls);
                return { ok: true, urls };
            } catch (error) {
                reason = error && error.message ? error.message : String(error);
            }
        }
        return { ok: false, reason: reason || '未知原因' };
    }

    function activateNearbyEmbeds() {
        if (!config.redgifs) {
            return;
        }
        // 清理已被 Reddit 移除的嵌入（SPA 切换会丢弃旧节点）
        for (const [embed, entry] of embedRecords) {
            if (!embed.isConnected) {
                if (entry.video && entry.video.isConnected) {
                    entry.video.remove();
                }
                embedRecords.delete(embed);
            }
        }
        const viewportHeight = window.innerHeight;
        for (const embed of document.querySelectorAll(EMBED_SELECTOR)) {
            if (embedRecords.has(embed)) {
                continue;
            }
            const rect = embed.getBoundingClientRect();
            if (rect.bottom < -viewportHeight || rect.top > viewportHeight * 2) {
                continue;
            }
            startEmbed(embed);
        }
    }

    function startEmbed(embed) {
        const iframe = findEmbedIframe(embed);
        if (!iframe) {
            return;
        }
        const id = parseRedgifsId(iframe.src);
        if (!id) {
            embedRecords.set(embed, { state: 'skipped' });
            return;
        }
        const entry = { state: 'loading', iframe, id, video: null, reason: '' };
        embedRecords.set(embed, entry);
        getGifUrls(id).then((result) => {
            if (!result.ok) {
                failEmbed(entry, `取直链失败：${result.reason}`);
                return;
            }
            if (!embed.isConnected || !iframe.isConnected) {
                failEmbed(entry, '节点已被移除');
                return;
            }
            mountVideo(embed, iframe, result.urls, entry);
        });
    }

    function failEmbed(entry, reason) {
        entry.state = 'failed';
        entry.reason = reason;
        embedFailures.unshift(`${entry.id}：${reason}`);
        if (embedFailures.length > 5) {
            embedFailures.length = 5;
        }
        console.warn(`${LOG_PREFIX} redgifs 接管失败 — ${entry.id}：${reason}`);
    }

    function mountVideo(embed, iframe, urls, entry) {
        const container = iframe.parentElement;
        if (!container) {
            entry.state = 'failed';
            return;
        }
        const width = container.clientWidth || 0;
        const source = width >= 640 && urls.hd ? urls.hd : (urls.sd || urls.hd);

        const video = document.createElement('video');
        video.dataset.rfuOwned = '1';
        video.src = source;
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'metadata';
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block;z-index:1;';

        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        video.addEventListener('error', () => {
            // 直链失败先换另一个源重试一次，仍失败则还原原始 iframe
            const alternate = video.src === urls.hd ? urls.sd : urls.hd;
            if (!entry.triedAlternate && alternate) {
                entry.triedAlternate = true;
                video.src = alternate;
                video.play().catch(() => {});
                return;
            }
            restoreEmbed(embed);
            failEmbed(entry, '视频加载失败（可能防盗链）');
        });
        video.addEventListener('canplay', () => {
            iframe.style.visibility = 'hidden';
            iframe.style.pointerEvents = 'none';
        }, { once: true });
        video.addEventListener('click', () => {
            const record = records.get(video);
            if (video.paused) {
                video.play().catch(() => {});
                if (record) {
                    record.userPaused = false;
                }
            } else {
                video.pause();
                if (record) {
                    record.userPaused = true;
                }
            }
        });

        container.appendChild(video);
        entry.video = video;
        entry.state = 'done';
        video.play().catch(() => {});
        scheduleScan();
    }

    function restoreEmbed(embed) {
        const entry = embedRecords.get(embed);
        if (!entry) {
            return;
        }
        if (entry.video && entry.video.isConnected) {
            entry.video.remove();
        }
        if (entry.iframe && entry.iframe.isConnected) {
            entry.iframe.style.visibility = '';
            entry.iframe.style.pointerEvents = '';
        }
        embedRecords.delete(embed);
    }

    function restoreAllEmbeds() {
        for (const embed of [...embedRecords.keys()]) {
            restoreEmbed(embed);
        }
    }

    function maintainOwnedPlayback() {
        if (!config.redgifs) {
            return;
        }
        const viewportHeight = window.innerHeight;
        for (const record of records.values()) {
            if (!record.owned) {
                continue;
            }
            const rect = record.video.getBoundingClientRect();
            const farAway = rect.bottom < -viewportHeight || rect.top > viewportHeight * 2;
            if (farAway) {
                if (!record.video.paused) {
                    record.video.pause();
                }
            } else if (record.video.paused && !record.userPaused) {
                record.video.play().catch(() => {});
            }
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
        activateNearbyEmbeds();
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

    function showDiagnosticsPanel(text) {
        let host = document.getElementById(PANEL_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = PANEL_HOST_ID;
            host.attachShadow({ mode: 'open' });
            document.documentElement.appendChild(host);
        }

        const shadow = host.shadowRoot;
        shadow.innerHTML = `
            <style>
                :host { all: initial; color-scheme: dark; }
                .overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 2147483647;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    box-sizing: border-box;
                    background: rgba(0, 0, 0, 0.55);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                }
                .card {
                    width: min(620px, 100%);
                    max-height: 76vh;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    padding: 18px;
                    border: 1px solid #33363a;
                    border-radius: 10px;
                    background: #1b1d20;
                    color: #e8eaed;
                    box-shadow: 0 18px 55px rgba(0, 0, 0, 0.5);
                }
                h2 {
                    margin: 0 0 12px;
                    font-size: 15px;
                    font-weight: 650;
                }
                pre {
                    flex: 1;
                    min-height: 80px;
                    margin: 0;
                    padding: 12px;
                    overflow: auto;
                    border: 1px solid #33363a;
                    border-radius: 7px;
                    background: #121417;
                    color: #d6dae0;
                    font: 12.5px/1.6 ui-monospace, Consolas, "Courier New", monospace;
                    white-space: pre-wrap;
                    word-break: break-all;
                    user-select: text;
                }
                .actions {
                    display: flex;
                    gap: 10px;
                    margin-top: 14px;
                }
                button {
                    flex: 1;
                    min-height: 36px;
                    border: 1px solid #3c4045;
                    border-radius: 7px;
                    background: #26292d;
                    color: #e8eaed;
                    font: inherit;
                    font-size: 13.5px;
                    cursor: pointer;
                }
                button:hover { background: #32363b; }
                button.primary { border-color: #ff4500; background: #ff4500; color: #fff; }
                button.primary:hover { background: #e03d00; }
            </style>
            <div class="overlay">
                <section class="card">
                    <h2>Reddit 视频焦点发声 · 诊断</h2>
                    <pre></pre>
                    <div class="actions">
                        <button class="primary" type="button" data-action="copy">复制全部</button>
                        <button type="button" data-action="close">关闭</button>
                    </div>
                </section>
            </div>
        `;

        shadow.querySelector('pre').textContent = text;

        const overlay = shadow.querySelector('.overlay');
        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) {
                host.remove();
            }
        });
        shadow.querySelector('[data-action="close"]').addEventListener('click', () => host.remove());
        shadow.querySelector('[data-action="copy"]').addEventListener('click', () => {
            copyText(text);
        });
    }

    function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            try {
                GM_setClipboard(text);
                showToast('诊断信息已复制');
                return;
            } catch (error) {
                // 落到下面的兜底
            }
        }
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }
        area.remove();
        showToast(ok ? '诊断信息已复制' : '复制失败，请手动选中文本复制');
    }

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

    function toggleRedgifs() {
        config.redgifs = !config.redgifs;
        saveConfig();
        refreshMenus();
        if (config.redgifs) {
            showToast('redgifs 接管已开启');
            scheduleEvaluate(0);
        } else {
            restoreAllEmbeds();
            showToast('redgifs 接管已关闭，已还原原始嵌入');
        }
    }

    async function testRedgifsApi() {
        let id = '';
        for (const embed of document.querySelectorAll(EMBED_SELECTOR)) {
            const iframe = findEmbedIframe(embed);
            const parsed = iframe ? parseRedgifsId(iframe.src) : '';
            if (parsed) {
                id = parsed;
                break;
            }
        }
        if (!id) {
            showToast('当前页面没找到 redgifs 嵌入');
            return;
        }
        showToast(`正在测试接口：${id}`);
        const result = await getGifUrls(id);
        if (result.ok) {
            console.log(`${LOG_PREFIX} 接口正常`, result.urls);
            showToast('接口正常，已拿到直链');
        } else {
            console.warn(`${LOG_PREFIX} 接口失败：${result.reason}`);
            showToast(`接口失败：${result.reason}`);
        }
    }

    function dumpDiagnostics() {
        scanVideos();
        const lines = [];
        lines.push(`${LOG_PREFIX} 视频=${records.size} 当前焦点=${activeVideo ? '有' : '无'} 开关=${config.enabled ? '开' : '关'} 阈值=${Math.round(config.minRatio * 100)}% 延迟=${config.settleMs}ms`);
        const embedDone = [...embedRecords.values()].filter((entry) => entry.state === 'done').length;
        const embedFailed = [...embedRecords.values()].filter((entry) => entry.state === 'failed').length;
        lines.push(`  redgifs: 接管=${config.redgifs ? '开' : '关'} 已替换=${embedDone} 失败=${embedFailed}`);
        if (embedFailures.length) {
            lines.push(`  失败原因: ${embedFailures.slice(0, 3).join(' / ')}`);
        }
        lines.push(`  GM_xmlhttpRequest=${typeof GM_xmlhttpRequest === 'function' ? '可用' : '不可用（会走 fetch，可能被跨域拦截）'}`);
        for (const record of records.values()) {
            const metrics = measure(record);
            lines.push([
                `  ${record.owned ? 'redgifs替换' : (record.player ? record.player.tagName.toLowerCase() : '独立video')}`,
                `muted=${record.video.muted}`,
                `paused=${record.video.paused}`,
                `可见=${metrics ? Math.round(metrics.ratio * 100) + '%' : '-'}`,
                `层级=${record.layer}`,
                `手动=${record.overrideAt ? '是' : '否'}`,
                `焦点=${record.video === activeVideo ? '是' : '否'}`,
            ].join(' '));
        }
        if (records.size === 0) {
            lines.push('  未发现可控制的视频（若帖子是 redgifs 嵌入，请确认“redgifs 接管”已开启并已滚动到该帖子）');
        }
        const text = lines.join('\n');
        console.log(text);
        showDiagnosticsPanel(text);
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
        register(`🎬 redgifs 接管：${config.redgifs ? '已开启' : '已关闭'}（点击切换）`, toggleRedgifs);
        register('🧪 测试 redgifs 接口', testRedgifsApi);
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
                maintainOwnedPlayback();
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
