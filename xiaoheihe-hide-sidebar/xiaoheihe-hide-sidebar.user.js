// ==UserScript==
// @name         9527小黑盒帖子页加宽
// @namespace    https://github.com/Godwin9527
// @version      1.0.0
// @description  隐藏小黑盒帖子页右侧「热门社区 / 相关资讯」整列,帖子正文自动铺满窗口宽度,无需手动设置数值
// @author       Godwin9527
// @run-at       document-start
// @match        *://www.xiaoheihe.cn/*
// @match        *://xiaoheihe.cn/*
// @icon         https://www.xiaoheihe.cn/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/xiaoheihe-hide-sidebar/xiaoheihe-hide-sidebar.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/xiaoheihe-hide-sidebar/xiaoheihe-hide-sidebar.meta.js
// ==/UserScript==

// 说明:
// 1. 帖子页布局是横向 flex 两列: 左列 .list(flex:1) 是正文, 右列 .cpt-right-side(固定 356px) 是热门社区/相关资讯。
//    右列固定宽度、左列弹性宽度, 所以只要把右列 display:none, 正文会自动吃掉腾出来的空间, 不需要手写左列宽度。
// 2. 外层 #page-bbs-link 把总宽度锁死在 1032px, main 又锁死在 1300px, 两处都要解除, 正文才能真正跟着窗口走。
// 3. 超宽屏(>1600px)下正文会拉得过开、长行难读, 所以留了 MAX_WIDTH 上限并居中; 普通窗口下正文始终铺满, 用不到这个值。

(() => {
    'use strict';

    /* ==================== 可调参数 ==================== */
    // 正文最大宽度上限(px)。只影响超宽屏, 普通窗口下正文始终铺满可用宽度。
    const MAX_WIDTH = 1600;
    // 默认是否开启
    const DEFAULT_ENABLED = true;
    /* ================================================= */

    const ROOT_CLASS = 'xhh-wide';
    const STYLE_ID = 'xhh-wide-style';
    const STORAGE_KEY = 'xiaoheihe-hide-sidebar';

    const CSS = `
        /* 1. 隐藏右侧整列(热门社区 / 相关资讯 / 侧边推广) */
        html.${ROOT_CLASS} #page-bbs-link [class*="cpt-right-side"] {
            display: none !important;
        }

        /* 2. 外层 main 原本锁死 1300px, 解除后才能跟着窗口变化 */
        html.${ROOT_CLASS} main:has(#page-bbs-link) {
            max-width: none !important;
            width: 100% !important;
        }

        /* 3. 帖子容器原本锁死 1032px, 改为铺满可用宽度并居中 */
        html.${ROOT_CLASS} #page-bbs-link {
            width: 100% !important;
            max-width: ${MAX_WIDTH}px !important;
            margin-left: auto !important;
            margin-right: auto !important;
        }

        /* 4. 左列吃掉腾出来的空间 */
        html.${ROOT_CLASS} #page-bbs-link > .content > .list {
            max-width: none !important;
        }

        /* 5. 正文图片跟随新宽度, 避免固定宽度把页面撑出横向滚动条 */
        html.${ROOT_CLASS} #page-bbs-link .hb-bbs-link img {
            max-width: 100% !important;
            height: auto !important;
        }
    `;

    let enabled = readEnabled();
    let menuCommandId = null;
    let menuRegistered = false;

    function readEnabled() {
        try {
            const stored = GM_getValue(STORAGE_KEY, null);
            if (stored === null) {
                return DEFAULT_ENABLED;
            }
            return Boolean(stored);
        } catch (error) {
            return DEFAULT_ENABLED;
        }
    }

    function saveEnabled(value) {
        try {
            GM_setValue(STORAGE_KEY, value);
        } catch (error) {
            console.warn('[小黑盒加宽] 保存设置失败:', error);
        }
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function apply() {
        injectStyle();
        document.documentElement.classList.toggle(ROOT_CLASS, enabled);
    }

    function showToast(message) {
        if (!document.body) {
            return;
        }
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = [
            'position:fixed',
            'left:50%',
            'bottom:48px',
            'transform:translateX(-50%)',
            'padding:8px 16px',
            'border-radius:8px',
            'font-size:13px',
            'line-height:1.4',
            'color:#fff',
            'background:rgba(20,20,24,0.92)',
            'z-index:2147483647',
            'pointer-events:none',
            'transition:opacity 0.3s ease',
            'font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif',
        ].join(';');
        document.body.appendChild(toast);
        window.setTimeout(() => {
            toast.style.opacity = '0';
        }, 1200);
        window.setTimeout(() => {
            toast.remove();
        }, 1600);
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
                console.warn('[小黑盒加宽] 移除菜单命令失败:', error);
            }
        }
        menuCommandId = GM_registerMenuCommand(
            enabled ? '隐藏右侧栏:已开启(点击关闭)' : '隐藏右侧栏:已关闭(点击开启)',
            () => setEnabled(!enabled),
        );
        menuRegistered = true;
    }

    function setEnabled(value) {
        enabled = value;
        saveEnabled(value);
        apply();
        refreshMenuCommand();
        showToast(value ? '右侧栏已隐藏 · 正文铺满宽度' : '已恢复原版布局');
    }

    apply();
    refreshMenuCommand();

    // 页面框架重建 head 时兜底重挂样式
    const observer = new MutationObserver(() => injectStyle());
    observer.observe(document.documentElement, { childList: true });
})();
