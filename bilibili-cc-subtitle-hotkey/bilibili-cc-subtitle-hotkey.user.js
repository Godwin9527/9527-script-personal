// ==UserScript==
// @name         9527哔哩哔哩CC字幕快捷键
// @namespace    https://github.com/Godwin9527
// @version      2.3.1
// @description  独立于 Bilibili Evolved 的 CC 字幕开关键盘快捷键，直接操作 B 站原生字幕，支持自定义按键、语言偏好、人工字幕优先、进入视频自动关闭字幕
// @author       Godwin9527
// @run-at       document-start
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/list/*
// @match        https://www.bilibili.com/festival/*
// @match        https://www.bilibili.com/medialist/play/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.meta.js
// ==/UserScript==

/**
 * 设计说明
 * ------------------------------------------------------------------
 * 用 B 站自己的 CC 字幕, 不另画字幕层。
 * 面板未渲染时先 hover / 点一次字幕按钮把它唤出来, 再按语言偏好选一项点下去,
 * 点击后回读 close-switch 的状态确认真的生效, 没有就换点击方式重试。
 *
 * 状态判定不能只看开关, 开关标成「关闭」时字幕层也可能还在渲染。所以:
 * - 所有 close-switch 都处于选中态才算开关层面已关
 * - 再叠加字幕渲染层 (.bpx-player-subtitle-wrap) 是否有可见文字
 * - 两者都成立才算真的关
 *
 * 脏状态 (开关说已关、字幕还在渲染) 的修复必须经过语言项:
 * close-switch 在「自动渲染」状态下只改 UI class, 不建立渲染通道,
 * 所以「关 → 开 → 关」连点两次 close 是无效的。正确路径是先点一次语言项
 * (让 UI 真正选中, 字幕 active=true), 再点 close, 才能真正停掉渲染。
 *
 * 关于「默认关闭」: B 站会恢复上次的字幕状态, 常见表现是新进视频 AI 字幕自己就开了。
 * 勾选「进入视频时自动关闭字幕」后, 脚本会为当前视频记住一个意图 (expectOff):
 * 默认是「希望字幕关着」, 只要意图是关, 就常驻看守, 任何时候发现字幕被打开都立刻关掉,
 * 不再受「进入视频后 N 秒」这类时间窗口限制。
 *
 * 用户自己开字幕 (按快捷键, 或真实点击播放器内的字幕开关) 会把意图改成「开」,
 * 本视频内脚本就不再插手; 再按一次快捷键关掉, 意图回到「关」, 看守重新上线。
 *
 * 诊断: 菜单「复制诊断信息到剪贴板」会输出
 * - 基础环境 / 播放器容器 / 全部关闭开关 / 全部语言项 / 全部字幕渲染层
 * - 脚本运行时状态 (意图、看护 token、fail、busy、配置)
 * - 本次页面生命周期内的关键事件日志 (带相对时间戳)
 * 目的是一次复制就能定位现场, 不需要再让用户手敲代码。
 */
