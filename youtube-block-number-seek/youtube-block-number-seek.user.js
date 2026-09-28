// ==UserScript==
// @name         9527YouTube数字键拦截
// @namespace    https://github.com/Godwin9527
// @version      1.0.0
// @description  在 YouTube 拦截数字键（小键盘 0-9 与主键盘 0-9），禁用其自带的“按数字跳转到百分比位置”快捷键，其他扩展与正常输入不受影响
// @author       Godwin9527
// @run-at       document-start
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        none
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-block-number-seek/youtube-block-number-seek.user.js
// @updateURL https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-block-number-seek/youtube-block-number-seek.meta.js
// ==/UserScript==

(() => {
    'use strict';

    // ==================== 可调配置 ====================

    // 需要拦截的物理键位（KeyboardEvent.code）。
    // 小键盘数字：Numpad0 ~ Numpad9；主键盘数字：Digit0 ~ Digit9。
    // 如不想拦截主键盘（保留 YouTube 原生 0-9 百分比跳转），删除对应 Digit* 行即可；
    // 后续如需拦截其他快捷键（如 KeyK / KeyJ / KeyL），也在此处追加。
    const BLOCK_CODES = new Set([
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

    // 置为 true 后，命中拦截时会在控制台输出日志，便于排查
    const DEBUG = false;

    // ==================== 拦截逻辑 ====================

    // 焦点位于可编辑元素（搜索框、评论框等）时不拦截，保证数字可以正常输入
    function isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }
        if (target.isContentEditable) {
            return true;
        }
        return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    }

    // YouTube 播放器的快捷键监听器挂在 document 上，事件捕获顺序为
    // window → document → … → 目标元素，因此在 window 捕获阶段可以抢在 YouTube 之前处理。
    function onKeyDown(event) {
        // 带修饰键的组合键不拦（如 Ctrl+数字 等交给浏览器或其他扩展处理）
        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }
        if (isEditableTarget(event.target)) {
            return;
        }
        // 物理键位命中，且当前生效字符确实是数字才拦截。
        // NumLock 关闭时小键盘的 event.key 会变成 Insert / Home / End 等编辑键，
        // 此时自动放行，不影响小键盘的编辑功能。
        if (!BLOCK_CODES.has(event.code) || !/^[0-9]$/.test(event.key)) {
            return;
        }
        // stopPropagation 让事件不再向下传播，document 层的 YouTube 监听器收不到该事件；
        // 但同在 window 层的其他监听器（如 Global Speed）仍然正常工作。
        // 刻意不使用 stopImmediatePropagation，避免误杀同层的其他扩展。
        event.stopPropagation();
        // 数字键本身没有浏览器默认行为，preventDefault 仅为保险起见
        event.preventDefault();
        if (DEBUG) {
            console.debug('[9527YouTube数字键拦截] 已拦截', event.code, event.key);
        }
    }

    // YouTube 是单页应用，监听器注册一次即可覆盖站内所有跳转；
    // 元数据不加 @noframes，使其他网站内嵌的 YouTube 播放器（embed iframe）同样生效。
    window.addEventListener('keydown', onKeyDown, true);
})();
