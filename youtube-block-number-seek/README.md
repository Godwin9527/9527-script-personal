# 9527YouTube数字键拦截

在 YouTube 上拦截数字键（小键盘 0-9 与主键盘 0-9），禁用其自带的“按数字跳转到视频百分比位置”快捷键，避免与接管数字键的其他扩展（如 Global Speed）互相干扰。

## 背景

- YouTube 官方快捷键：播放中按 0-9 会跳到视频 0%-90% 的位置，该行为写死在播放器里，没有官方开关。
- NumLock 开启时，小键盘数字产生的 `event.key` 与主键盘相同，因此同样会触发跳转。
- 数字键接管类扩展通常只调用了 `preventDefault()`，而 DOM 事件会分发给所有监听器，YouTube 自己的监听器照常执行，于是出现“扩展功能照常、视频却跳回开头”的现象。

## 功能

- 拦截范围：小键盘 0-9（`Numpad0`~`Numpad9`）+ 主键盘 0-9（`Digit0`~`Digit9`），可在脚本内 `BLOCK_CODES` 处自行增删。
- 在 `window` 捕获阶段拦截，早于 YouTube 挂在 `document` 上的监听器。
- 使用 `stopPropagation()` 而非 `stopImmediatePropagation()`：同在 window 层的其他扩展监听器（如 Global Speed）不受影响。
- NumLock 关闭时小键盘 `event.key` 变为 Insert / Home / End 等编辑键，自动放行，不影响小键盘编辑功能。
- 焦点在搜索框、评论框等可编辑元素时不拦截，数字输入不受影响。
- 仅拦截 `keydown`：YouTube 的百分比跳转只响应 keydown。
- 覆盖 `www.youtube.com`（含 Shorts 与内嵌 embed 播放器）和 `m.youtube.com`；YouTube 单页应用内跳转无需重新注入。

## 使用方法

1. 安装脚本后打开任意 YouTube 视频页，播放中按小键盘或主键盘数字键，视频不再跳转。
2. 需要排查拦截情况时，把脚本内 `DEBUG` 改为 `true`，在控制台查看日志。

## 注意事项

- 安装后 YouTube 原生的 0-9 百分比跳转完全失效（这正是目的）；如只想拦小键盘，从 `BLOCK_CODES` 中删除 `Digit*` 各行即可。
- 同样在 document 层监听数字键的其他脚本/扩展会被一并拦截；window 层监听的扩展（如 Global Speed）不受影响。
- 若未来 YouTube 把快捷键监听器从 document 层移到 window 层，本脚本的 `stopPropagation` 将拦不住（表现为装了仍跳转），届时需调整拦截策略。

## 安装

点击下方链接，在脚本管理器中直接安装：

https://raw.githubusercontent.com/Godwin9527/9527-script-personal/main/youtube-block-number-seek/youtube-block-number-seek.user.js

## 文件

| 文件 | 说明 |
| --- | --- |
| `youtube-block-number-seek.user.js` | 主脚本（安装用） |
| `youtube-block-number-seek.meta.js` | 元数据（脚本管理器检查更新用） |

## License

MIT
