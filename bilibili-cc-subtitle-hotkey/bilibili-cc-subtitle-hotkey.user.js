// ==UserScript==
// @name         9527哔哩哔哩CC字幕快捷键
// @namespace    https://github.com/Godwin9527
// @version      2.0.0
// @description  完全独立的 CC 字幕开关：自己拉取字幕并渲染字幕层，不依赖 Bilibili Evolved，也不依赖 B 站字幕按钮，支持自定义按键与语言偏好
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
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      *.hdslb.com
// @connect      *.bilibili.com
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.user.js
// @updateURL    https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/bilibili-cc-subtitle-hotkey/bilibili-cc-subtitle-hotkey.meta.js
// ==/UserScript==

/**
 * 为什么不用 B 站自己的字幕按钮
 * ------------------------------------------------------------------
 * B 站的播放器控制栏只响应真实用户交互。脚本合成的 click / pointer 事件
 * (isTrusted === false) 打在字幕按钮或语言项上, 面板不会初始化, 语言也不会切换。
 * 实测: 新打开页面直接按快捷键毫无反应, 必须先手动点一次字幕按钮, 之后合成点击
 * 才「看起来」生效。player 实例上也没有 setSubtitle 一类 setter
 * (只有 addSubtitle / reloadAccess), __core() 也不再暴露 subtitleStore。
 * 所以脚本改为自己取字幕数据、自己画字幕层, 与 B 站控件彻底解耦。
 */

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

  const LAYER_ID = 'bcc-subtitle-layer'
  const PANEL_ID = 'bcc-panel-host'
  const TOAST_ID = 'bcc-toast'

  /** 页面真实 window。暴力猴带 @grant 时会沙箱化, window 是代理对象 */
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

  // ---------------------------------------------------------------- 存储

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function'

  const store = {
    get(key, fallback) {
      try {
        const value = hasGM ? GM_getValue(key, fallback) : localStorage.getItem(key)
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
        /* 存储失败不影响快捷键 */
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

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
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
    if (getTipMode() === 'self') {
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
    el._t = window.setTimeout(() => el.remove(), 15000)
  }

  // ---------------------------------------------------------------- 网络

  function httpGet(url) {
    return new Promise((resolve, reject) => {
      const done = text => resolve(text)
      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 9000,
            onload: res => {
              if (res.status >= 200 && res.status < 300) {
                done(res.responseText)
              } else {
                reject(new Error(`HTTP ${res.status}`))
              }
            },
            onerror: () => reject(new Error('network error')),
            ontimeout: () => reject(new Error('timeout')),
          })
          return
        } catch (e) {
          /* 退回 fetch */
        }
      }
      fetch(url, { credentials: 'include' })
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`)
          }
          return res.text()
        })
        .then(done)
        .catch(reject)
    })
  }

  function httpJson(url) {
    return httpGet(url).then(text => {
      try {
        return JSON.parse(text)
      } catch (e) {
        throw new Error('返回不是 JSON')
      }
    })
  }

  // ---------------------------------------------------------------- 视频信息

  function queryParam(name) {
    try {
      return new URLSearchParams(location.search).get(name) || ''
    } catch (e) {
      return ''
    }
  }

  function bvidFromUrl() {
    const matched = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)
    return matched ? matched[1] : ''
  }

  /** 从页面状态里取 bvid / cid / ep_id, 取不到再退回接口 */
  async function resolveVideo() {
    const info = { bvid: '', cid: 0, epId: 0, title: '' }
    let state = null
    try {
      state = pageWindow.__INITIAL_STATE__ || null
    } catch (e) {
      state = null
    }
    if (state) {
      try {
        const vd = state.videoData || {}
        info.bvid = vd.bvid || state.bvid || ''
        info.cid = Number(vd.cid || state.cid || 0)
        info.title = vd.title || ''
        if (state.epInfo) {
          info.epId = Number(state.epInfo.ep_id || 0)
          info.cid = Number(state.epInfo.cid || info.cid || 0)
          info.title = info.title || state.epInfo.share_copy || ''
        }
        if (state.h1Title) {
          info.title = info.title || String(state.h1Title)
        }
      } catch (e) {
        /* 页面状态结构变化时忽略 */
      }
    }
    if (!info.bvid) {
      info.bvid = bvidFromUrl()
    }
    // 多 P 时以 URL 的 p 为准, 页面状态里的 cid 未必跟着切
    const p = Number(queryParam('p') || 1)
    if (info.bvid && (p > 1 || !info.cid)) {
      try {
        const json = await httpJson(
          `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(info.bvid)}`,
        )
        const data = json && json.data
        if (data) {
          const pages = Array.isArray(data.pages) ? data.pages : []
          const page = pages[p - 1]
          if (page && page.cid) {
            info.cid = Number(page.cid)
          } else if (data.cid) {
            info.cid = Number(data.cid)
          }
          info.title = info.title || data.title || ''
        }
      } catch (e) {
        /* 取不到就用页面状态里的 cid */
      }
    }
    return info
  }

  // ---------------------------------------------------------------- 字幕数据

  const subtitleCache = new Map()

  function cacheKeyOf(info) {
    return `${info.bvid}|${info.cid}|${info.epId}`
  }

  /** 拉字幕列表 */
  async function fetchSubtitleList(info) {
    const params = new URLSearchParams()
    if (info.bvid) {
      params.set('bvid', info.bvid)
    }
    if (info.cid) {
      params.set('cid', String(info.cid))
    }
    if (info.epId) {
      params.set('ep_id', String(info.epId))
    }
    const json = await httpJson(
      `https://api.bilibili.com/x/player/v2?${params.toString()}`,
    )
    if (!json || json.code !== 0 || !json.data) {
      throw new Error(`接口返回 code=${json && json.code}`)
    }
    const subtitle = json.data.subtitle || {}
    const list = Array.isArray(subtitle.subtitles) ? subtitle.subtitles : []
    return list
      .filter(item => item && item.subtitle_url)
      .map(item => ({
        lan: String(item.lan || '').toLowerCase(),
        lanDoc: String(item.lan_doc || ''),
        url: normalUrl(item.subtitle_url),
      }))
  }

  function normalUrl(url) {
    const text = String(url || '')
    if (!text) {
      return ''
    }
    if (text.startsWith('//')) {
      return `https:${text}`
    }
    if (text.startsWith('http')) {
      return text
    }
    return `https://${text}`
  }

  /** 拉字幕正文, 解析成按时间排序的 cue */
  async function fetchSubtitleBody(url) {
    const json = await httpJson(url)
    const body = Array.isArray(json && json.body) ? json.body : []
    const cues = []
    for (const item of body) {
      const from = Number(item.from)
      const to = Number(item.to)
      const content = String(item.content == null ? '' : item.content).trim()
      if (!content || !Number.isFinite(from) || !Number.isFinite(to)) {
        continue
      }
      cues.push({ from, to, content })
    }
    cues.sort((a, b) => a.from - b.from)
    return cues
  }

  /** 读取 B 站播放器保存的字幕语言偏好 */
  function readPlayerLangPreference() {
    for (const storageKey of ['bpx_player_profile', 'bilibili_player_settings']) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (!raw) {
          continue
        }
        const found = findSubtitleConfig(JSON.parse(raw), 0)
        if (!found) {
          continue
        }
        if (typeof found.preferred_language === 'string' && found.preferred_language) {
          return found.preferred_language
        }
        if (typeof found.lan === 'string' && found.lan) {
          return found.lan
        }
      } catch (e) {
        /* 配置损坏时继续下一个来源 */
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

  /**
   * 语言匹配优先级:
   * 1. 同语言的人工字幕 (人工优先开启时)
   * 2. 同基础语言的人工字幕 (人工优先开启时)
   * 3. 完全匹配 (含 ai- 前缀完全一致)
   * 4. 该语言的 AI 字幕
   * 5. 包含该基础语言的任意字幕
   * 6. 第一个可选字幕
   */
  function pickSubtitle(list, preference, humanFirst) {
    if (!list.length) {
      return null
    }
    const pref = String(preference || '')
      .trim()
      .toLowerCase()
    if (!pref) {
      return list[0]
    }
    const normalized = pref.replace(/^ai-/, '')
    const base = normalized.split('-')[0]
    const isHuman = item => !item.lan.startsWith('ai-')

    if (humanFirst) {
      const exactHuman = list.find(it => it.lan === normalized && isHuman(it))
      if (exactHuman) {
        return exactHuman
      }
      const sameBaseHuman = list.find(it => isHuman(it) && it.lan.split('-')[0] === base)
      if (sameBaseHuman) {
        return sameBaseHuman
      }
    }
    const exact = list.find(it => it.lan === normalized)
    if (exact) {
      return exact
    }
    const ai = list.find(it => it.lan === `ai-${base}`)
    if (ai) {
      return ai
    }
    const loose = list.find(it => it.lan.includes(base))
    if (loose) {
      return loose
    }
    return list[0]
  }

  // ---------------------------------------------------------------- 字幕引擎

  const engine = {
    active: false,
    layer: null,
    cues: [],
    index: 0,
    raf: 0,
    key: '',
    lan: '',
    lanDoc: '',
    hideStyle: null,
    loading: false,
    lastError: '',
  }

  function videoElement() {
    return document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video')
  }

  function playerContainer() {
    return (
      document.querySelector('.bpx-player-container') ||
      document.querySelector('#bilibili-player') ||
      document.querySelector('#playerWrap') ||
      document.querySelector('.bpx-player-video-area')
    )
  }

  function layerFontSize(layer) {
    const container = layer.parentElement
    const height = container ? container.getBoundingClientRect().height : 0
    const size = Math.round((height || 540) * 0.052)
    return Math.max(15, Math.min(38, size))
  }

  function mountLayer() {
    if (engine.layer && engine.layer.isConnected) {
      engine.layer.style.fontSize = `${layerFontSize(engine.layer)}px`
      return engine.layer
    }
    const container = playerContainer()
    if (!container) {
      return null
    }
    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative'
    }
    const layer = document.createElement('div')
    layer.id = LAYER_ID
    layer.style.cssText =
      'position:absolute;left:50%;transform:translateX(-50%);bottom:9%;' +
      'max-width:86%;margin:0 auto;text-align:center;pointer-events:none;' +
      'z-index:60;color:#fff;font-weight:500;line-height:1.35;' +
      'font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;' +
      'text-shadow:0 0 4px rgba(0,0,0,.95),0 1px 2px rgba(0,0,0,.95),' +
      '1px 0 1px rgba(0,0,0,.85),-1px 0 1px rgba(0,0,0,.85);' +
      'white-space:pre-wrap;word-break:break-word;display:none;'
    container.appendChild(layer)
    engine.layer = layer
    layer.style.fontSize = `${layerFontSize(layer)}px`
    return layer
  }

  /** 自己的字幕显示时, 把 B 站原生字幕层藏起来, 避免叠加重影 */
  function toggleNativeSubtitle(hide) {
    if (hide) {
      if (!engine.hideStyle || !engine.hideStyle.isConnected) {
        const style = document.createElement('style')
        style.id = 'bcc-hide-native-subtitle'
        style.textContent =
          '#bpx-player-subtitle-panel,.bpx-player-subtitle-panel,' +
          '.bpx-player-subtitle-wrap .bpx-player-subtitle-panel-text{' +
          'display:none !important;}'
        document.documentElement.appendChild(style)
        engine.hideStyle = style
      }
    } else if (engine.hideStyle && engine.hideStyle.isConnected) {
      engine.hideStyle.remove()
      engine.hideStyle = null
    }
  }

  function currentCueText(time) {
    const cues = engine.cues
    if (!cues.length) {
      return ''
    }
    let idx = engine.index
    if (idx >= cues.length) {
      idx = cues.length - 1
    }
    while (idx + 1 < cues.length && cues[idx + 1].from <= time) {
      idx++
    }
    while (idx > 0 && cues[idx].from > time) {
      idx--
    }
    engine.index = idx
    const cue = cues[idx]
    if (cue && time >= cue.from && time < cue.to) {
      return cue.content
    }
    return ''
  }

  function tick() {
    if (!engine.active) {
      return
    }
    const layer = engine.layer
    const video = videoElement()
    if (layer && video) {
      const text = currentCueText(video.currentTime)
      if (layer.textContent !== text) {
        layer.textContent = text
      }
      if (layer.style.fontSize === '') {
        layer.style.fontSize = `${layerFontSize(layer)}px`
      }
    }
    engine.raf = window.requestAnimationFrame(tick)
  }

  function startLoop() {
    if (engine.raf) {
      return
    }
    engine.raf = window.requestAnimationFrame(tick)
  }

  function stopLoop() {
    if (engine.raf) {
      window.cancelAnimationFrame(engine.raf)
      engine.raf = 0
    }
  }

  /** 加载字幕数据, 结果缓存在当前 cid 上 */
  async function ensureData() {
    if (engine.loading) {
      throw new Error('正在加载字幕')
    }
    engine.loading = true
    engine.lastError = ''
    try {
      const info = await resolveVideo()
      if (!info.cid && !info.bvid) {
        throw new Error('取不到当前视频的 cid')
      }
      const key = cacheKeyOf(info)
      let cached = subtitleCache.get(key)
      if (!cached) {
        const list = await fetchSubtitleList(info)
        if (!list.length) {
          throw new Error('EMPTY')
        }
        const preference = getLangPref() || readPlayerLangPreference()
        const target = pickSubtitle(list, preference, isHumanFirst())
        const cues = await fetchSubtitleBody(target.url)
        if (!cues.length) {
          throw new Error('EMPTY')
        }
        cached = {
          list,
          cues,
          lan: target.lan,
          lanDoc: target.lanDoc || target.lan,
        }
        subtitleCache.set(key, cached)
      }
      engine.cues = cached.cues
      engine.index = 0
      engine.key = key
      engine.lan = cached.lan
      engine.lanDoc = cached.lanDoc
      return cached
    } finally {
      engine.loading = false
    }
  }

  function showLayer() {
    const layer = mountLayer()
    if (!layer) {
      return false
    }
    engine.active = true
    layer.style.display = 'block'
    layer.style.fontSize = `${layerFontSize(layer)}px`
    toggleNativeSubtitle(true)
    startLoop()
    return true
  }

  function hideLayer() {
    engine.active = false
    stopLoop()
    if (engine.layer) {
      engine.layer.style.display = 'none'
      engine.layer.textContent = ''
    }
    toggleNativeSubtitle(false)
  }

  async function toggleSubtitle() {
    if (engine.active) {
      hideLayer()
      successTip('字幕已关闭')
      return
    }
    if (engine.loading) {
      return
    }
    try {
      const cached = await ensureData()
      if (!showLayer()) {
        engine.lastError = '没有找到播放器容器'
        toast('没有找到播放器，请等视频加载后再按')
        return
      }
      successTip(`字幕已开启（${cached.lanDoc}）`)
      debugLog(`字幕已开启 lan=${cached.lan} 条数=${cached.cues.length}`)
    } catch (e) {
      const message = String((e && e.message) || e)
      engine.lastError = message
      if (message === 'EMPTY') {
        toast('当前视频没有可用字幕')
      } else if (message === '正在加载字幕') {
        return
      } else {
        toast(`字幕加载失败：${message}`)
      }
      debugLog(`字幕加载失败: ${message}`, true)
    }
  }

  /** 视频页切换 (SPA) 时重置状态 */
  function resetForNewVideo() {
    hideLayer()
    engine.cues = []
    engine.index = 0
    engine.key = ''
    engine.lan = ''
    engine.lanDoc = ''
    engine.lastError = ''
  }

  // ---------------------------------------------------------------- 诊断

  function buildDiagnostics() {
    const info = { bvid: bvidFromUrl(), cid: 0, epId: 0 }
    try {
      const state = pageWindow.__INITIAL_STATE__ || {}
      const vd = state.videoData || {}
      info.cid = Number(vd.cid || state.cid || 0)
      if (state.epInfo) {
        info.epId = Number(state.epInfo.ep_id || 0)
        info.cid = Number(state.epInfo.cid || info.cid || 0)
      }
    } catch (e) {
      /* 忽略 */
    }
    const lines = [
      `版本: ${
        typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : 'unknown'
      }`,
      `URL: ${location.href}`,
      `沙箱: unsafeWindow=${pageWindow !== window ? '可用' : '不可用(退回 window)'}`,
      `视频: bvid=${info.bvid || '-'} cid=${info.cid || '-'} ep=${info.epId || '-'} p=${queryParam('p') || '1'}`,
      `播放器容器: ${playerContainer() ? '存在' : '不存在'}`,
      `video 元素: ${videoElement() ? '存在' : '不存在'}`,
      `字幕层: ${engine.layer && engine.layer.isConnected ? '已挂载' : '未挂载'}`,
      `当前状态: ${engine.active ? '已开启' : '已关闭'}`,
      `当前字幕: ${engine.lan || '-'} (${engine.lanDoc || '-'}) 共 ${engine.cues.length} 条`,
      `缓存视频数: ${subtitleCache.size}`,
      `最近错误: ${engine.lastError || '无'}`,
      `已缓存字幕: ${
        Array.from(subtitleCache.keys())
          .map(key => (key.length > 60 ? `${key.slice(0, 60)}…` : key))
          .join(' / ') || '无'
      }`,
    ]
    return lines.join('\n')
  }

  function copyDiagnostics() {
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
      toast('诊断信息已复制')
    } catch (e) {
      toast('复制失败，请查看控制台')
    }
    debugLog(text)
    console.log('[bcc] 诊断信息\n' + text)
  }

  // ---------------------------------------------------------------- 设置面板

  let panelHost = null
  let recording = false

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
    width: 440px; max-width: calc(100vw - 48px);
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
          <option value="auto" ${getTipMode() === 'auto' ? 'selected' : ''}>不在屏幕上提示</option>
          <option value="self" ${getTipMode() === 'self' ? 'selected' : ''}>左下角显示提示</option>
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
        keyInput.value = '请按下组合键（Esc 取消）'
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

    langSelect.value = currentLangValue().select
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
      toast('设置已保存，下次开启字幕生效')
      subtitleCache.clear()
    })

    // 只监听遮罩本身: Shadow DOM 会把内部事件 target 重定向为 host
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
    if (!combo || comboKey(combo) !== comboKey(getHotkeyValue())) {
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

  // ---------------------------------------------------------------- 跟随页面

  let lastHref = location.href

  function checkUrlChange() {
    if (location.href !== lastHref) {
      lastHref = location.href
      resetForNewVideo()
    }
  }

  window.setInterval(checkUrlChange, 800)

  window.addEventListener('resize', () => {
    if (engine.layer && engine.active) {
      engine.layer.style.fontSize = `${layerFontSize(engine.layer)}px`
    }
  })

  document.addEventListener('fullscreenchange', () => {
    window.setTimeout(() => {
      if (engine.active) {
        mountLayer()
        if (engine.layer) {
          engine.layer.style.fontSize = `${layerFontSize(engine.layer)}px`
        }
      }
    }, 300)
  })

  // ---------------------------------------------------------------- 菜单

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('设置 CC 字幕快捷键', openSettings)
    GM_registerMenuCommand('切换一次 CC 字幕', () => {
      toggleSubtitle()
    })
    GM_registerMenuCommand('复制诊断信息到剪贴板', copyDiagnostics)
    GM_registerMenuCommand('清空字幕缓存', () => {
      subtitleCache.clear()
      resetForNewVideo()
      toast('字幕缓存已清空')
    })
  }

  if (store.get(STORE_KEY, '') === '') {
    store.set(STORE_KEY, DEFAULT_HOTKEY)
  }
})()