(function () {
  'use strict'

  // ---------------------------------------------------------------- 常量

  const STORE_KEY = 'bcc.hotkey'
  const STORE_LANG = 'bcc.lang'
  const STORE_HUMAN = 'bcc.humanFirst'
  const STORE_TIP = 'bcc.tipMode'
  const STORE_ENABLED = 'bcc.enabled'
  const STORE_AUTO_OFF = 'bcc.autoOff'

  const DEFAULT_HOTKEY = 'shift+c'
  const MODS = ['ctrl', 'alt', 'shift', 'meta']

  const SEL_CLOSE = '.bpx-player-ctrl-subtitle-close-switch'
  const SEL_BTN = '.bpx-player-ctrl-subtitle'
  const SEL_WRAP = '.bpx-player-subtitle-wrap'
  const SEL_MAJOR_ITEM = '.bpx-player-ctrl-subtitle-major .bpx-player-ctrl-subtitle-language-item'
  const SEL_ANY_ITEM = '.bpx-player-ctrl-subtitle-language-item'
  const SEL_MINOR = '.bpx-player-ctrl-subtitle-minor'

  const PANEL_ID = 'bcc-panel-host'
  const TOAST_ID = 'bcc-toast'

  // ---------------------------------------------------------------- 存储

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function'

  const store = {
    get(key, fallback) {
      try {
        let value
        if (hasGM) {
          value = GM_getValue(key, fallback)
        } else {
          value = localStorage.getItem(key)
        }
        if (value === undefined || value === null || value === '') {
          return fallback
        }
        return value
      } catch (e) {
        return fallback
      }
    },
    set(key, value) {
      try {
        if (hasGM) {
          GM_setValue(key, value)
        } else {
          localStorage.setItem(key, String(value))
        }
      } catch (e) {
        /* 存储失败不影响快捷键本身 */
      }
    },
  }

  const isEnabled = () => store.get(STORE_ENABLED, '1') !== '0'
  const getLangPref = () => store.get(STORE_LANG, '')
  const isHumanFirst = () => store.get(STORE_HUMAN, '1') !== '0'
  const getTipMode = () => store.get(STORE_TIP, 'auto')
  const isAutoOff = () => store.get(STORE_AUTO_OFF, '1') !== '0'

  function getHotkeyValue() {
    return store.get(STORE_KEY, DEFAULT_HOTKEY)
  }

  // ---------------------------------------------------------------- 工具

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  /** 本次页面生命周期内的关键事件环形缓冲, 供诊断输出 */
  const LOG_LIMIT = 200
  const eventLog = []
  const bootAt = Date.now()

  function logEvent(tag, detail) {
    const t = Date.now() - bootAt
    const mm = String(Math.floor(t / 60000)).padStart(2, '0')
    const ss = String(Math.floor((t % 60000) / 1000)).padStart(2, '0')
    const ms = String(t % 1000).padStart(3, '0')
    eventLog.push(`+${mm}:${ss}.${ms} [${tag}] ${detail}`)
    if (eventLog.length > LOG_LIMIT) {
      eventLog.shift()
    }
  }

  function scriptVersion() {
    try {
      if (typeof GM_info !== 'undefined' && GM_info.script) {
        return GM_info.script.version || 'unknown'
      }
    } catch (e) {
      /* 忽略 */
    }
    return 'unknown'
  }

  function rectBrief(el) {
    if (!el) {
      return 'none'
    }
    const r = el.getBoundingClientRect()
    return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`
  }

  function styleBrief(el) {
    if (!el) {
      return '-'
    }
    const cs = window.getComputedStyle(el)
    return `display=${cs.display} vis=${cs.visibility} op=${cs.opacity} z=${cs.zIndex}`
  }

  function classOf(el) {
    if (!el) {
      return '-'
    }
    const value = el.className
    return String(value && value.baseVal !== undefined ? value.baseVal : value || '')
  }

  function nodeBrief(el) {
    if (!el) {
      return '-'
    }
    const cls = classOf(el).trim().split(/\s+/).filter(Boolean)
    return (el.id ? `#${el.id}` : '') + (cls.length ? '.' + cls.join('.') : '') || el.tagName
  }

  function chainBrief(el, depth) {
    const limit = depth || 3
    const out = []
    let node = el
    let i = 0
    while (node && node.nodeType === 1 && i < limit) {
      out.push(nodeBrief(node))
      node = node.parentElement
      i++
    }
    return out.join(' < ')
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) {
      return false
    }
    if (el.isContentEditable) {
      return true
    }
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  function normalizeCombo(e) {
    const key = (e.key || '').toLowerCase()
    const ignored = [
      '',
      'control',
      'alt',
      'shift',
      'meta',
      'os',
      'win',
      'altgraph',
      'capslock',
      'numlock',
      'scrolllock',
      'dead',
      'unidentified',
      'process',
      'fn',
    ]
    if (ignored.includes(key)) {
      return null
    }
    const parts = MODS.filter(mod => e[`${mod}Key`])
    const name = key === ' ' ? 'space' : key
    return parts.concat(name).join('+')
  }

  function comboKey(value) {
    const parts = String(value || '')
      .toLowerCase()
      .split('+')
      .map(it => it.trim())
      .filter(Boolean)
    const mods = MODS.filter(mod => parts.includes(mod))
    const keys = parts.filter(it => !MODS.includes(it))
    return mods.concat(keys).join('+')
  }

  async function waitFor(selector, timeout, interval) {
    const limit = timeout || 800
    const step = interval || 50
    const end = Date.now() + limit
    let el = document.querySelector(selector)
    while (!el && Date.now() < end) {
      await sleep(step)
      el = document.querySelector(selector)
    }
    return el
  }

  // ---------------------------------------------------------------- 提示

  let toastTimer = 0

  function toast(text) {
    if (!document.body) {
      return
    }
    let el = document.getElementById(TOAST_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = TOAST_ID
      el.style.cssText =
        'position:fixed;left:24px;bottom:24px;z-index:2147483647;' +
        'padding:10px 16px;border-radius:8px;background:rgba(0,0,0,.85);' +
        'color:#fff;font-size:14px;line-height:1.5;font-family:inherit;' +
        'pointer-events:none;opacity:0;transition:opacity .18s ease;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:nowrap;'
      document.body.appendChild(el)
    }
    el.textContent = text
    el.style.opacity = '1'
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    toastTimer = window.setTimeout(() => {
      el.style.opacity = '0'
    }, 1600)
  }

  function successTip(text) {
    const mode = getTipMode()
    if (mode === 'self') {
      toast(text)
    }
  }

  // ---------------------------------------------------------------- 诊断

  let debugMode = false

  function debugLog(text, force) {
    if ((!debugMode && !force) || !document.body) {
      return
    }
    let el = document.getElementById('bcc-debug')
    if (!el) {
      el = document.createElement('div')
      el.id = 'bcc-debug'
      el.style.cssText =
        'position:fixed;left:12px;bottom:64px;z-index:2147483647;max-width:70vw;' +
        'padding:8px 12px;border-radius:6px;background:rgba(0,0,0,.9);' +
        'color:#7ee787;font:12px/1.6 Consolas,Menlo,monospace;' +
        'white-space:pre-wrap;pointer-events:none;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.4);'
      document.body.appendChild(el)
    }
    el.textContent = text
    clearTimeout(el._t)
    el._t = window.setTimeout(() => el.remove(), 12000)
  }

  // ---------------------------------------------------------------- 字幕控制

  function isVisible(el) {
    if (!el || !el.isConnected) {
      return false
    }
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      return false
    }
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  function queryItems() {
    let items = Array.from(document.querySelectorAll(SEL_MAJOR_ITEM))
    if (!items.length) {
      const box = document.querySelector('.bpx-player-ctrl-subtitle-box') || document
      items = Array.from(box.querySelectorAll(SEL_ANY_ITEM)).filter(
        el => !el.closest(SEL_MINOR),
      )
    }
    const visible = items.filter(isVisible)
    return visible.length ? visible : items
  }

  /** 派发完整的指针 + 鼠标 + click 事件序列, 尽量贴近真实点击 */
  function fireClickSequence(el) {
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerover', { ...opts, buttons: 0 }))
        el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false, buttons: 0 }))
        el.dispatchEvent(new PointerEvent('pointerdown', opts))
      }
      el.dispatchEvent(new MouseEvent('mouseover', { ...opts, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mousedown', opts))
      el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }))
      el.click()
    } catch (e) {
      el.click()
    }
  }

  /** 读取 B 站播放器保存的字幕语言偏好 (bpx_player_profile → subtitle.preferred_language / subtitle.lan) */
  function readPlayerLangPreference() {
    const keys = ['bpx_player_profile', 'bilibili_player_settings']
    for (const storageKey of keys) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (!raw) {
          continue
        }
        const profile = JSON.parse(raw)
        const subtitle = findSubtitleConfig(profile, 0)
        if (!subtitle) {
          continue
        }
        if (typeof subtitle.preferred_language === 'string' && subtitle.preferred_language) {
          return subtitle.preferred_language
        }
        if (typeof subtitle.lan === 'string' && subtitle.lan) {
          return subtitle.lan
        }
      } catch (e) {
        /* 配置损坏时忽略, 继续尝试下一个来源 */
      }
    }
    return ''
  }

  function findSubtitleConfig(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) {
      return null
    }
    if (node.subtitle && typeof node.subtitle === 'object') {
      return node.subtitle
    }
    for (const key of Object.keys(node)) {
      const found = findSubtitleConfig(node[key], depth + 1)
      if (found) {
        return found
      }
    }
    return null
  }

  function lanOf(el) {
    return String(el.dataset.lan || el.getAttribute('data-lan') || '').toLowerCase()
  }

  /**
   * 语言匹配优先级:
   * 1. 目标语言的同语言人工字幕 (humanFirst 开启时)
   * 2. 同基础语言的任意人工字幕 (humanFirst 开启时)
   * 3. 完全匹配的语言 (含 ai- 前缀)
   * 4. 目标语言的 AI 字幕
   * 5. 包含目标基础语言的任意字幕
   * 6. 第一个可选字幕
   */
  function pickSubtitleItem(items, preference, humanFirst) {
    if (!items.length) {
      return null
    }
    const pref = String(preference || '')
      .trim()
      .toLowerCase()
    if (!pref) {
      return items[0]
    }
    const normalized = pref.replace(/^ai-/, '')
    const base = normalized.split('-')[0]
    const isHuman = el => !lanOf(el).startsWith('ai-')

    if (humanFirst) {
      const exactHuman = items.find(el => lanOf(el) === normalized && isHuman(el))
      if (exactHuman) {
        return exactHuman
      }
      const sameBaseHuman = items.find(
        el => isHuman(el) && lanOf(el).split('-')[0] === base,
      )
      if (sameBaseHuman) {
        return sameBaseHuman
      }
    }
    const exact = items.find(el => lanOf(el) === normalized)
    if (exact) {
      return exact
    }
    const ai = items.find(el => lanOf(el) === `ai-${base}`)
    if (ai) {
      return ai
    }
    const loose = items.find(el => lanOf(el).includes(base))
    if (loose) {
      return loose
    }
    return items[0]
  }

  /** 只派发 hover 相关事件, 用于展开字幕面板 */
  function fireHover(el) {
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerover', opts))
        el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }))
      }
      el.dispatchEvent(new MouseEvent('mouseover', opts))
      el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }))
      el.dispatchEvent(new MouseEvent('mousemove', opts))
    } catch (e) {
      /* 事件构造失败时忽略 */
    }
  }

  /**
   * 元素及其祖先是否真的在渲染 (没被 display/visibility/opacity 藏起来)
   * 停止条件到 stopAt, 避免被播放器外层的样式干扰。
   */
  function isRendered(el, stopAt) {
    let node = el
    while (node && node !== stopAt && node.nodeType === 1) {
      const cs = window.getComputedStyle(node)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) {
        return false
      }
      node = node.parentElement
    }
    return true
  }

  /**
   * 字幕渲染层里是不是真的有可见文字。
   * B 站可能把开关标成「关闭」但字幕层没清掉, 只信开关会误判。
   */
  function layerShown() {
    for (const wrap of Array.from(document.querySelectorAll(SEL_WRAP))) {
      for (const el of Array.from(wrap.querySelectorAll('div, span'))) {
        const text = (el.textContent || '').trim()
        if (!text || el.querySelector('div, span')) {
          continue
        }
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) {
          continue
        }
        if (isRendered(el, wrap.parentElement)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * 读取当前字幕状态。
   * B 站的主字幕 / 副字幕 / AI 翻译各有一套「关闭」开关, 只取第一个会误判,
   * 所以全部收集, 全部处于选中态才算开关层面已关。
   *
   * off === true   所有关闭开关都选中
   * off === false  至少一个开关没选中, 字幕处于开的状态
   * off === null   面板还没渲染
   */
  function getState() {
    const switches = Array.from(document.querySelectorAll(SEL_CLOSE))
    if (!switches.length) {
      return { switches: [], closeSwitch: null, off: null, items: [] }
    }
    return {
      switches,
      closeSwitch: switches[0],
      off: switches.every(el => el.classList.contains('bpx-state-active')),
      items: queryItems(),
    }
  }

  /**
   * 真正处于关闭状态: 开关全部选中, 且字幕层没有可见文字。
   * 返回 null 表示面板还没渲染, 无法判断。
   */
  function reallyOff() {
    const state = getState()
    if (!state.switches.length) {
      return null
    }
    return state.off === true && !layerShown()
  }

  /** 字幕是否已开启: 开关没全选中, 或任一语言项处于选中态, 或字幕层有文字 */
  function isSubtitleOn() {
    const state = getState()
    if (!state.switches.length) {
      return layerShown()
    }
    if (state.off === false) {
      return true
    }
    if (document.querySelector(`${SEL_ANY_ITEM}.bpx-state-active`)) {
      return true
    }
    return layerShown()
  }

  /** 面板展开后语言项才有尺寸, 用来判断面板是否真的摊开了 */
  function anyVisibleItem() {
    return Array.from(document.querySelectorAll(SEL_ANY_ITEM)).find(el => isVisible(el)) || null
  }

  /** 面板存在但收起时, hover 字幕按钮把它展开, 让语言项真正可点 */
  async function wakePanelForItem() {
    if (anyVisibleItem()) {
      return true
    }
    const btn = document.querySelector(SEL_BTN)
    if (!btn) {
      return false
    }
    fireHover(btn)
    for (let i = 0; i < 8; i++) {
      await sleep(120)
      if (anyVisibleItem()) {
        logEvent('rebuild', `hover 后语言项可见 (${(i + 1) * 120}ms)`)
        return true
      }
    }
    logEvent('rebuild', 'hover 未能展开面板, 直接点收起状态的语言项')
    return false
  }

  /** 脏状态重建计数, 用来逐级升级: 第 2 次起先 hover 展开面板 */
  let rebuildTries = 0

  /**
   * 脏状态修复: 开关全选中但字幕层仍在渲染。
   * 先用「点语言项」把自动渲染态变成用户选中态 (建立渲染通道), 再点 close 关掉。
   * 只点 close 是无效的 —— 那种点击只改 UI class, 不碰渲染层。
   */
  async function rebuildClose(trace, round) {
    rebuildTries++
    if (rebuildTries >= 2) {
      await wakePanelForItem()
    }

    const preference = getLangPref() || readPlayerLangPreference()
    const target = pickSubtitleItem(queryItems(), preference, isHumanFirst())
    if (!target) {
      trace.push('  重建: 没有可选语言项')
      logEvent('rebuild', `第${round}轮 没有语言项`)
      return false
    }

    const lan = lanOf(target)
    const activeBefore = target.classList.contains('bpx-state-active')
    logEvent(
      'rebuild',
      `第${round}轮 点语言项 ${lan} 前 active=${activeBefore} 开关全选中=${getState().off} 层=${layerShown()}`,
    )

    // 第 1 步: 点语言项, 把「自动渲染」对齐成「用户选中」
    target.click()
    await sleep(420)
    const activeAfter = target.classList.contains('bpx-state-active')
    logEvent(
      'rebuild',
      `第${round}轮 语言项 ${lan} 点击后 active=${activeAfter} 开关全选中=${getState().off} 层=${layerShown()}`,
    )
    trace.push(
      `  重建: 点 ${lan} active ${activeBefore}→${activeAfter} 层=${layerShown() ? '显示' : '无'}`,
    )

    // 第 2 步: 点掉所有没选中的 close-switch
    let pending = Array.from(document.querySelectorAll(SEL_CLOSE)).filter(
      el => !el.classList.contains('bpx-state-active'),
    )
    if (!pending.length) {
      // 语言项没让开关翻面, 说明还停在自动渲染态: 逆反一次拿回控制权
      const sw = document.querySelector(SEL_CLOSE)
      if (sw) {
        sw.click()
        await sleep(340)
        pending = Array.from(document.querySelectorAll(SEL_CLOSE)).filter(
          el => !el.classList.contains('bpx-state-active'),
        )
        logEvent(
          'rebuild',
          `第${round}轮 逆反后 待点关闭开关=${pending.length} 开关全选中=${getState().off}`,
        )
      }
    }

    for (const el of pending) {
      el.click()
      await sleep(180)
    }
    await sleep(380)

    const ok = reallyOff() === true
    logEvent(
      'rebuild',
      `第${round}轮 结果 开关全选中=${getState().off} 层=${layerShown()} reallyOff=${ok}`,
    )
    trace.push(
      `  重建: 点了 ${pending.length} 个关闭开关 → 开关全选中=${getState().off} 层=${
        layerShown() ? '显示' : '无'
      } ${ok ? '成功' : '仍失败'}`,
    )
    return ok
  }

  /**
   * 把字幕关到底。
   * 1. 点掉所有没选中的关闭开关
   * 2. 开关全都声称「已关」但字幕层还在渲染时交给 rebuildClose:
   *    必须先点语言项再点 close, 单点 close 无效
   */
  async function forceClose(trace, rounds) {
    const limit = rounds || 3
    for (let round = 0; round < limit; round++) {
      const pending = Array.from(document.querySelectorAll(SEL_CLOSE)).filter(
        el => !el.classList.contains('bpx-state-active'),
      )
      logEvent(
        'forceClose',
        `第${round + 1}轮 开关=${document.querySelectorAll(SEL_CLOSE).length} 未选中=${pending.length} 层显示=${layerShown()}`,
      )
      for (const el of pending) {
        el.click()
        await sleep(160)
      }
      if (pending.length) {
        await sleep(240)
      }
      if (reallyOff() === true) {
        rebuildTries = 0
        trace.push(`③ 已关闭字幕 (第 ${round + 1} 轮)`)
        logEvent('forceClose', `第${round + 1}轮 已关闭`)
        return true
      }
      if (!pending.length && layerShown()) {
        trace.push(`③ 开关显示已关但字幕还在显示, 走「语言项 → 关闭」重建 (第 ${round + 1} 轮)`)
        logEvent('forceClose', `第${round + 1}轮 开关全选中但字幕层仍渲染, 走语言项重建`)
        if (await rebuildClose(trace, round + 1)) {
          rebuildTries = 0
          trace.push(`③ 已关闭字幕 (第 ${round + 1} 轮)`)
          logEvent('forceClose', `第${round + 1}轮 语言项重建成功`)
          return true
        }
      } else {
        await sleep(200)
      }
    }
    if (reallyOff() === true) {
      rebuildTries = 0
      return true
    }
    trace.push('③ 关闭失败: 多次尝试后字幕仍在显示')
    logEvent('forceClose', `关闭失败 开关全选中=${getState().off} 层显示=${layerShown()}`)
    return false
  }

  /**
   * 确保面板可用。
   * B 站把字幕面板做成了按需创建: 没点过按钮时整个面板都不在 DOM 里,
   * 这时任何点击都不会有反应。先 hover 尝试展开, 不行再真实点一次按钮。
   */
  async function ensurePanelUsable() {
    if (document.querySelector(SEL_CLOSE)) {
      return true
    }
    logEvent('panel', '面板未渲染, 开始唤醒')
    const candidates = []
    const push = el => {
      if (el && !candidates.includes(el)) {
        candidates.push(el)
      }
    }
    push(await waitFor(SEL_BTN, 1200))
    push(document.querySelector('[aria-label="字幕"]'))
    if (candidates[0] && candidates[0].parentElement) {
      push(candidates[0].parentElement)
    }
    for (const el of candidates) {
      fireHover(el)
      if (await waitFor(SEL_CLOSE, 350)) {
        logEvent('panel', `hover ${nodeBrief(el)} 成功`)
        return true
      }
      fireClickSequence(el)
      if (await waitFor(SEL_CLOSE, 900)) {
        logEvent('panel', `点击 ${nodeBrief(el)} 后出现面板（会顺带切换字幕状态）`)
        return true
      }
    }
    logEvent('panel', '唤醒失败')
    return false
  }

  let busy = false

  async function toggleSubtitle() {
    if (busy) {
      // 看守正在修字幕, 等它收手再接管, 最多等 2.2s (一次重建约 1.5s)
      logEvent('toggle', '看守占用中, 等待')
      for (let i = 0; i < 22 && busy; i++) {
        await sleep(100)
      }
      if (busy) {
        logEvent('toggle', '看守仍占用, 本次按键忽略')
        return
      }
    }
    busy = true
    const trace = []
    try {
      logEvent('toggle', '快捷键触发')
      trace.push('① 展开面板…')
      const panelReady = await ensurePanelUsable()
      const state = getState()
      const shown = layerShown()
      trace.push(
        `② 面板=${panelReady ? '已就绪' : '未就绪'} 关闭开关=${state.switches.length} 全选中=${state.off} 字幕层显示=${shown} 语言项=${state.items.length}`,
      )
      logEvent('toggle', `现场 开关=${state.switches.length} 全选中=${state.off} 层=${shown} 语言项=${state.items.length}`)

      if (!state.switches.length) {
        const btn = document.querySelector(SEL_BTN)
        trace.push(`② 面板没有渲染出来 (字幕按钮=${btn ? '存在' : '不存在'})`)
        logEvent('toggle', `面板未渲染 字幕按钮=${!!btn}`)
        if (!btn) {
          toast('当前视频没有字幕')
          return
        }
        reportFailure(trace)
        return
      }

      // ---- 关闭分支
      // 注意用 reallyOff: 开关可能都显示「关闭」但字幕层还在渲染
      if (state.off !== true || shown) {
        logEvent('toggle', `进入关闭分支 开关全选中=${state.off} 层显示=${shown}`)
        if (await forceClose(trace)) {
          debugLog(trace.join('\n'))
          expectOff = true
          startWatch('快捷键关闭字幕')
          logEvent('toggle', '结果=已关闭')
          successTip('字幕已关闭')
          return
        }
        logEvent('toggle', '结果=关闭失败')
        reportFailure(trace)
        return
      }

      // ---- 开启分支
      const preference = getLangPref() || readPlayerLangPreference()
      const humanFirst = isHumanFirst()
      trace.push(`偏好=${preference || '(无)'} 人工优先=${humanFirst}`)

      let sawItems = false
      for (let round = 0; round < 6; round++) {
        if (!document.querySelector(SEL_CLOSE)) {
          await ensurePanelUsable()
        }
        const items = queryItems()
        if (!items.length) {
          trace.push(`  第${round + 1}轮: 还没有语言项, 等待`)
          await sleep(280)
          continue
        }
        sawItems = true
        const target = pickSubtitleItem(items, preference, humanFirst)
        if (!target) {
          trace.push(`  第${round + 1}轮: 语言匹配为空`)
          break
        }
        const lan = lanOf(target)
        // 第 1 轮纯 click; 第 2 轮完整事件序列; 之后点内部文本节点
        if (round === 0) {
          target.click()
        } else if (round === 1) {
          fireClickSequence(target)
        } else {
          const inner = target.querySelector('span, .name, div') || target
          ;(inner || target).click()
        }
        await sleep(320)
        if (isSubtitleOn()) {
          trace.push(`  第${round + 1}轮: 点 ${lan} 生效`)
          debugLog(trace.join('\n'))
          // 用户主动开字幕, 本视频交给用户, 自动关闭不再插手
          expectOff = false
          logEvent('toggle', `结果=已开启 lan=${lan} 第${round + 1}轮`)
          const label = (target.textContent || '').trim()
          successTip(label ? `字幕已开启（${label}）` : '字幕已开启')
          return
        }
        trace.push(`  第${round + 1}轮: 点 ${lan} 无效, 重试`)
        logEvent('toggle', `第${round + 1}轮 点 ${lan} 未生效`)
        await sleep(220)
      }

      if (!sawItems) {
        trace.push('③ 面板里始终没有语言项')
        logEvent('toggle', '结果=面板无语言项')
        toast('当前视频没有可选字幕')
        debugLog(trace.join('\n'), true)
        return
      }

      trace.push('③ 开启失败: 6 轮点击都没有生效')
      logEvent('toggle', '结果=开启失败')
      reportFailure(trace)
    } finally {
      busy = false
    }
  }

  // ---------------------------------------------------------------- 自动关闭

  const WATCH_ACTIVE = 800
  const WATCH_HIDDEN = 5000
  const WATCH_NO_PANEL = 2000

  /**
   * 本视频的字幕意图: true = 希望字幕是关的。
   * 进页面 / 切视频时重置为 true; 用户自己开字幕则置 false, 本视频不再插手。
   */
  let expectOff = true

  let watchToken = 0
  let watchTimer = 0
  let failCount = 0

  function watchDelay() {
    if (failCount > 0) {
      return Math.min(4000, WATCH_ACTIVE * (1 + failCount))
    }
    return document.hidden ? WATCH_HIDDEN : WATCH_ACTIVE
  }

  function scheduleWatch(delay) {
    if (watchTimer) {
      clearTimeout(watchTimer)
    }
    const token = watchToken
    watchTimer = window.setTimeout(() => {
      watchTimer = 0
      watchTick(token)
    }, delay)
  }

  /**
   * 常驻看守: 意图为「关」时, 任何时刻发现字幕被打开就关掉。
   * 面板还没渲染时降频等待, 点击失败时退避重试, 不设总时长上限。
   */
  async function watchTick(token) {
    if (token !== watchToken) {
      return
    }
    if (!isAutoOff() || !isEnabled() || !expectOff) {
      return
    }
    // 快捷键正在切换中, 让位后再看
    if (busy) {
      scheduleWatch(400)
      return
    }
    const state = getState()
    if (!state.switches.length) {
      scheduleWatch(document.hidden ? WATCH_HIDDEN * 2 : WATCH_NO_PANEL)
      return
    }
    // 任何一个关闭开关没选中, 或字幕层还在渲染, 都算没关干净
    if (state.off !== true || layerShown()) {
      logEvent('watch', `发现未关闭 开关全选中=${state.off} 层=${layerShown()} fail=${failCount}`)
      // 只跑一轮, 避免长时间占住 busy 让快捷键按下去没反应; 下一轮定时器会继续
      // 记 busy 是为了让快捷键等这次重建收手, 两边同时点会把状态点乱
      busy = true
      let ok = false
      try {
        ok = await forceClose([], 1)
      } finally {
        busy = false
      }
      if (token !== watchToken) {
        return
      }
      if (ok) {
        if (failCount > 0) {
          console.log('[bcc] 已自动关闭字幕（重试成功）')
        }
        failCount = 0
      } else {
        failCount++
        console.log(`[bcc] 自动关闭未生效，第 ${failCount} 次`)
      }
    } else {
      failCount = 0
    }
    scheduleWatch(watchDelay())
  }

  /**
   * 启动 / 重生看守链。
   * 前一次定时器会被清掉, 由新 token 接管, 避免多条链叠加。
   */
  function startWatch(reason) {
    if (!isAutoOff() || !isEnabled() || !expectOff) {
      return
    }
    failCount = 0
    watchToken++
    console.log('[bcc] 开始看守字幕状态' + (reason ? `（${reason}）` : ''))
    logEvent('watch', `start token=${watchToken} ${reason || ''}`)
    scheduleWatch(600)
  }

  function resetForVideo(reason) {
    expectOff = true
    rebuildTries = 0
    logEvent('video', `重置意图=关 ${reason || ''} url=${location.href.slice(0, 120)}`)
    startWatch(reason)
  }

  function whenDomReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true })
    } else {
      fn()
    }
  }

  /**
   * 记录字幕渲染层的「显隐翻转」时间点。
   * 用于回答「字幕是什么时候冒出来的、当时脚本在做什么」。
   * 回调做了节流, 只有状态真的翻转才落一条日志。
   */
  let subtitleObserver = null
  let lastLayerShown = null
  let lastLayerProbeAt = 0

  function startSubtitleObserver() {
    if (subtitleObserver || typeof MutationObserver !== 'function' || !document.body) {
      return
    }
    subtitleObserver = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastLayerProbeAt < 800) {
        return
      }
      lastLayerProbeAt = now
      const shown = layerShown()
      if (shown === lastLayerShown) {
        return
      }
      lastLayerShown = shown
      logEvent('layer', `字幕层显示=${shown}`)
    })
    subtitleObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    lastLayerShown = layerShown()
    logEvent('layer', `开始监听字幕层变化 初始显示=${lastLayerShown}`)
  }

  // ---------------------------------------------------------------- 诊断

  const PLAYER_SCOPES = '.bpx-player-container, #bilibili-player'

  function containerList() {
    return Array.from(document.querySelectorAll(PLAYER_SCOPES))
  }

  function containerTag(el) {
    if (!el) {
      return '-'
    }
    const scope = el.closest(PLAYER_SCOPES)
    if (!scope) {
      return 'none'
    }
    return `#${containerList().indexOf(scope)}`
  }

  function dumpEnvironment() {
    const player = document.querySelector('.bpx-player-container')
    const fullscreen = document.fullscreenElement ? '是' : '否'
    const webFullscreen = player && classOf(player).includes('fullscreen') ? '是' : '否'
    return [
      `时间: ${new Date().toLocaleString()}`,
      `URL: ${location.href}`,
      `标题: ${document.title}`,
      `视口: ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
      `页面: readyState=${document.readyState} hidden=${document.hidden} 已运行 ${((Date.now() - bootAt) / 1000).toFixed(1)}s`,
      `文档全屏=${fullscreen} 播放器全屏=${webFullscreen}`,
      `UA: ${navigator.userAgent.slice(0, 170)}`,
    ]
  }

  function dumpRuntime() {
    return [
      `启用=${isEnabled()} 自动关闭=${isAutoOff()} 意图=${expectOff ? '希望关闭' : '交给用户'}`,
      `看护: token=${watchToken} timer=${watchTimer ? 'pending' : 'idle'} fail=${failCount} busy=${busy} 重建尝试=${rebuildTries}`,
      `快捷键=${getHotkeyValue()} 语言偏好=${getLangPref() || '(跟随播放器)'} 人工优先=${isHumanFirst()} 提示=${getTipMode()}`,
      `面板节点: 字幕按钮 ${document.querySelectorAll(SEL_BTN).length} 个, 面板盒 ${
        document.querySelectorAll('.bpx-player-ctrl-subtitle-box').length
      } 个`,
    ]
  }

  function dumpContainers() {
    const list = containerList()
    if (!list.length) {
      return ['(没有匹配到 .bpx-player-container 或 #bilibili-player)']
    }
    return list.map(
      (el, i) =>
        `[${i}] ${nodeBrief(el)} ${rectBrief(el)} ${styleBrief(el)} | 关闭开关=${el.querySelectorAll(SEL_CLOSE).length} 语言项=${el.querySelectorAll(SEL_ANY_ITEM).length} 字幕层=${el.querySelectorAll(SEL_WRAP).length}`,
    )
  }

  function dumpSwitches() {
    const list = Array.from(document.querySelectorAll(SEL_CLOSE))
    const lines = [`共 ${list.length} 个, 选中 ${list.filter(el => el.classList.contains('bpx-state-active')).length} 个`]
    list.forEach((el, i) => {
      lines.push(
        `[${i}] active=${el.classList.contains('bpx-state-active')} 可渲染=${isRendered(el, document.body)} ${rectBrief(el)} ${styleBrief(el)} 容器=${containerTag(el)}`,
      )
      lines.push(`     class=${classOf(el)}`)
      lines.push(`     父链=${chainBrief(el.parentElement, 4)}`)
      lines.push(`     html=${el.outerHTML.replace(/\s+/g, ' ').slice(0, 260)}`)
    })
    return lines
  }

  function dumpItems() {
    const list = Array.from(document.querySelectorAll(SEL_ANY_ITEM))
    const activeCount = list.filter(el => el.classList.contains('bpx-state-active')).length
    const lines = [`共 ${list.length} 个, 选中 ${activeCount} 个`]
    list.forEach((el, i) => {
      const group = el.closest(SEL_MINOR)
        ? 'minor'
        : el.closest('.bpx-player-ctrl-subtitle-major')
          ? 'major'
          : '?'
      lines.push(
        `[${i}] lan=${lanOf(el) || '-'} active=${el.classList.contains('bpx-state-active')} 组=${group} 可见=${isVisible(el)} ${rectBrief(el)} 容器=${containerTag(el)} 文本="${(el.textContent || '').trim().slice(0, 24)}"`,
      )
    })
    return lines
  }

  function dumpWraps() {
    const wraps = Array.from(document.querySelectorAll(SEL_WRAP))
    const lines = [`共 ${wraps.length} 个, 有可见文字=${layerShown()}`]
    wraps.forEach((wrap, i) => {
      lines.push(
        `[${i}] ${rectBrief(wrap)} ${styleBrief(wrap)} 容器=${containerTag(wrap)} class=${classOf(wrap).slice(0, 120)}`,
      )
      const leaves = Array.from(wrap.querySelectorAll('div, span')).filter(el => {
        const text = (el.textContent || '').trim()
        return text && !el.querySelector('div, span')
      })
      if (!leaves.length) {
        lines.push('     无叶子文本节点')
        return
      }
      leaves.slice(0, 10).forEach(el => {
        lines.push(
          `     "${(el.textContent || '').trim().slice(0, 32)}" ${rectBrief(el)} ${styleBrief(el)} 可渲染=${isRendered(el, wrap.parentElement)}`,
        )
      })
      if (leaves.length > 10) {
        lines.push(`     …… 另有 ${leaves.length - 10} 个文本节点`)
      }
    })
    return lines
  }

  function dumpVerdict() {
    const state = getState()
    const shown = layerShown()
    const conflict = state.off === true && shown
    return [
      `关闭开关: 共 ${state.switches.length} 个, 全选中=${state.off}`,
      `字幕层可见文字=${shown}`,
      `reallyOff=${reallyOff()}  isSubtitleOn=${isSubtitleOn()}`,
      `结论=${
        state.off === null
          ? '面板未渲染'
          : conflict
            ? '矛盾：开关显示已关但字幕仍在渲染'
            : state.off && !shown
              ? '已关闭'
              : '未关闭'
      }`,
      `建议=${conflict ? '走 rebuildClose 的「语言项 → 关闭」重建' : state.off && !shown ? '无需动作' : '直接点关闭开关'}`,
    ]
  }

  function dumpLog() {
    if (!eventLog.length) {
      return ['(还没有事件)']
    }
    return eventLog.slice(-120).map(line => ' ' + line)
  }

  function buildDiagnostics() {
    const sections = [
      `===== BCC 诊断 v${scriptVersion()} =====`,
      '提示: 遇到「面板显示关闭但字幕仍在显示」时, 先点这条菜单再动键盘/鼠标, 否则现场会被覆盖',
    ]
    const safe = (title, fn) => {
      sections.push('', `--- ${title} ---`)
      try {
        sections.push(...fn())
      } catch (e) {
        sections.push(`<读取失败: ${(e && e.message) || e}>`)
      }
    }
    safe('环境', dumpEnvironment)
    safe('脚本状态', dumpRuntime)
    safe('播放器容器', dumpContainers)
    safe('关闭开关', dumpSwitches)
    safe('语言项', dumpItems)
    safe('字幕渲染层', dumpWraps)
    safe('判定', dumpVerdict)
    safe('事件日志', dumpLog)
    return sections.join('\n')
  }

  /** 失败时把完整现场打印出来并尝试自动复制, 减少来回排查 */
  function reportFailure(trace) {
    const text = trace.join('\n') + '\n---- 现场 ----\n' + buildDiagnostics()
    debugLog(text, true)
    console.log('[bcc] 切换失败\n' + text)
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text')
        toast('字幕没有切换成功，诊断信息已复制到剪贴板')
        return
      }
    } catch (e) {
      /* 落到下面的提示 */
    }
    toast('字幕没有切换成功，请点菜单「复制诊断信息到剪贴板」')
  }

  // ---------------------------------------------------------------- 设置面板

  let panelHost = null
  let recording = false

  function openSettings() {
    if (panelHost) {
      return
    }
    const host = document.createElement('div')
    host.id = PANEL_ID
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = buildPanelHtml()
    document.body.appendChild(host)
    panelHost = host
    bindPanel(shadow, host)
  }

  function closeSettings() {
    if (panelHost) {
      if (typeof panelHost.__bccStopRecord === 'function') {
        panelHost.__bccStopRecord()
      }
      if (typeof panelHost.__bccEsc === 'function') {
        window.removeEventListener('keydown', panelHost.__bccEsc, true)
      }
      panelHost.remove()
      panelHost = null
    }
    recording = false
  }

  function currentLangValue() {
    const value = getLangPref()
    if (!value) {
      return { select: 'auto', custom: '' }
    }
    if (['zh-CN', 'en-US', 'ja'].includes(value)) {
      return { select: value, custom: '' }
    }
    return { select: 'custom', custom: value }
  }

  function buildPanelHtml() {
    const lang = currentLangValue()
    return `
<style>
  :host { all: initial; }
  .mask {
    position: fixed; inset: 0; background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  .panel {
    width: 420px; max-width: calc(100vw - 48px);
    background: #181a1d; color: #e8e6e3;
    border: 1px solid #2a2d31; border-radius: 12px;
    padding: 20px 22px 18px; box-shadow: 0 12px 48px rgba(0,0,0,.55);
  }
  .title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #9a958d; margin-bottom: 16px; }
  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .label { width: 96px; flex: none; font-size: 13px; color: #c9c4bc; }
  .grow { flex: 1; display: flex; gap: 8px; align-items: center; min-width: 0; }
  input[type="text"], select {
    background: #0e0f11; color: #e8e6e3; border: 1px solid #2a2d31;
    border-radius: 6px; padding: 7px 10px; font-size: 13px; outline: none;
    min-width: 0; flex: 1;
  }
  input[type="text"]:focus, select:focus { border-color: #e08a5f; }
  input[type="text"]:read-only { color: #e08a5f; cursor: default; }
  button {
    background: #232629; color: #e8e6e3; border: 1px solid #2a2d31;
    border-radius: 6px; padding: 7px 12px; font-size: 13px; cursor: pointer;
    white-space: nowrap;
  }
  button:hover { border-color: #4a4f55; }
  button.primary { background: #e08a5f; border-color: #e08a5f; color: #16181a; font-weight: 600; }
  button.primary:hover { background: #e89a72; }
  .footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  .hint { font-size: 12px; color: #9a958d; margin: -6px 0 12px 108px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c9c4bc; }
  .check input { accent-color: #e08a5f; }
  .hidden { display: none; }
</style>
<div class="mask">
  <div class="panel">
    <div class="title">CC 字幕快捷键</div>
    <div class="sub">独立脚本，不依赖 Bilibili Evolved</div>

    <div class="row">
      <div class="label">快捷键</div>
      <div class="grow">
        <input type="text" class="key-input" readonly value="${escapeHtml(getHotkeyValue())}">
        <button class="btn-record">录制</button>
      </div>
    </div>

    <div class="row">
      <div class="label">字幕语言</div>
      <div class="grow">
        <select class="lang-select">
          <option value="auto">跟随 B 站播放器设置</option>
          <option value="zh-CN">中文</option>
          <option value="en-US">英文</option>
          <option value="ja">日文</option>
          <option value="custom">自定义…</option>
        </select>
      </div>
    </div>
    <div class="row lang-custom-row ${lang.select === 'custom' ? '' : 'hidden'}">
      <div class="label"></div>
      <div class="grow">
        <input type="text" class="lang-custom" placeholder="如 zh-CN、en-US、ai-zh" value="${escapeHtml(
          lang.custom,
        )}">
      </div>
    </div>
    <div class="hint">匹配不到该语言时自动选择 AI 字幕，仍无则选第一个</div>

    <div class="row">
      <div class="label">优先人工字幕</div>
      <div class="grow">
        <label class="check">
          <input type="checkbox" class="human-first" ${isHumanFirst() ? 'checked' : ''}>
          同一语言下优先选择人工字幕
        </label>
      </div>
    </div>

    <div class="row">
      <div class="label">操作提示</div>
      <div class="grow">
        <select class="tip-mode">
          <option value="auto" ${getTipMode() === 'auto' ? 'selected' : ''}>跟随 B 站（默认）</option>
          <option value="self" ${getTipMode() === 'self' ? 'selected' : ''}>总是显示左下角提示</option>
          <option value="none" ${getTipMode() === 'none' ? 'selected' : ''}>不显示</option>
        </select>
      </div>
    </div>

    <div class="row">
      <div class="label">自动关闭</div>
      <div class="grow">
        <label class="check">
          <input type="checkbox" class="auto-off" ${isAutoOff() ? 'checked' : ''}>
          进入视频时自动关闭字幕
        </label>
      </div>
    </div>
    <div class="hint">B 站会恢复上次的字幕状态，勾选后每次进视频都从「关闭」开始</div>

    <div class="row">
      <div class="label">启用</div>
      <div class="grow">
        <label class="check">
          <input type="checkbox" class="enabled" ${isEnabled() ? 'checked' : ''}>
          启用该快捷键
        </label>
      </div>
    </div>

    <div class="footer">
      <button class="btn-cancel">取消</button>
      <button class="primary btn-save">保存</button>
    </div>
  </div>
</div>`
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function bindPanel(shadow, host) {
    const keyInput = shadow.querySelector('.key-input')
    const recordBtn = shadow.querySelector('.btn-record')
    const langSelect = shadow.querySelector('.lang-select')
    const langCustomRow = shadow.querySelector('.lang-custom-row')
    const langCustom = shadow.querySelector('.lang-custom')
    const humanFirst = shadow.querySelector('.human-first')
    const tipMode = shadow.querySelector('.tip-mode')
    const autoOff = shadow.querySelector('.auto-off')
    const enabled = shadow.querySelector('.enabled')

    let recordedKey = getHotkeyValue()

    const stopRecording = () => {
      if (!recording) {
        window.removeEventListener('keydown', onRecord, true)
        return
      }
      recording = false
      recordBtn.textContent = '录制'
      keyInput.value = recordedKey
      window.removeEventListener('keydown', onRecord, true)
    }
    host.__bccStopRecord = stopRecording

    const onRecord = e => {
      e.preventDefault()
      e.stopPropagation()
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation()
      }
      if (e.key === 'Escape') {
        stopRecording()
        return
      }
      const combo = normalizeCombo(e)
      if (!combo) {
        keyInput.value = '请按下组合键（可带 Esc 取消）'
        return
      }
      recordedKey = combo
      stopRecording()
    }

    recordBtn.addEventListener('click', () => {
      if (recording) {
        stopRecording()
        return
      }
      recording = true
      recordBtn.textContent = '取消录制'
      keyInput.value = '请按下组合键…'
      window.addEventListener('keydown', onRecord, true)
    })

    langSelect.addEventListener('change', () => {
      langCustomRow.classList.toggle('hidden', langSelect.value !== 'custom')
    })

    shadow.querySelector('.btn-cancel').addEventListener('click', closeSettings)

    shadow.querySelector('.btn-save').addEventListener('click', () => {
      const selected = langSelect.value
      const langValue =
        selected === 'custom' ? langCustom.value.trim() : selected === 'auto' ? '' : selected
      store.set(STORE_KEY, recordedKey)
      store.set(STORE_LANG, langValue)
      store.set(STORE_HUMAN, humanFirst.checked ? '1' : '0')
      store.set(STORE_TIP, tipMode.value)
      store.set(STORE_ENABLED, enabled.checked ? '1' : '0')
      store.set(STORE_AUTO_OFF, autoOff.checked ? '1' : '0')
      closeSettings()
      toast('设置已保存')
      // 勾了自动关闭就立刻把这个视频的字幕也关掉, 不用等下次进页面
      resetForVideo('设置已保存')
    })

    // 只监听遮罩本身。不能再监听 host:
    // Shadow DOM 会把内部事件的 target 重定向为 host, 导致面板内任何点击都被判定为「点空白处」
    const maskElement = shadow.querySelector('.mask')
    maskElement.addEventListener('click', e => {
      const origin = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target
      if (origin === maskElement) {
        closeSettings()
      }
    })

    const onEscape = e => {
      if (e.key === 'Escape' && panelHost === host && !recording) {
        closeSettings()
      }
    }
    host.__bccEsc = onEscape
    window.addEventListener('keydown', onEscape, true)
  }

  // ---------------------------------------------------------------- 快捷键

  function onKeyDown(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : []
    const first = path[0] || e.target
    const combo = normalizeCombo(e)

    if (debugMode) {
      const matched = combo ? comboKey(combo) === comboKey(getHotkeyValue()) : false
      debugLog(
        `key=${e.key} code=${e.code}\n` +
          `combo=${combo || '(修饰键)'}  配置=${getHotkeyValue()}  匹配=${matched}\n` +
          `启用=${isEnabled()}  录制中=${recording}  面板=${!!panelHost}\n` +
          `target=${(first && first.tagName) || '-'}  editable=${isEditable(first)}`,
      )
    }

    if (recording || !isEnabled() || panelHost) {
      return
    }
    if (isEditable(first)) {
      return
    }
    if (!combo) {
      return
    }
    if (comboKey(combo) !== comboKey(getHotkeyValue())) {
      return
    }
    logEvent('key', `${combo} 命中 target=${nodeBrief(first)}`)
    e.preventDefault()
    e.stopPropagation()
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation()
    }
    toggleSubtitle()
  }

  window.addEventListener('keydown', onKeyDown, true)

  /**
   * 真实点击播放器内任意位置后, 对比点击前后的字幕状态。
   * 只有状态真的被翻转了才认作用户意图 —— 否则点暂停 / 音量也会把意图误改成「开」。
   * 这样字幕按钮、语言项、播放器设置里的字幕开关都能同步意图。
   */
  const PLAYER_SCOPE = '.bpx-player-container, .bpx-player, #bilibili-player'

  document.addEventListener(
    'click',
    e => {
      if (!e.isTrusted) {
        return
      }
      const origin = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target
      const originEl = origin instanceof Element ? origin : origin && origin.parentElement
      if (!originEl || !originEl.closest(PLAYER_SCOPE)) {
        return
      }
      const before = getState().off
      if (before === null) {
        return
      }
      window.setTimeout(() => {
        const after = getState().off
        if (after === null || after === before) {
          return
        }
        logEvent('click', `${nodeBrief(originEl)} 开关态 ${before}→${after}`)
        expectOff = after === true
        if (expectOff) {
          startWatch('用户手动关闭字幕')
        } else {
          console.log('[bcc] 用户手动开启字幕，本视频不再自动关闭')
        }
      }, 300)
    },
    true,
  )

  // ---------------------------------------------------------------- 跟随页面

  whenDomReady(() => {
    startSubtitleObserver()
    resetForVideo('首次加载')
  })

  // 切回前台立刻校准一次, 抵消后台标签页的计时器节流
  document.addEventListener('visibilitychange', () => {
    logEvent('page', `visibility=${document.hidden ? 'hidden' : 'visible'}`)
    if (document.hidden || !expectOff) {
      return
    }
    startWatch('回到前台')
  })

  let lastHref = location.href

  window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href
      resetForVideo('切换视频')
    }
  }, 800)

  // ---------------------------------------------------------------- 菜单

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('设置 CC 字幕快捷键', openSettings)
    GM_registerMenuCommand('切换一次 CC 字幕（调试）', () => {
      toggleSubtitle()
    })
    GM_registerMenuCommand('诊断：显示按键信息（开/关）', () => {
      debugMode = !debugMode
      toast(`按键诊断已${debugMode ? '开启' : '关闭'}`)
      if (debugMode) {
        debugLog('诊断已开启，在视频页按一次快捷键查看按键信息')
      } else {
        const el = document.getElementById('bcc-debug')
        if (el) {
          el.remove()
        }
      }
    })
    GM_registerMenuCommand('复制诊断信息到剪贴板（字幕异常点这里）', async () => {
      const hadPanel = !!document.querySelector(SEL_CLOSE)
      logEvent('diag', `菜单触发 面板已渲染=${hadPanel}`)
      // 面板没渲染时先留一份原始现场, 再唤醒; 唤醒会点字幕按钮, 可能改变字幕状态
      const before = hadPanel ? '' : buildDiagnostics()
      await ensurePanelUsable()
      const text = hadPanel
        ? buildDiagnostics()
        : before + '\n\n########## 唤醒面板后 ##########\n' + buildDiagnostics()
      let copied = false
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text, 'text')
          copied = true
        } else {
          const area = document.createElement('textarea')
          area.value = text
          area.style.cssText = 'position:fixed;left:-9999px;top:0;'
          document.body.appendChild(area)
          area.select()
          copied = document.execCommand('copy')
          area.remove()
        }
      } catch (e) {
        copied = false
      }
      console.log('[bcc] 诊断信息\n' + text)
      if (copied) {
        debugLog(`诊断已复制（${text.length} 字符）\n完整内容在剪贴板，直接粘贴发给开发者`, true)
      } else {
        debugLog('复制失败，完整诊断已输出到控制台（F12）', true)
        toast('复制失败，请查看控制台')
      }
    })
  }

  // 首次使用写入默认值, 便于在设置面板里看到当前按键
  if (store.get(STORE_KEY, '') === '') {
    store.set(STORE_KEY, DEFAULT_HOTKEY)
  }
})()
