// ==UserScript==
// @name         9527Reddit视频焦点发声
// @namespace    https://github.com/Godwin9527
// @version      2.0.0
// @description  滚动到视口中央的那个视频自动取消静音(走站点自带的静音开关),滚走的视频恢复静音,整页始终只有一个视频发声
// @author       Godwin9527
// @run-at       document-idle
// @match        *://www.reddit.com/*
// @match        *://sh.reddit.com/*
// @match        *://www.redgifs.com/ifr/*
// @match        *://redgifs.com/ifr/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-focus-unmute/reddit-focus-unmute.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/reddit-focus-unmute/reddit-focus-unmute.meta.js
// ==/UserScript==

// 说明:
// 1. Reddit 帖子里的视频有两种:Reddit 原生播放器(shreddit-player)和跨域嵌入的 RedGIFs iframe(shreddit-embed)。
//    跨域 iframe 内部无法从父页面访问,所以同一个脚本会在 iframe 里再跑一份,两端用 postMessage 通信。
// 2. 取消静音一律通过站点自带的静音开关(原生播放器的 button.mute-button、RedGIFs 的 button.SoundButton),
//    不直接改音量,避免和其它音量类扩展互相打架。
// 3. 浏览器策略只允许给"已经在静音自动播放中"的媒体取消静音,所以焦点视频尚未播放时会先等它播放再取消静音。

