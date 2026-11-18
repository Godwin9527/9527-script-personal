# 9527字幕悬浮球助手

在 MissAV / Jable 的播放页挂一个可拖拽的「字幕」悬浮球，点开就能加载本地 SRT、在线搜字幕、调字幕样式和快捷键。

## 功能

- **本地字幕**：选择 `.srt` 文件即可加载，支持 `HH:MM:SS,ms` 与 `.` 分隔毫秒两种格式。
- **在线字幕**：内置两个来源
  - `站点搜索`：按当前视频番号跳转 Subtitlecat
  - `在线搜索`：调迅雷公开字幕接口，结果以列表展示，点一条即加载
- **字幕样式**：位置（距底部 0%–90%）、大小（12–72px）、颜色三项实时生效。
- **字幕偏移**：整体提前 / 延后若干秒，改动立即重算时间轴。
- **快捷键**：默认 `Z` 按住加速、`X` 快进、`C` 倒退，按键和倍率、步进秒数都可在面板里改。
- **悬浮球**：可拖拽到任意位置，位置写入 localStorage，下次打开还在原处；面板会按剩余空间自动决定向上或向下展开。

## 实现方式

- 页面播放器与脚本运行在不同 JS 上下文，脚本会注入一段 `script` 桥接代码，监听 `player` / `plyr` / `videojs` 实例与 `<video>` 媒体事件，把 `currentTime` / `paused` / `seeking` 通过 `data-*` 属性加自定义事件回传给主脚本。这样即使站点播放器不派发标准事件，字幕也能跟上。
- 字幕同步优先走原生 `addTextTrack` + `VTTCue`，由 `cuechange` 驱动；`VTTCue` 不可用时自动降级为按 `currentTime` 线性查找。
- 悬浮球用 Pointer Events 实现拖拽，位移超过 4px 判定为拖拽并吞掉随后的 click，避免拖完误触展开面板。

## 使用方法

1. 打开 MissAV 或 Jable 的播放页，右下角会出现「字幕」悬浮球（初次在左下）。
2. 点击悬浮球展开面板。
3. 点 `本地字幕` 选 SRT；或点 `在线搜索` 从结果里挑一条。
4. 按需调位置 / 大小 / 颜色 / 偏移，点 `保存设置` 持久化。
5. 点 `收起面板` 回到悬浮球状态。

## 注意事项

- 在线搜索依赖迅雷的公开接口，接口变更或限流时可能取不到结果；`站点搜索` 只是站外跳转，需要能访问 subtitlecat。
- 跨域请求通过 `GM.xmlHttpRequest` 发出，脚本管理器中需放行 `@connect` 里声明的域名。
- 视频容器和播放器结构由站点决定，站点改版后可能需要更新选择器。
- 番号解析基于 URL 路径正则，非标准路径可能取不到番号，此时在线搜索会提示失败。

## 可调参数

脚本顶部的常量可自行调整：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `FLOATING_UI_GAP` | 8 | 悬浮球与面板 / 字幕列表之间的间距（px） |
| `FLOATING_BUTTON_POSITION_KEY` | `missavFloatingButtonPosition` | 悬浮球位置在 localStorage 里的键名 |
| `VIDEO_QUERY_SELECTORS` | 见源码 | 查找 `<video>` 的优先级顺序 |
| `VIDEO_CONTAINER_SELECTORS` | 见源码 | 查找字幕挂载容器的顺序 |

## 安装

https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/subtitle-floating-ball/subtitle-floating-ball.user.js

## 更新检查

https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/subtitle-floating-ball/subtitle-floating-ball.meta.js

## 文件

| 文件 | 说明 |
| --- | --- |
| `subtitle-floating-ball.user.js` | 主脚本（安装用） |
| `subtitle-floating-ball.meta.js` | 元数据（脚本管理器检查更新用） |
| `original-backup.txt` | 改造前的原始脚本留底 |

## 版本

| 版本 | 说明 |
| --- | --- |
| 1.4.1 | 接手维护：改作者、改名、切换更新源，清理占位注释；功能未变 |

## 致谢

原始脚本作者「时光Alex」，本仓库版本仅作个人自用维护。

## License

MIT
