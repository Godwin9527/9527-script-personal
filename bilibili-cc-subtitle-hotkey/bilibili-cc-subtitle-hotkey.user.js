// ==UserScript==
// @name         9527哔哩哔哩CC字幕快捷键
// @namespace    https://github.com/Godwin9527
// @version      2.2.0
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
 * 关于「默认关闭」: B 站会恢复上次的字幕状态, 常见表现是新进视频 AI 字幕自己就开了。
 * 勾选「进入视频时自动关闭字幕」后, 每次进页面 / 切视频都会在 20 秒窗口内盯着,
 * 一旦发现字幕被打开就立刻关掉; 用户在这期间按过快捷键, 本轮观察直接让位,
 * 不会出现「手动刚打开又被脚本关掉」。
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

  let busy = false
  /** 用户最后一次手动切换字幕的时间, 自动关闭据此让位 */
  let userToggledAt = 0

  async function toggleSubtitle() {
    if (busy) {
      return
    }
    userToggledAt = Date.now()
    busy = true
    const trace = []
    try {
      trace.push('① 展开面板…')
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

  // ---------------------------------------------------------------- 自动关闭

  /** 观察窗口: B 站会在视频加载后把上次的字幕状态恢复成「开」, 需要持续盯着 */
  const AUTO_OFF_DURATION = 20000
  const AUTO_OFF_INTERVAL = 600

  let autoOffToken = 0

  /**
   * 进入视频后把字幕关掉。
   * 只在真正检测到「字幕已开」时动作一次, 成功后立刻结束本轮;
   * 用户在观察窗口内按过快捷键, 就整轮让位, 不再插手。
   */
  async function autoOffWatch(reason) {
    const token = ++autoOffToken
    if (!isAutoOff() || !isEnabled()) {
      return
    }
    const startedAt = Date.now()
    let attempts = 0
    while (Date.now() - startedAt < AUTO_OFF_DURATION) {
      if (token !== autoOffToken || !isAutoOff()) {
        return
      }
      if (userToggledAt > startedAt) {
        return
      }
      const state = getState()
      if (state.closeSwitch && state.off === false) {
        attempts++
        state.closeSwitch.click()
        await sleep(260)
        if (token !== autoOffToken) {
          return
        }
        if (getState().off === true) {
          console.log('[bcc] 已自动关闭字幕', reason)
          return
        }
        // 连点几次都没反应就收手, 避免在面板异常时反复点击
        if (attempts >= 3) {
          console.log('[bcc] 自动关闭失败, 已停止重试')
          return
        }
      }
      await sleep(AUTO_OFF_INTERVAL)
    }
  }

  /** 等播放器渲染出来再开始观察, 避免在 DOM 还没就绪时白白耗掉窗口 */
  function startAutoOff(reason) {
    if (!isAutoOff() || !isEnabled()) {
      return
    }
    window.setTimeout(() => {
      autoOffWatch(reason)
    }, 800)
  }

  function whenDomReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true })
    } else {
      fn()
    }
  }

  // ---------------------------------------------------------------- 诊断


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
      `字幕按钮节点: ${allPanels} 个, rect=${rect(document.querySelector(SEL_BTN))}`,
      `close-switch: ${state.closeSwitch ? '存在' : '不存在'} rect=${rect(state.closeSwitch)}`,
      `close-switch class: ${state.closeSwitch ? String(state.closeSwitch.className) : '-'}`,
      `语言项: 全部 ${allItems} / major ${majorItems} / 可见 ${visibleItems}`,
      `语言项 lan: ${queryItems().map(el => lanOf(el)).join(', ') || '(空)'}`,
      `字幕文本层: ${document.querySelectorAll('.bpx-player-subtitle-wrap').length} 个`,
      `当前判定: ${state.off === null ? '面板未渲染' : state.off ? '字幕已关' : '字幕已开'}`,
      `自动关闭: ${isAutoOff() ? '开启' : '关闭'}`,
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
      startAutoOff('设置已保存')
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

  // 用户自己点字幕按钮 / 语言项也算主动操作, 自动关闭不再插手
  document.addEventListener(
    'click',
    e => {
      if (!e.isTrusted) {
        return
      }
      const target = e.target
      if (
        target instanceof Element &&
        target.closest('.bpx-player-ctrl-subtitle, .bpx-player-ctrl-subtitle-box')
      ) {
        userToggledAt = Date.now()
      }
    },
    true,
  )

  // ---------------------------------------------------------------- 跟随页面

  whenDomReady(() => {
    startAutoOff('首次加载')
  })

  let lastHref = location.href

  window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href
      startAutoOff('切换视频')
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
