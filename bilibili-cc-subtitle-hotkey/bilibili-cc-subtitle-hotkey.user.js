// ==UserScript==
// @name         9527哔哩哔哩CC字幕快捷键
// @namespace    https://github.com/Godwin9527
// @version      1.0.5
// @description  独立于 Bilibili Evolved 的 CC 字幕开关键盘快捷键，支持自定义按键、字幕语言偏好、人工字幕优先
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
// @grant        unsafeWindow
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.meta.js
// ==/UserScript==

(function () {
  'use strict'

  // ---------------------------------------------------------------- 常量

  const STORE_KEY = 'bcc.hotkey'
  const STORE_LANG = 'bcc.lang'
  const STORE_HUMAN = 'bcc.humanFirst'
  const STORE_TIP = 'bcc.tipMode'
  const STORE_ENABLED = 'bcc.enabled'

  const DEFAULT_HOTKEY = 'shift+c'
  const MODS = ['ctrl', 'alt', 'shift', 'meta']

  const SEL_CLOSE = '.bpx-player-ctrl-subtitle-close-switch'
  const SEL_BTN = '.bpx-player-ctrl-subtitle'
  const SEL_MAJOR_ITEM = '.bpx-player-ctrl-subtitle-major .bpx-player-ctrl-subtitle-language-item'
  const SEL_ANY_ITEM = '.bpx-player-ctrl-subtitle-language-item'
  const SEL_MINOR = '.bpx-player-ctrl-subtitle-minor'

  const PANEL_ID = 'bcc-panel-host'
  const TOAST_ID = 'bcc-toast'

  /**
   * 页面真实 window。
   * 暴力猴在带 @grant 时会把脚本放进沙箱, 此时 window 是代理对象,
   * 页面后来挂上去的 window.player 不一定能读到, 必须走 unsafeWindow。
   */
  const pageWindow = (() => {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
        return unsafeWindow
      }
    } catch (e) {
      /* 管理器没有 unsafeWindow */
    }
    return window
  })()

  const PLAYER_KEYS = ['player', 'playerRaw', 'bpxPlayer', '__player__']

  /** 收集所有可能是播放器实例的对象 */
  function playerCandidates() {
    const found = []
    const push = value => {
      if (value && typeof value === 'object' && found.indexOf(value) === -1) {
        found.push(value)
      }
    }
    for (const scope of [pageWindow, window]) {
      if (!scope) {
        continue
      }
      for (const key of PLAYER_KEYS) {
        try {
          push(scope[key])
        } catch (e) {
          /* 跨域代理读取失败时忽略 */
        }
      }
    }
    for (const sel of ['#bilibili-player', '.bpx-player-container', '#playerWrap']) {
      const root = document.querySelector(sel)
      if (!root) {
        continue
      }
      for (const key of Object.getOwnPropertyNames(root)) {
        if (!/player|vue|__/i.test(key)) {
          continue
        }
        try {
          push(root[key])
        } catch (e) {
          /* 忽略 */
        }
      }
    }
    return found
  }

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

  function getHotkeyValue() {
    return store.get(STORE_KEY, DEFAULT_HOTKEY)
  }

  // ---------------------------------------------------------------- 工具

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

  const forceShown = []

  /**
   * 面板已存在但被隐藏时 (实测 rect 为 0x0), 临时把祖先链上的隐藏属性顶开,
   * 让语言项变成可点击状态。4 秒后自动还原, 不污染 B 站样式。
   */
  function forceShowPanel() {
    const anchor = document.querySelector(SEL_CLOSE)
    if (!anchor) {
      return false
    }
    let node = anchor
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      try {
        const style = window.getComputedStyle(node)
        if (style.display === 'none') {
          forceShown.push([node, 'display', node.style.display])
          node.style.display = 'block'
        }
        if (style.visibility === 'hidden') {
          forceShown.push([node, 'visibility', node.style.visibility])
          node.style.visibility = 'visible'
        }
      } catch (e) {
        /* 忽略 */
      }
      node = node.parentElement
    }
    window.setTimeout(() => {
      while (forceShown.length) {
        const [el, prop, old] = forceShown.pop()
        try {
          el.style[prop] = old
        } catch (e) {
          /* 元素已移除 */
        }
      }
    }, 4000)
    return isVisible(anchor)
  }

  /** 派发完整的指针 + 鼠标 + click 事件序列, 尽量贴近真实点击 */
  function fireClickSequence(el) {
    let x = 0
    let y = 0
    try {
      const rect = el.getBoundingClientRect()
      x = Math.round(rect.left + rect.width / 2)
      y = Math.round(rect.top + rect.height / 2)
    } catch (e) {
      /* 取不到坐标就用 0 */
    }
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    }
    const opts = { ...base, buttons: 1, detail: 1 }
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(
          new PointerEvent('pointerover', { ...base, buttons: 0, pointerType: 'mouse' }),
        )
        el.dispatchEvent(
          new PointerEvent('pointerenter', {
            ...base,
            bubbles: false,
            buttons: 0,
            pointerType: 'mouse',
          }),
        )
        el.dispatchEvent(
          new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', pressure: 0.5 }),
        )
      }
      el.dispatchEvent(new MouseEvent('mouseover', { ...base, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mouseenter', { ...base, bubbles: false, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mousedown', opts))
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0, detail: 1 }))
      el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }))
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
   * 读取当前字幕状态。
   * off === true  关闭字幕这一项处于选中态, 也就是字幕当前是关的
   * off === null  面板还没渲染
   */
  function getState() {
    const closeSwitch = document.querySelector(SEL_CLOSE)
    if (!closeSwitch) {
      return { closeSwitch: null, off: null, items: [] }
    }
    return {
      closeSwitch,
      off: closeSwitch.classList.contains('bpx-state-active'),
      items: queryItems(),
    }
  }

  /** 字幕是否已开启: 关闭开关不亮, 或任一语言项处于选中态 */
  function isSubtitleOn() {
    const state = getState()
    if (!state.closeSwitch) {
      return false
    }
    if (state.off === false) {
      return true
    }
    return !!document.querySelector(`${SEL_ANY_ITEM}.bpx-state-active`)
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
        return true
      }
      fireClickSequence(el)
      if (await waitFor(SEL_CLOSE, 900)) {
        return true
      }
    }
    return false
  }

  /** 播放器内部字幕状态 (仅在可用时使用, B 站随时可能移除) */
  function getSubtitleStore() {
    for (const player of playerCandidates()) {
      if (typeof player.__core !== 'function') {
        continue
      }
      try {
        const core = player.__core()
        if (core && core.subtitleStore) {
          return core.subtitleStore
        }
      } catch (e) {
        /* 内部结构变化时忽略 */
      }
    }
    return null
  }

  /** 列出对象自身 + 原型链上的方法名 */
  function listMethods(obj, limit) {
    const names = []
    const seen = new Set()
    let cur = obj
    let depth = 0
    while (cur && cur !== Object.prototype && depth < 4) {
      for (const key of Object.getOwnPropertyNames(cur)) {
        if (key === 'constructor' || seen.has(key)) {
          continue
        }
        seen.add(key)
        try {
          if (typeof obj[key] === 'function') {
            names.push(key)
          }
        } catch (e) {
          /* getter 抛错时忽略 */
        }
      }
      cur = Object.getPrototypeOf(cur)
      depth++
    }
    return limit ? names.slice(0, limit) : names
  }

  function readStoreState(store) {
    if (!store) {
      return null
    }
    try {
      const state = store.state || store.stateDetails || null
      return state && typeof state === 'object' ? state : null
    } catch (e) {
      return null
    }
  }

  /** 汇总播放器内部字幕状态, 不可用时返回 null */
  function nativeState() {
    const store = getSubtitleStore()
    const state = readStoreState(store)
    if (!store || !state) {
      return null
    }
    const list = Array.isArray(state.languageList) ? state.languageList : []
    return {
      store,
      state,
      list,
      on: state.isclosed === false && !!state.lan,
    }
  }

  function pickLanFromList(list, preference, humanFirst) {
    if (!list.length) {
      return ''
    }
    const lanOfItem = item => String(item.lan || '').toLowerCase()
    const pref = String(preference || '')
      .trim()
      .toLowerCase()
    if (!pref) {
      return lanOfItem(list[0])
    }
    const normalized = pref.replace(/^ai-/, '')
    const base = normalized.split('-')[0]
    const isHuman = item => !lanOfItem(item).startsWith('ai-')
    if (humanFirst) {
      const exactHuman = list.find(it => lanOfItem(it) === normalized && isHuman(it))
      if (exactHuman) {
        return lanOfItem(exactHuman)
      }
      const sameBaseHuman = list.find(it => isHuman(it) && lanOfItem(it).split('-')[0] === base)
      if (sameBaseHuman) {
        return lanOfItem(sameBaseHuman)
      }
    }
    const exact = list.find(it => lanOfItem(it) === normalized)
    if (exact) {
      return lanOfItem(exact)
    }
    const ai = list.find(it => lanOfItem(it) === `ai-${base}`)
    if (ai) {
      return lanOfItem(ai)
    }
    const loose = list.find(it => lanOfItem(it).includes(base))
    return lanOfItem(loose || list[0])
  }

  /** 依次尝试匹配的方法与参数, 每次调用后校验是否真的生效 */
  async function callStore(store, namePattern, argsList, verify) {
    const names = listMethods(store, 80).filter(name => namePattern.test(name))
    let calls = 0
    for (const name of names) {
      const fn = store[name]
      if (typeof fn !== 'function') {
        continue
      }
      for (const args of argsList) {
        if (calls >= 10) {
          return ''
        }
        calls++
        try {
          fn.apply(store, args)
        } catch (e) {
          continue
        }
        await sleep(260)
        try {
          if (verify()) {
            return name
          }
        } catch (e) {
          /* 校验失败继续尝试 */
        }
      }
    }
    return ''
  }

  const NATIVE_OPEN_PATTERN = /^(set|switch|change|select|choose|update)(Lan|Language|Subtitle|Config)/i
  const NATIVE_LOOSE_PATTERN = /lan|subtitle/i
  const NATIVE_CLOSE_PATTERN = /^(close|hide|off|disable|unset|clear|stop)/i

  /** 通过播放器内部接口开启字幕, 成功返回使用的方法名 */
  async function nativeOpen() {
    const native = nativeState()
    if (!native || !native.list.length) {
      return ''
    }
    const lan = pickLanFromList(
      native.list,
      getLangPref() || readPlayerLangPreference(),
      isHumanFirst(),
    )
    if (!lan) {
      return ''
    }
    const item = native.list.find(it => String(it.lan || '').toLowerCase() === lan) || {}
    const verify = () => {
      const now = readStoreState(native.store)
      if (now && now.isclosed === false && String(now.lan || '').toLowerCase() === lan) {
        return true
      }
      return isSubtitleOn()
    }
    const argsList = [
      [{ lan }],
      [lan],
      [{ lan, subtitle_url: item.subtitle_url }],
      [{ lan, subtitle_url: item.subtitle_url, type: item.type }],
    ]
    const used = await callStore(native.store, NATIVE_OPEN_PATTERN, argsList, verify)
    if (used) {
      return used
    }
    return callStore(native.store, NATIVE_LOOSE_PATTERN, argsList, verify)
  }

  /** 通过播放器内部接口关闭字幕 */
  async function nativeClose() {
    const native = nativeState()
    if (!native) {
      return ''
    }
    const verify = () => {
      const now = readStoreState(native.store)
      if (now && now.isclosed === true) {
        return true
      }
      return getState().off === true
    }
    const used = await callStore(native.store, NATIVE_CLOSE_PATTERN, [[]], verify)
    if (used) {
      return used
    }
    return callStore(
      native.store,
      NATIVE_OPEN_PATTERN,
      [[''], [null], [{ lan: '' }]],
      verify,
    )
  }

  function describeStore() {
    const native = nativeState()
    if (!native) {
      return '播放器内部接口: 不可用'
    }
    const state = native.state
    const methods = listMethods(native.store, 40).join(',')
    return (
      `播放器内部接口: 可用\n` +
      `lan=${state.lan} isclosed=${state.isclosed} enable=${state.enable}\n` +
      `languageList=${native.list.length} 项: ${native.list
        .map(it => it.lan)
        .join(',')}\n` +
      `方法=${methods || '无'}`
    )
  }

  let busy = false

  async function toggleSubtitle() {
    if (busy) {
      return
    }
    busy = true
    const trace = []
    try {
      // ---- 第一优先: 播放器内部接口。合成点击 B 站不一定认, 内部接口不依赖点击
      trace.push('① 检查播放器内部字幕接口…')
      const native = nativeState()
      if (native) {
        trace.push(
          `  可用: 字幕=${native.on ? '已开' : '已关'} lan=${native.state.lan || '-'} 列表=${native.list.length}`,
        )
        if (native.on) {
          const used = await nativeClose()
          if (used) {
            trace.push(`② 内部接口关闭成功 (${used})`)
            debugLog(trace.join('\n'))
            successTip('字幕已关闭')
            return
          }
        } else {
          const used = await nativeOpen()
          if (used) {
            trace.push(`② 内部接口开启成功 (${used})`)
            debugLog(trace.join('\n'))
            const fresh = readStoreState(native.store)
            const label = String((fresh && fresh.lan) || '')
            successTip(label ? `字幕已开启（${label}）` : '字幕已开启')
            return
          }
        }
        trace.push('  内部接口没能完成切换, 改用界面点击')
      } else {
        trace.push('  内部接口不可用')
      }

      trace.push('③ 展开面板…')
      const panelReady = await ensurePanelUsable()
      let state = getState()
      trace.push(
        `② 面板=${panelReady ? '已就绪' : '未就绪'} 关闭态=${state.off} 语言项=${state.items.length}`,
      )

      if (!state.closeSwitch) {
        const btn = document.querySelector(SEL_BTN)
        trace.push(`② 面板没有渲染出来 (字幕按钮=${btn ? '存在' : '不存在'})`)
        if (!btn) {
          toast('当前视频没有字幕')
          return
        }
        reportFailure(trace)
        return
      }

      // ---- 关闭分支
      if (!state.off) {
        for (let i = 0; i < 4; i++) {
          const close = document.querySelector(SEL_CLOSE)
          if (!close) {
            break
          }
          close.click()
          await sleep(280)
          if (getState().off === true) {
            trace.push(`③ 已关闭字幕 (第 ${i + 1} 次点击生效)`)
            debugLog(trace.join('\n'))
            successTip('字幕已关闭')
            return
          }
        }
        trace.push('③ 关闭失败: 点击关闭开关后状态没有变化')
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
        } else if (round > 0 && !queryItems().some(isVisible)) {
          if (forceShowPanel()) {
            trace.push(`  第${round + 1}轮: 面板原本隐藏, 已临时顶开`)
          }
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
          const label = (target.textContent || '').trim()
          successTip(label ? `字幕已开启（${label}）` : '字幕已开启')
          return
        }
        trace.push(`  第${round + 1}轮: 点 ${lan} 无效, 重试`)
        await sleep(220)
      }

      if (!sawItems) {
        trace.push('③ 面板里始终没有语言项')
        toast('当前视频没有可选字幕')
        debugLog(trace.join('\n'), true)
        return
      }

      trace.push('③ 开启失败: 6 轮点击都没有生效')
      reportFailure(trace)
    } finally {
      busy = false
    }
  }

  /** 诊断信息, 供菜单「复制诊断信息」使用 */
  function buildDiagnostics() {
    const state = getState()
    const allPanels = document.querySelectorAll(SEL_BTN).length
    const allItems = document.querySelectorAll(SEL_ANY_ITEM).length
    const majorItems = document.querySelectorAll(SEL_MAJOR_ITEM).length
    const visibleItems = queryItems().filter(isVisible).length
    const rect = el => {
      if (!el) {
        return 'none'
      }
      const r = el.getBoundingClientRect()
      return `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}`
    }
    const lines = [
      `版本: ${
        typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : 'unknown'
      }`,
      `URL: ${location.href}`,
      `沙箱: unsafeWindow=${pageWindow !== window ? '可用' : '不可用(退回 window)'}`,
      `播放器实例候选: ${playerCandidates().length} 个`,
      `页面全局含 player 的键: ${
        (() => {
          try {
            return (
              Object.keys(pageWindow)
                .filter(key => /player/i.test(key))
                .join(',') || '(空)'
            )
          } catch (e) {
            return '(读取失败)'
          }
        })()
      }`,
      `字幕按钮节点: ${allPanels} 个, rect=${rect(document.querySelector(SEL_BTN))}`,
      `close-switch: ${state.closeSwitch ? '存在' : '不存在'} rect=${rect(state.closeSwitch)}`,
      `close-switch class: ${state.closeSwitch ? String(state.closeSwitch.className) : '-'}`,
      `语言项: 全部 ${allItems} / major ${majorItems} / 可见 ${visibleItems}`,
      `语言项 lan: ${queryItems().map(el => lanOf(el)).join(', ') || '(空)'}`,
      `字幕文本层: ${document.querySelectorAll('.bpx-player-subtitle-wrap').length} 个`,
      `当前判定: ${state.off === null ? '面板未渲染' : state.off ? '字幕已关' : '字幕已开'}`,
      describeStore(),
    ]
    return lines.join('\n')
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
      closeSettings()
      toast('设置已保存')
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
    e.preventDefault()
    e.stopPropagation()
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation()
    }
    toggleSubtitle()
  }

  window.addEventListener('keydown', onKeyDown, true)

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
    GM_registerMenuCommand('复制诊断信息到剪贴板', async () => {
      await ensurePanelUsable()
      const text = buildDiagnostics()
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text, 'text')
        } else {
          const area = document.createElement('textarea')
          area.value = text
          area.style.cssText = 'position:fixed;left:-9999px;top:0;'
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          area.remove()
        }
        toast('诊断信息已复制，直接粘贴发给开发者')
      } catch (e) {
        toast('复制失败，请查看控制台')
      }
      debugLog(text)
      console.log('[bcc] 诊断信息\n' + text)
    })
  }

  // 首次使用写入默认值, 便于在设置面板里看到当前按键
  if (store.get(STORE_KEY, '') === '') {
    store.set(STORE_KEY, DEFAULT_HOTKEY)
  }
})()
