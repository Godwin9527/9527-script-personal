// ==UserScript==
// @name         9527哔哩哔哩CC字幕快捷键
// @namespace    https://github.com/Godwin9527
// @version      1.0.2
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

  function debugLog(text) {
    if (!debugMode || !document.body) {
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

  function queryItems() {
    const major = document.querySelectorAll(SEL_MAJOR_ITEM)
    if (major.length) {
      return Array.from(major)
    }
    const box = document.querySelector('.bpx-player-ctrl-subtitle-box') || document
    return Array.from(box.querySelectorAll(SEL_ANY_ITEM)).filter(
      el => !el.closest(SEL_MINOR),
    )
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

  /**
   * 面板未渲染时先展开一次。
   * B 站现在点击字幕按钮只展开面板, 不切换字幕状态。
   * 逐级降级: 按钮 → aria-label 容器 → 按钮父级。
   */
  async function ensureCloseSwitch() {
    let close = document.querySelector(SEL_CLOSE)
    if (close) {
      return close
    }

    const candidates = []
    const pushCandidate = el => {
      if (el && !candidates.includes(el)) {
        candidates.push(el)
      }
    }
    pushCandidate(await waitFor(SEL_BTN, 400))
    pushCandidate(document.querySelector('[aria-label="字幕"]'))
    const first = candidates[0]
    if (first && first.parentElement) {
      pushCandidate(first.parentElement)
    }

    debugLog(
      `面板不存在, 候选按钮 ${candidates.length} 个\n` +
        candidates
          .map((el, i) => `${i}. ${el.tagName}.${(el.className || '').toString().slice(0, 40)}`)
          .join('\n'),
    )

    for (const el of candidates) {
      fireClickSequence(el)
      close = await waitFor(SEL_CLOSE, 700)
      if (close) {
        debugLog('唤醒成功, 面板已渲染')
        return close
      }
    }

    // 最后一轮: hover 后再点一次
    if (first) {
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      fireClickSequence(first)
      close = await waitFor(SEL_CLOSE, 800)
      if (close) {
        debugLog('hover 后唤醒成功')
        return close
      }
    }
    debugLog('唤醒失败, 没有找到字幕面板')
    return null
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

  let busy = false

  async function toggleSubtitle() {
    if (busy) {
      return
    }
    busy = true
    try {
      debugLog('① 查找字幕面板…')
      const closeSwitch = await ensureCloseSwitch()
      if (!closeSwitch) {
        debugLog('① 失败: 没有找到 .bpx-player-ctrl-subtitle-close-switch')
        toast('没有找到字幕控件，可能该视频没有字幕')
        return
      }

      // bpx-state-active 表示「关闭字幕」这一项被选中, 也就是当前字幕是关闭状态
      const isOff = closeSwitch.classList.contains('bpx-state-active')
      const items = queryItems()
      debugLog(
        `② 面板已就绪\n关闭态=${isOff}\nclass=${(closeSwitch.className || '').toString()}\n语言项=${items.length} 个: ` +
          items.map(el => lanOf(el)).join(', '),
      )

      if (!isOff) {
        closeSwitch.click()
        debugLog('③ 已点击关闭')
        successTip('字幕已关闭')
        return
      }

      if (!items.length) {
        debugLog('③ 失败: 没有可选字幕项')
        toast('当前视频没有可选字幕')
        return
      }
      const preference = getLangPref() || readPlayerLangPreference()
      const target = pickSubtitleItem(items, preference, isHumanFirst())
      if (!target) {
        debugLog('③ 失败: 语言匹配为空')
        toast('当前视频没有可选字幕')
        return
      }
      target.click()
      debugLog(`③ 已点击语言项 lan=${lanOf(target)}`)
      const label = (target.textContent || '').trim()
      successTip(label ? `字幕已开启（${label}）` : '字幕已开启')
    } finally {
      busy = false
    }
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
  }

  // 首次使用写入默认值, 便于在设置面板里看到当前按键
  if (store.get(STORE_KEY, '') === '') {
    store.set(STORE_KEY, DEFAULT_HOTKEY)
  }
})()