(() => {
    'use strict';

    /* ==================== 可调参数 ==================== */

    // 焦点判定:视口内露出比例达标、且离视口中心最近的视频才算焦点视频
    const FOCUS_MIN_RATIO = 0.5;
    const FOCUS_MIN_PIXELS = 140;
    // 焦点稳定这么久之后才真正切换,避免滚动过程中来回抖动
    const COMMIT_DELAY_MS = 220;
    const SCROLL_THROTTLE_MS = 80;
    const RESCAN_DEBOUNCE_MS = 250;
    // 懒加载的嵌入帧需要轮询补扫
    const IDLE_RESCAN_MS = 1200;
    // 焦点视频被站点重新静音时,最多隔这么久重新争取一次发声
    const REASSERT_MS = 1000;
    const VERIFY_DELAY_MS = 320;
    const VERIFY_ATTEMPTS = 2;
    const MAX_RESEND = 3;
    const TOAST_MS = 2600;

    // 嵌入帧(RedGIFs)侧参数
    const FRAME_WAIT_PLAYING_MS = 4000;
    const FRAME_RETRY_MS = 260;
    const FRAME_VERIFY_ATTEMPTS = 2;

    const MESSAGE_SOURCE = '9527-reddit-focus-unmute';
    const STORAGE_KEY = 'reddit-focus-unmute-enabled';
    const STORAGE_PREFIX = '9527-reddit-focus-unmute:';
    const TOAST_HOST_ID = 'reddit-focus-unmute-toast';

    if (window.top === window.self) {
        initPageRole();
    } else if (/^\/ifr\//.test(window.location.pathname)) {
        initEmbedRole();
    }

    /* ==================== 通用工具 ==================== */

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
        }, TOAST_MS);
    }

    /* ==================== 顶层页面(Reddit) ==================== */

    function initPageRole() {
        let enabled = loadEnabled();
        let entries = [];
        let focused = null;
        let pendingTarget = null;
        let commitTimer = 0;
        let evalTimer = 0;
        let rescanTimer = 0;
        let lastEvalAt = 0;
        let lastAssertAt = 0;
        let menuRegistered = false;
        let menuCommandId = null;
        // 帧是懒加载/可能重建的,帧状态按 iframe 元素记,避免条目重建时被冲掉
        const announcedFrames = new WeakSet();
        const frameResend = new WeakMap();

        function loadEnabled() {
            let value = null;
            try {
                value = storageGet(STORAGE_KEY, true);
            } catch (error) {
                console.warn('[Reddit焦点发声] 读取设置失败:', error);
            }
            return value !== false;
        }

        /* ---------- 收集可控制的视频 ---------- */

        function collectVideos(root, acc) {
            if (!root) {
                return acc;
            }
            for (const video of root.querySelectorAll('video')) {
                acc.push(video);
            }
            for (const element of root.querySelectorAll('*')) {
                if (element.shadowRoot) {
                    collectVideos(element.shadowRoot, acc);
                }
            }
            return acc;
        }

        function collectEntries() {
            const next = [];

            // Reddit 原生播放器:只处理带站点音量开关的(静音 GIF 没有该按钮,直接忽略)
            for (const player of document.querySelectorAll('shreddit-player')) {
                const mediaUi = player.shadowRoot && player.shadowRoot.querySelector('shreddit-media-ui');
                const muteButton = mediaUi && mediaUi.shadowRoot && mediaUi.shadowRoot.querySelector('button.mute-button');
                if (!muteButton) {
                    continue;
                }
                next.push({
                    kind: 'native',
                    target: player,
                    mediaUi,
                    muteButton,
                    videos: collectVideos(player.shadowRoot, []),
                    waitingPlaying: false,
                });
            }

            // 跨域嵌入(RedGIFs 等):交给帧内脚本处理,帧自报家门之后才算可控
            for (const embed of document.querySelectorAll('shreddit-embed')) {
                const iframe = embed.shadowRoot && embed.shadowRoot.querySelector('iframe');
                if (!iframe || !iframe.src) {
                    continue;
                }
                next.push({ kind: 'frame', target: iframe, iframe });
            }

            return next;
        }

        function rescan() {
            const previous = entries;
            const next = collectEntries();
            const changed = next.length !== previous.length
                || next.some((entry, index) => entry.target !== previous[index].target);
            entries = next;

            if (focused) {
                focused = entries.find((entry) => entry.target === focused.target) || null;
            }

            if (changed) {
                scheduleEval();
            }
        }

        /* ---------- 焦点判定 ---------- */

        function scheduleEval() {
            const wait = Math.max(0, SCROLL_THROTTLE_MS - (Date.now() - lastEvalAt));
            window.clearTimeout(evalTimer);
            evalTimer = window.setTimeout(() => {
                evalTimer = 0;
                lastEvalAt = Date.now();
                evaluate();
            }, wait);
        }

        function evaluate() {
            if (!enabled) {
                return;
            }

            const viewportHeight = window.innerHeight;
            const centerY = viewportHeight / 2;
            let best = null;
            let bestScore = Infinity;

            for (const entry of entries) {
                // 还没就绪的嵌入帧不参与判定,免得把正在发声的视频静掉却没接上
                if (entry.kind === 'frame' && !announcedFrames.has(entry.iframe)) {
                    continue;
                }
                const rect = entryRect(entry);
                if (rect.width <= 0 || rect.height <= 0) {
                    continue;
                }
                const visibleTop = Math.max(rect.top, 0);
                const visibleBottom = Math.min(rect.bottom, viewportHeight);
                const visibleHeight = visibleBottom - visibleTop;
                if (visibleHeight < FOCUS_MIN_PIXELS) {
                    continue;
                }
                if (visibleHeight / Math.min(rect.height, viewportHeight) < FOCUS_MIN_RATIO) {
                    continue;
                }
                const score = Math.abs((visibleTop + visibleBottom) / 2 - centerY);
                if (score < bestScore) {
                    bestScore = score;
                    best = entry;
                }
            }

            setCandidate(best);
        }

        // 优先用宿主元素的位置;宿主没有尺寸时(媒体被绝对定位撑开)退回媒体元素本身
        function entryRect(entry) {
            const rect = entry.target.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return rect;
            }
            const media = entry.kind === 'frame' ? entry.iframe : nativeVideos(entry)[0];
            return media ? media.getBoundingClientRect() : rect;
        }

        function setCandidate(candidate) {
            const target = candidate ? candidate.target : null;

            // 焦点没变:顺手把被站点重新静音的焦点视频再点亮一次
            if (target && focused && target === focused.target) {
                window.clearTimeout(commitTimer);
                commitTimer = 0;
                pendingTarget = target;
                if (Date.now() - lastAssertAt >= REASSERT_MS) {
                    lastAssertAt = Date.now();
                    applyEntry(focused, true);
                }
                return;
            }

            if (pendingTarget === target) {
                return;
            }

            pendingTarget = target;
            window.clearTimeout(commitTimer);
            commitTimer = window.setTimeout(() => {
                commitTimer = 0;
                commit(pendingTarget);
            }, COMMIT_DELAY_MS);
        }

        function commit(target) {
            const next = target ? entries.find((entry) => entry.target === target) || null : null;

            if (focused && next && next.target === focused.target) {
                focused = next;
                lastAssertAt = Date.now();
                applyEntry(next, true);
                return;
            }

            if (focused) {
                applyEntry(focused, false);
            }

            focused = next;

            if (focused) {
                if (focused.kind === 'frame') {
                    frameResend.set(focused.iframe, 0);
                }
                lastAssertAt = Date.now();
                applyEntry(focused, true);
            }
        }

        /* ---------- 应用静音状态 ---------- */

        function applyEntry(entry, wantUnmuted) {
            if (!entry) {
                return;
            }
            if (entry.kind === 'native') {
                applyNative(entry, wantUnmuted);
            } else {
                postToFrame(entry, wantUnmuted);
            }
        }

        function nativeVideos(entry) {
            const alive = entry.videos.filter((video) => video.isConnected);
            if (alive.length) {
                entry.videos = alive;
                return alive;
            }
            const fresh = collectVideos(entry.target.shadowRoot, []);
            entry.videos = fresh;
            return fresh;
        }

        // 以站点自身状态为准:shreddit-media-ui 上的 muted 属性就是它的静音开关状态
        function isNativeMuted(entry) {
            if (entry.mediaUi.hasAttribute('muted')) {
                return true;
            }
            const playing = nativeVideos(entry).filter((video) => !video.paused);
            if (playing.length && playing.every((video) => video.muted)) {
                return true;
            }
            return false;
        }

        function isNativePlaying(entry) {
            return nativeVideos(entry).some((video) => !video.paused && video.readyState >= 2);
        }

        function applyNative(entry, wantUnmuted) {
            if (!entry.muteButton.isConnected) {
                return;
            }
            const wantMuted = !wantUnmuted;
            if (isNativeMuted(entry) === wantMuted) {
                return;
            }
            // 浏览器策略不允许给未播放的媒体取消静音,等它播起来再说
            if (wantUnmuted && !isNativePlaying(entry)) {
                waitNativePlaying(entry);
                return;
            }
            toggleNativeMute(entry, wantMuted, 0);
        }

        function toggleNativeMute(entry, wantMuted, attempt) {
            if (!enabled || !entry.muteButton.isConnected) {
                return;
            }
            entry.muteButton.click();
            window.setTimeout(() => {
                if (!enabled) {
                    return;
                }
                if (isNativeMuted(entry) === wantMuted) {
                    return;
                }
                if (attempt < VERIFY_ATTEMPTS) {
                    toggleNativeMute(entry, wantMuted, attempt + 1);
                    return;
                }
                // 兜底:站点没有同步时直接改媒体元素
                for (const video of nativeVideos(entry)) {
                    video.muted = wantMuted;
                    if (!wantMuted) {
                        const played = video.play();
                        if (played && played.catch) {
                            played.catch(() => {});
                        }
                    }
                }
            }, VERIFY_DELAY_MS);
        }

        function waitNativePlaying(entry) {
            if (entry.waitingPlaying) {
                return;
            }
            entry.waitingPlaying = true;
            const timer = window.setTimeout(() => {
                entry.waitingPlaying = false;
            }, FRAME_WAIT_PLAYING_MS);
            const onPlaying = () => {
                entry.waitingPlaying = false;
                window.clearTimeout(timer);
                if (enabled && focused && focused.target === entry.target) {
                    applyNative(entry, true);
                }
            };
            for (const video of nativeVideos(entry)) {
                video.addEventListener('playing', onPlaying, { once: true });
            }
        }

        function postToFrame(entry, wantUnmuted) {
            const target = entry.iframe && entry.iframe.contentWindow;
            if (!target || !announcedFrames.has(entry.iframe)) {
                return;
            }
            try {
                target.postMessage({ source: MESSAGE_SOURCE, type: 'focus', focused: !!wantUnmuted }, '*');
            } catch (error) {
                console.warn('[Reddit焦点发声] 通知嵌入帧失败:', error);
            }
        }

        /* ---------- 与嵌入帧通信 ---------- */

        function onMessage(event) {
            const data = event.data;
            if (!data || data.source !== MESSAGE_SOURCE) {
                return;
            }
            const entry = entries.find((item) => item.kind === 'frame' && item.iframe.contentWindow === event.source);
            if (!entry) {
                return;
            }

            if (data.type === 'hello') {
                announcedFrames.add(entry.iframe);
                postToFrame(entry, !!(focused && focused.target === entry.target));
                scheduleEval();
                return;
            }

            if (data.type !== 'ack') {
                return;
            }

            const state = data.state;
            if (!state || !focused || focused.target !== entry.target) {
                return;
            }
            if (state.hasControl === false || state.paused || !state.muted) {
                return;
            }
            const resend = frameResend.get(entry.iframe) || 0;
            if (resend >= MAX_RESEND) {
                return;
            }
            frameResend.set(entry.iframe, resend + 1);
            window.setTimeout(() => {
                if (enabled && focused && focused.target === entry.target) {
                    postToFrame(entry, true);
                }
            }, VERIFY_DELAY_MS);
        }

        /* ---------- 开关与启动 ---------- */

        function setEnabled(value) {
            enabled = value !== false;
            try {
                storageSet(STORAGE_KEY, enabled);
            } catch (error) {
                console.warn('[Reddit焦点发声] 保存设置失败:', error);
                showToast('设置保存失败,请检查脚本管理器权限。', 'error');
            }
            refreshMenuCommand();

            if (enabled) {
                scheduleEval();
                showToast('Reddit 视频焦点发声:已开启');
            } else {
                muteEverything();
                showToast('Reddit 视频焦点发声:已关闭,所有视频恢复静音');
            }
        }

        function muteEverything() {
            pendingTarget = null;
            window.clearTimeout(commitTimer);
            commitTimer = 0;
            for (const entry of entries) {
                applyEntry(entry, false);
            }
            focused = null;
        }

        function refreshMenuCommand() {
            if (typeof GM_registerMenuCommand !== 'function') {
                return;
            }
            if (menuRegistered) {
                // 不支持注销的脚本管理器只注册一次,避免出现重复的菜单项
                if (typeof GM_unregisterMenuCommand !== 'function') {
                    return;
                }
                try {
                    GM_unregisterMenuCommand(menuCommandId);
                } catch (error) {
                    console.warn('[Reddit焦点发声] 移除菜单命令失败:', error);
                }
            }
            menuCommandId = GM_registerMenuCommand(
                enabled ? '视频焦点发声:已开启(点击关闭)' : '视频焦点发声:已关闭(点击开启)',
                () => setEnabled(!enabled),
            );
            menuRegistered = true;
        }

        function start() {
            rescan();
            refreshMenuCommand();

            window.addEventListener('scroll', scheduleEval, { passive: true });
            window.addEventListener('resize', scheduleEval);
            document.addEventListener('scroll', scheduleEval, { passive: true, capture: true });
            window.addEventListener('message', onMessage);

            const observer = new MutationObserver(() => {
                window.clearTimeout(rescanTimer);
                rescanTimer = window.setTimeout(rescan, RESCAN_DEBOUNCE_MS);
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });

            // 嵌入帧是懒加载的,shadow root 内的变化不会被上面的 MutationObserver 看到,这里轮询补扫
            window.setInterval(() => {
                const before = entries;
                rescan();
                const changed = entries.length !== before.length
                    || entries.some((entry, index) => entry.target !== before[index].target);
                if (changed) {
                    return;
                }
                if (enabled) {
                    evaluate();
                }
            }, IDLE_RESCAN_MS);
        }

        start();
    }

    /* ==================== 嵌入帧(RedGIFs) ==================== */

    function initEmbedRole() {
        let want = null;
        let waitTimer = 0;
        let retryTimer = 0;

        function findVideo() {
            return document.querySelector('video');
        }

        function findSoundButton() {
            const direct = document.querySelector('button.SoundButton');
            if (direct) {
                return direct;
            }
            for (const button of document.querySelectorAll('button')) {
                const label = (button.getAttribute('aria-label') || '').trim();
                const className = typeof button.className === 'string' ? button.className : '';
                if (/^(sound|mute|unmute)/i.test(label) || /soundbutton/i.test(className)) {
                    return button;
                }
            }
            return null;
        }

        function readState() {
            const video = findVideo();
            const hasControl = !!findSoundButton();
            if (!video) {
                return { hasControl, muted: null, paused: true };
            }
            return { hasControl, muted: !!video.muted, paused: !!video.paused };
        }

        function report(type) {
            try {
                window.parent.postMessage({ source: MESSAGE_SOURCE, type, state: readState() }, '*');
            } catch (error) {
                console.warn('[Reddit焦点发声] 回报父页面失败:', error);
            }
        }

        function apply(force) {
            const video = findVideo();
            if (!video) {
                return;
            }

            const desiredMuted = want !== true;
            if (video.muted === desiredMuted) {
                return;
            }
            // 浏览器策略不允许给未播放的媒体取消静音,等它播起来再说
            if (!desiredMuted && video.paused && !force) {
                waitForPlaying();
                return;
            }

            const button = findSoundButton();
            if (button) {
                button.click();
            }

            if (video.muted === desiredMuted) {
                if (!desiredMuted) {
                    const played = video.play();
                    if (played && played.catch) {
                        played.catch(() => {});
                    }
                }
                return;
            }

            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => verify(desiredMuted, 0), FRAME_RETRY_MS);
        }

        function verify(desiredMuted, attempt) {
            const video = findVideo();
            if (!video) {
                return;
            }
            if (video.muted === desiredMuted) {
                report('ack');
                return;
            }
            if (attempt < FRAME_VERIFY_ATTEMPTS) {
                const button = findSoundButton();
                if (button) {
                    button.click();
                }
                retryTimer = window.setTimeout(() => verify(desiredMuted, attempt + 1), FRAME_RETRY_MS);
                return;
            }
            // 兜底:站点没有同步时直接改媒体元素
            video.muted = desiredMuted;
            if (!desiredMuted) {
                const played = video.play();
                if (played && played.catch) {
                    played.catch(() => {});
                }
            }
            report('ack');
        }

        function waitForPlaying() {
            if (waitTimer) {
                return;
            }
            const video = findVideo();
            if (!video) {
                return;
            }
            const onPlaying = () => {
                window.clearTimeout(waitTimer);
                waitTimer = 0;
                apply(true);
            };
            video.addEventListener('playing', onPlaying, { once: true });
            waitTimer = window.setTimeout(() => {
                waitTimer = 0;
                video.removeEventListener('playing', onPlaying);
                report('ack');
            }, FRAME_WAIT_PLAYING_MS);
        }

        function onMessage(event) {
            if (event.source !== window.parent) {
                return;
            }
            const data = event.data;
            if (!data || data.source !== MESSAGE_SOURCE || data.type !== 'focus') {
                return;
            }
            want = data.focused === true;
            apply(false);
            report('ack');
        }

        window.addEventListener('message', onMessage);

        function announce() {
            report('hello');
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => window.setTimeout(announce, 200), { once: true });
        } else {
            window.setTimeout(announce, 200);
        }

        // RedGIFs 是单页应用,视频元素可能后到;定期确认焦点状态
        window.setInterval(() => {
            if (want !== null) {
                apply(false);
            }
        }, IDLE_RESCAN_MS);
    }
})();
