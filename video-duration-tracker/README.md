# 视频时长记录器 — 浏览器插件

自动识别并记录浏览器页面中播放视频的时长，支持导出为 TXT 文件，并在审核页识别「通过 / 不通过」。

## 功能

- 自动检测页面中所有 `<video>` 元素（含 SPA 动态加载、开放 Shadow DOM、同页 iframe）
- 读取视频时长（HH:MM:SS 格式）
- 记录页面标题、URL、视频源地址、记录时间
- 同一任务 / 同一视频自动去重
- Popup 与页面悬浮球查看记录、总时长、审核统计
- 审核页点击「提交审核」后，按任务编号或特定网址中的 Session ID 写入通过 / 不通过
- 手动导出 TXT；可选「自动导出」（仅在**新增**记录时防抖下载）
- JSON 备份导入 / 导出（有体积与条数限制）

## 安装方法（Chrome / Edge）

1. 打开浏览器，地址栏输入 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本文件夹
5. 安装完成，浏览器工具栏会出现插件图标

## 使用方法

1. 正常浏览网页、播放视频，插件会自动记录时长
2. 点击工具栏图标，或点击页面右侧悬浮球打开面板
3. 右键悬浮球可关闭；可在面板中重新勾选「显示页面悬浮球」
4. 导出 TXT / JSON，或导入备份
5. 在含 `20260915_101500` 这类任务编号的审核页选择通过或不通过，再点「提交审核」

## TXT 文件保存位置

- 自动/手动导出均通过浏览器下载机制保存
- 默认保存在浏览器的「下载」文件夹中
- 文件名固定为 `video_durations.txt`，每次导出覆盖旧文件

## 文件结构

```
video-duration-recorder-audit/
├── manifest.json    # 插件配置（Manifest V3）
├── shared.js        # 共享纯逻辑（记录/审核/导出/校验）
├── content.js       # 注入页面，检测视频并读取时长
├── background.js    # 后台 Service Worker，存储与导出
├── popup.html       # 弹窗界面
├── popup.js         # 弹窗逻辑
├── popup.css        # 弹窗样式
└── README.md        # 本说明
```

## 技术说明

- 基于 Chrome Extension Manifest V3
- Content Script 通过 `loadedmetadata` / `canplay` 等事件读取 `video.duration`
- 用 `MutationObserver` + `attachShadow` 补丁发现动态视频，不再全 DOM `*` 扫描
- SPA 路由通过 `history.pushState` / `popstate` / Navigation API 感知，不用 800ms 轮询
- 数据存在 `chrome.storage.local`，默认最多保留 2000 条
- iframe 内只做轻量视频检测；悬浮球与 popup iframe 仅顶层、且面板打开才加载

## 注意事项

- 部分直播流或加密视频的 `duration` 为 `Infinity`，此类视频不会被记录
- 跨域 iframe 中的视频因浏览器安全限制可能无法读取
- 记录超过 2000 条时淘汰最旧记录，避免撑满约 10MB 的 storage 配额
