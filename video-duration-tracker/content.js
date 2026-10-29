/**
 * content.js —— 注入页面：检测 video 时长 + 审核通过/不通过
 * iframe 只跑轻量视频检测；悬浮球 / SPA 导航修补仅顶层。
 * 免责声明：该程序由XZQ开发，仅供参考使用
 */
/* global VDTShared, chrome */

const S = VDTShared;

const recordedVideos = new Set();
const boundVideos = new WeakSet();
const shadowRoots = new Set();
let scanScheduled = false;
let observer = null;
let foundVideo = false;
let lastUrl = location.href;
let shadowPatched = false;
let idleWatchdog = null;
let recordIdMapping = {};

// 页面加载时读取记录编号映射表
try {
  chrome.storage.local.get(["recordIdMapping"], (result) => {
    if (chrome.runtime.lastError) return;
    recordIdMapping = result.recordIdMapping || {};
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.recordIdMapping) {
      recordIdMapping = changes.recordIdMapping.newValue || {};
    }
  });
} catch {
  /* ignore */
}

const isTopFrame = (() => {
  try {
    return window.top === window;
  } catch {
    return false;
  }
})();

function formatDuration(seconds) {
  return S.formatDuration(seconds);
}

function getVideoId(video) {
  return S.getVideoId(video) || location.href;
}

function extractTaskFromPage() {
  return S.extractTaskId(document, location.href, document.title);
}

function extractRecordIdFromPage() {
  return S.extractRecordId(document, location.href, document.title);
}

/**
 * 从页面提取更有意义的视频标题（优先任务目标，其次页面标题）
 * 适配 AC 平台：页面中有"任务目标"标签，后面跟着任务名称
 */
function extractVideoTitle() {
  try {
    // 方法1：查找"任务目标"标签后面的文本
    const allElements = document.querySelectorAll("label, span, div, p, td, th, strong, b");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      const text = String(el.textContent || "").trim();
      if (text !== "任务目标" && text !== "任务名称" && text !== "视频标题") continue;
      if (el.children.length > 2) continue;

      // 找同级后面的元素或父容器内的标题元素
      let container = el.closest('[class*="form"], [class*="row"], [class*="item"], [class*="field"], [class*="group"], [class*="card"], tr, li, div');
      if (!container) container = el.parentElement;
      if (!container) continue;

      // 在容器内找可能的标题文本（排除标签本身）
      const candidates = container.querySelectorAll("strong, b, h1, h2, h3, h4, span, div");
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j];
        if (c === el) continue;
        const val = String(c.textContent || "").trim();
        if (val && val !== text && val.length > 1 && val.length < 100 && !val.includes("任务目标") && !val.includes("任务名称")) {
          return val;
        }
      }
    }

    // 方法2：AC平台特定结构 - 查找"单条质检任务"标题下方的任务名
    const pageText = String(document.body ? document.body.textContent : "").slice(0, 8000);
    const taskMatch = pageText.match(/任务目标[\s\S]{0,5}?([^\n，。；]{2,80})/);
    if (taskMatch) {
      const name = taskMatch[1].trim();
      if (name && name.length > 1 && name.length < 100) return name;
    }
  } catch {
    /* ignore */
  }
  return document.title;
}

// 从审核详情页URL中提取任务ID（如 /review/my-tasks/35133 中的 35133）
function getTaskIdFromUrl() {
  const match = location.href.match(/\/my-tasks\/(\d+)/i);
  if (match) return match[1];
  const match2 = location.href.match(/\/review\/[^/]*\/(\d+)/i);
  if (match2) return match2[1];
  return null;
}

// 从映射表中根据任务ID查找记录编号
function getRecordIdFromMapping() {
  const taskId = getTaskIdFromUrl();
  if (taskId && recordIdMapping[taskId]) {
    return recordIdMapping[taskId];
  }
  return null;
}

// 扫描"我的审核任务"列表页，建立任务ID到记录编号的映射表
function scanRecordIdMapping() {
  if (!isTopFrame) return;
  // 检测页面是否有"记录编号"表头
  const headers = document.querySelectorAll("th, [class*='header'], [class*='title']");
  let hasRecordIdHeader = false;
  for (let i = 0; i < headers.length; i++) {
    const text = headers[i].textContent || "";
    if (text.includes("记录编号") || text.includes("录制编号")) {
      hasRecordIdHeader = true;
      break;
    }
  }
  if (!hasRecordIdHeader) return;

  // 扫描表格行
  const rows = document.querySelectorAll("tr, [class*='row'], [class*='item']");
  const mapping = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let recordId = null;
    let taskId = null;

    // 从行文本中提取记录编号
    const rowText = row.textContent || "";
    const recordMatch = rowText.match(/\b(R\d{8}[a-zA-Z]+\d{4,})\b/);
    if (recordMatch) {
      recordId = recordMatch[1];
    }

    // 从行中的链接提取任务ID
    const links = row.querySelectorAll("a[href]");
    for (let j = 0; j < links.length; j++) {
      const href = links[j].href || "";
      const taskMatch = href.match(/\/my-tasks\/(\d+)/i);
      if (taskMatch) {
        taskId = taskMatch[1];
        break;
      }
    }

    // 如果没有链接，尝试从按钮的data属性或onclick中提取
    if (!taskId) {
      const buttons = row.querySelectorAll("button, [class*='btn'], [class*='action']");
      for (let j = 0; j < buttons.length; j++) {
        const btn = buttons[j];
        const dataId = btn.dataset.taskId || btn.dataset.id || btn.getAttribute("data-task-id") || btn.getAttribute("data-id");
        if (dataId && /^\d+$/.test(dataId)) {
          taskId = dataId;
          break;
        }
        const onclick = btn.getAttribute("onclick") || "";
        const onclickMatch = onclick.match(/(\d{4,})/);
        if (onclickMatch) {
          taskId = onclickMatch[1];
          break;
        }
      }
    }

    if (recordId && taskId) {
      mapping[taskId] = recordId;
    }
  }

  // 存储映射表
  if (Object.keys(mapping).length > 0) {
    try {
      chrome.storage.local.get(["recordIdMapping"], (result) => {
        if (chrome.runtime.lastError) return;
        const existing = result.recordIdMapping || {};
        const merged = { ...existing, ...mapping };
        chrome.storage.local.set({ recordIdMapping: merged }, () => {
          void chrome.runtime.lastError;
        });
      });
    } catch {
      /* ignore */
    }
  }
}

function getVideoSourceBase(video) {
  return S.getVideoSourceBase(video);
}

/**
 * 从页面提取"采集时长"（AC平台页面直接显示了视频时长，如"1200秒"）
 * 作为视频 duration 的备选，解决视频动态加载导致 duration 获取不到的问题
 */
function extractDurationFromPage() {
  try {
    // 方法1：查找"采集时长"标签后面的数值
    const allElements = document.querySelectorAll("label, span, div, p, td, th, strong, b");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      const text = String(el.textContent || "").trim();
      if (text !== "采集时长" && text !== "视频时长" && text !== "录制时长") continue;
      if (el.children.length > 3) continue;

      // 找同级后面的元素或父容器内的数值
      let container = el.closest('[class*="form"], [class*="row"], [class*="item"], [class*="field"], [class*="group"], [class*="card"], tr, li, div');
      if (!container) container = el.parentElement;
      if (!container) continue;

      const containerText = String(container.textContent || "");
      // 匹配 "1200秒" 或 "1200 秒" 或纯数字
      const match = containerText.match(/(\d+(?:\.\d+)?)\s*秒/);
      if (match) {
        const seconds = parseFloat(match[1]);
        if (isFinite(seconds) && seconds > 0) return seconds;
      }
    }

    // 方法2：在页面文本中查找"采集时长"附近的数字
    const pageText = String(document.body ? document.body.textContent : "").slice(0, 10000);
    const idx = pageText.indexOf("采集时长");
    if (idx >= 0) {
      const nearby = pageText.substring(idx, idx + 100);
      const match = nearby.match(/(\d+(?:\.\d+)?)\s*秒/);
      if (match) {
        const seconds = parseFloat(match[1]);
        if (isFinite(seconds) && seconds > 0) return seconds;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function reportDuration(video, videoId, durationOverride) {
  if (recordedVideos.has(videoId)) return;

  // 优先用 video.duration，其次用页面采集时长
  let duration = durationOverride;
  if (video && isFinite(video.duration) && video.duration > 0) {
    duration = video.duration;
  }
  if (!duration || !isFinite(duration) || duration <= 0) {
    duration = extractDurationFromPage();
  }
  if (!duration || !isFinite(duration) || duration <= 0) return;

  foundVideo = true;

  // 记录编号功能已暂时关闭，待后续优化后再开启
  const recordId = null;

  const data = {
    url: location.href,
    title: extractVideoTitle(),
    videoSrc: video ? (video.currentSrc || video.src || "") : "",
    videoSrcBase: video ? getVideoSourceBase(video) : "",
    taskFromPage: extractTaskFromPage(),
    recordId: recordId,
    duration: duration,
    durationText: formatDuration(duration),
    timestamp: new Date().toISOString(),
    timestampText: new Date().toLocaleString("zh-CN")
  };

  try {
    chrome.runtime.sendMessage({ type: "VIDEO_DURATION", data }, () => {
      const err = chrome.runtime.lastError;
      // 只有消息成功送达才标记为已记录；发送失败则保留重试机会
      if (!err) {
        recordedVideos.add(videoId);
      }
    });
  } catch {
    // extension context invalidated，不标记，允许后续事件重试
  }
}

function handleVideo(video) {
  if (!video) return;
  const tryReport = () => {
    const videoId = getVideoId(video);
    if (recordedVideos.has(videoId)) return;
    // 优先用 video.duration，其次用页面采集时长
    if (S.shouldReportVideo(video)) {
      reportDuration(video, videoId);
    } else {
      // video.duration 没准备好，尝试用页面采集时长
      const pageDuration = extractDurationFromPage();
      if (pageDuration) {
        reportDuration(video, videoId, pageDuration);
      }
    }
  };

  tryReport();
  if (boundVideos.has(video)) return;
  boundVideos.add(video);

  video.addEventListener("loadedmetadata", tryReport);
  video.addEventListener("canplay", tryReport);
  video.addEventListener("durationchange", tryReport);
  video.addEventListener("play", tryReport);
  video.addEventListener("loadstart", tryReport);
  // AC平台视频动态加载src，增加 sourceopen 事件监听
  video.addEventListener("sourceopen", tryReport);
}

function trackShadow(sr) {
  if (!sr || shadowRoots.has(sr)) return;
  shadowRoots.add(sr);
  if (observer) {
    try {
      observer.observe(sr, { childList: true, subtree: true });
    } catch {
      /* closed or detached */
    }
  }
}

function discoverExistingShadows(root, limit) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let seen = 0;
  let el = walker.currentNode;
  if (el && el.nodeType === 1 && el.shadowRoot) trackShadow(el.shadowRoot);
  while (seen < limit && (el = walker.nextNode())) {
    seen++;
    if (el.shadowRoot) trackShadow(el.shadowRoot);
  }
}

function patchAttachShadow() {
  if (shadowPatched) return;
  const proto = Element.prototype;
  if (proto.__vdtAttachPatched) {
    shadowPatched = true;
    return;
  }
  const orig = proto.attachShadow;
  proto.attachShadow = function patchedAttachShadow(init) {
    const sr = orig.call(this, init);
    if (sr && (!init || init.mode === "open")) trackShadow(sr);
    return sr;
  };
  proto.__vdtAttachPatched = true;
  shadowPatched = true;
}

function findAllVideos() {
  const results = [];
  try {
    document.querySelectorAll("video").forEach((v) => results.push(v));
    shadowRoots.forEach((sr) => {
      try {
        sr.querySelectorAll("video").forEach((v) => results.push(v));
      } catch {
        shadowRoots.delete(sr);
      }
    });
  } catch {
    /* document tearing down */
  }
  return results;
}

function scanVideos() {
  if (document.hidden) return;
  findAllVideos().forEach(handleVideo);
}

/**
 * 强制扫描：每2秒检查所有video元素，确保正在播放的视频一定能被记录
 * 解决 AC 平台自定义播放器 video 元素加载时机不确定的问题
 */
let forceScanTimer = null;
function startForceScan() {
  if (forceScanTimer) return;
  forceScanTimer = setInterval(() => {
    if (document.hidden) return;
    const videos = findAllVideos();
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoId = getVideoId(video);
      if (recordedVideos.has(videoId)) continue;
      if (video && !video.paused && video.readyState >= 2) {
        if (isFinite(video.duration) && video.duration > 0) {
          reportDuration(video, videoId);
        } else {
          // duration 没准备好，尝试用页面采集时长
          const pageDuration = extractDurationFromPage();
          if (pageDuration) {
            reportDuration(video, videoId, pageDuration);
          } else if (!boundVideos.has(video)) {
            boundVideos.add(video);
            const onReady = () => {
              if (!recordedVideos.has(videoId) && isFinite(video.duration) && video.duration > 0) {
                reportDuration(video, videoId);
              }
            };
            video.addEventListener("durationchange", onReady);
            video.addEventListener("loadedmetadata", onReady);
          }
        }
      } else if (isFinite(video.duration) && video.duration > 0) {
        handleVideo(video);
      } else {
        // 视频没在播放且duration没准备好，也尝试用页面采集时长
        const pageDuration = extractDurationFromPage();
        if (pageDuration) {
          reportDuration(video, videoId, pageDuration);
        }
      }
    }
  }, 2000);
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  const doScan = () => {
    scanScheduled = false;
    scanVideos();
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(doScan, { timeout: 2000 });
  } else {
    setTimeout(doScan, 300);
  }
}

function onUrlChanged() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  recordedVideos.clear();
  foundVideo = false;
  // URL 变化后增加更多扫描重试，适配 AC 平台 SPA
  [300, 800, 1500, 2500, 4000, 6000, 10000].forEach((t) => setTimeout(scanVideos, t));
  // 扫描列表页的记录编号映射
  setTimeout(scanRecordIdMapping, 800);
  setTimeout(scanRecordIdMapping, 2500);
  if (!observer) startObserver();
}

function patchHistory() {
  if (!isTopFrame) return;
  const fire = () => onUrlChanged();
  window.addEventListener("popstate", fire);
  window.addEventListener("hashchange", fire);
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    try {
      window.navigation.addEventListener("navigate", fire);
    } catch {
      /* ignore */
    }
  }
  const wrap = (name) => {
    const orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function patchedHistory() {
      const ret = orig.apply(this, arguments);
      fire();
      return ret;
    };
  };
  wrap("pushState");
  wrap("replaceState");
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => scheduleScan());
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    shadowRoots.forEach((sr) => {
      try {
        observer.observe(sr, { childList: true, subtree: true });
      } catch {
        /* ignore */
      }
    });
  } catch {
    observer = null;
  }
}

function stopObserver() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
}

function initVideoDetection() {
  patchAttachShadow();
  if (document.documentElement) {
    discoverExistingShadows(document.documentElement, 4000);
  }
  scanVideos();
  // 增加更多扫描时间点，适配 AC 平台 SPA 动态加载视频
  [500, 1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000].forEach((t) => setTimeout(scanVideos, t));
  // 启动定时强制扫描，确保正在播放的视频一定能被记录
  startForceScan();
  // 扫描列表页的记录编号映射
  [500, 1500, 3000, 6000].forEach((t) => setTimeout(scanRecordIdMapping, t));
  startObserver();
  document.addEventListener("play", (e) => {
    if (e.target && e.target.tagName === "VIDEO") handleVideo(e.target);
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopObserver();
    } else {
      startObserver();
      scheduleScan();
    }
  });
  // AC 平台适配：监听页面可见性恢复后立即扫描
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      [300, 800, 1500].forEach((t) => setTimeout(scanVideos, t));
    }
  });
  idleWatchdog = setTimeout(() => {
    idleWatchdog = null;
    if (!foundVideo) stopObserver();
  }, 45000);
}

const PENDING_REVIEW_KEY = "vdtPendingReview";

function listenReviewSubmit() {
  document.addEventListener("click", (e) => {
    if (!S.isSubmitReviewButton(e.target)) return;

    const buildData = (result) => {
      if (!result) return null;
      const sessionId = S.extractTaskId(document, location.href, document.title);
      return {
        result,
        sessionId,
        url: location.href,
        title: document.title,
        nonce: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        timestamp: new Date().toISOString(),
        timestampText: new Date().toLocaleString("zh-CN")
      };
    };

    const persistAndSend = (data) => {
      if (!data) return;
      // 通道1：直接发消息（快速路径）
      try {
        chrome.runtime.sendMessage({ type: "REVIEW_RESULT", data }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        /* ignore */
      }
      // 通道2：持久化到 storage（页面立即跳转、消息丢失时由 background 兜底）
      try {
        chrome.storage.local.get([PENDING_REVIEW_KEY], (res) => {
          if (chrome.runtime.lastError) return;
          const queue = Array.isArray(res[PENDING_REVIEW_KEY]) ? res[PENDING_REVIEW_KEY] : [];
          queue.push(data);
          chrome.storage.local.set({ [PENDING_REVIEW_KEY]: queue.slice(-20) }, () => {
            void chrome.runtime.lastError;
          });
        });
      } catch {
        /* ignore */
      }
    };

    // 立即读取一次（点击瞬间，下拉框值最可靠；新平台提交后页面会立刻跳转）
    const immediate = S.readReviewResult(document);
    persistAndSend(buildData(immediate));

    // 延迟再读一次兜底（旧平台 radio 状态可能在点击后才更新），结果相同则不重复发送
    setTimeout(() => {
      const delayed = S.readReviewResult(document);
      if (delayed && delayed !== immediate) persistAndSend(buildData(delayed));
    }, 300);
  }, true);
}

initVideoDetection();
patchHistory();
listenReviewSubmit();

(function injectFloatingBall() {
  if (!isTopFrame) return;
  if (document.getElementById("vdt-floating-ball")) return;

  let hidden = false;
  let cleaned = false;
  const listeners = [];

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    listeners.push([target, type, handler, opts]);
  }

  function detachAll() {
    listeners.forEach(([target, type, handler, opts]) => {
      try {
        target.removeEventListener(type, handler, opts);
      } catch {
        /* ignore */
      }
    });
    listeners.length = 0;
  }

  chrome.storage.local.get(["vdtBallHidden"], (result) => {
    if (chrome.runtime.lastError) {
      setup();
      return;
    }
    hidden = result.vdtBallHidden === true;
    if (hidden) {
      watchRestore();
      return;
    }
    setup();
  });

  function watchRestore() {
    const listener = (changes, area) => {
      if (area !== "local") return;
      const hideChange = changes.vdtBallHidden;
      const show = hideChange && hideChange.newValue === false;
      if (show && !document.getElementById("vdt-floating-ball")) {
        hidden = false;
        chrome.storage.onChanged.removeListener(listener);
        setup();
      }
    };
    chrome.storage.onChanged.addListener(listener);
  }

  function setup() {
    if (cleaned || document.getElementById("vdt-floating-ball")) return;

    let PANEL_W = 380;
    let PANEL_H = 520;
    const MIN_W = 280;
    const MIN_H = 320;
    const GAP = 12;

    const style = document.createElement("style");
    style.textContent = `
      #vdt-floating-ball {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #1a73e8;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        font-weight: 700;
        cursor: grab;
        z-index: 2147480000;
        user-select: none;
      }
      #vdt-floating-ball:hover { background: #1557b0; }
      #vdt-floating-ball:active { cursor: grabbing; }
      #vdt-floating-ball.vdt-active { background: #0d47a1; }
      #vdt-floating-ball.vdt-dragging { cursor: grabbing; }
      #vdt-floating-panel {
        position: fixed;
        border-radius: 12px;
        overflow: hidden;
        z-index: 2147480001;
        background: #fff;
        opacity: 0;
        transform: scale(0.95);
        transition: opacity 0.18s ease, transform 0.18s ease;
        pointer-events: none;
        display: none;
      }
      #vdt-floating-panel.vdt-show {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
      }
      #vdt-floating-panel iframe {
        width: 100%;
        height: 100%;
        border: none;
        position: relative;
        z-index: 1;
      }
      #vdt-floating-panel .vdt-arrow {
        position: absolute;
        width: 14px;
        height: 14px;
        background: #fff;
        transform: rotate(45deg);
        z-index: 2;
      }
      #vdt-resize-handle {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 22px;
        height: 22px;
        cursor: nwse-resize;
        z-index: 2147480002;
        background: linear-gradient(135deg, transparent 50%, #bbb 50%, #999 100%);
        border-bottom-right-radius: 12px;
      }
      #vdt-floating-panel.vdt-resizing iframe {
        pointer-events: none;
      }
      #vdt-context-menu {
        position: fixed;
        background: #fff;
        border-radius: 8px;
        z-index: 2147480001;
        overflow: hidden;
        min-width: 120px;
        display: none;
      }
      #vdt-context-menu .vdt-menu-item {
        padding: 10px 16px;
        font-size: 13px;
        color: #333;
        cursor: pointer;
        white-space: nowrap;
      }
      #vdt-context-menu .vdt-menu-item:hover { background: #f5f5f5; }
      @media (prefers-reduced-motion: reduce) {
        #vdt-floating-panel { transition: none; }
      }
    `;
    document.documentElement.appendChild(style);

    const ball = document.createElement("div");
    ball.id = "vdt-floating-ball";
    ball.textContent = "视";
    ball.title = "视频时长记录器\n左键点击打开面板\n右键关闭悬浮球";

    const panel = document.createElement("div");
    panel.id = "vdt-floating-panel";
    panel.style.width = PANEL_W + "px";
    panel.style.height = PANEL_H + "px";
    const arrow = document.createElement("div");
    arrow.className = "vdt-arrow";
    panel.appendChild(arrow);

    let iframe = null;
    function ensureIframe() {
      if (iframe) return;
      iframe = document.createElement("iframe");
      iframe.src = chrome.runtime.getURL("popup.html");
      panel.appendChild(iframe);
    }
    function destroyIframe() {
      if (!iframe) return;
      iframe.remove();
      iframe = null;
    }

    const resizeHandle = document.createElement("div");
    resizeHandle.id = "vdt-resize-handle";
    resizeHandle.title = "拖动调整大小";
    panel.appendChild(resizeHandle);

    const contextMenu = document.createElement("div");
    contextMenu.id = "vdt-context-menu";
    const closeItem = document.createElement("div");
    closeItem.className = "vdt-menu-item";
    closeItem.textContent = "关闭悬浮球";
    contextMenu.appendChild(closeItem);

    const mountRoot = document.body || document.documentElement;
    mountRoot.appendChild(ball);
    mountRoot.appendChild(panel);
    mountRoot.appendChild(contextMenu);

    let panelOpen = false;
    let panelOffsetX = 0;
    let panelOffsetY = 0;
    let arrowSide = "right";
    let arrowTopFixed = 0;

    chrome.storage.local.get(["vdtBallPosition", "vdtPanelSize"], (result) => {
      if (chrome.runtime.lastError) return;
      if (result.vdtBallPosition) {
        const ballSize = 48;
        let x = Math.max(0, Math.min(window.innerWidth - ballSize, result.vdtBallPosition.x || 0));
        let y = Math.max(0, Math.min(window.innerHeight - ballSize, result.vdtBallPosition.y || 0));
        ball.style.right = "auto";
        ball.style.left = x + "px";
        ball.style.top = y + "px";
        ball.style.transform = "none";
      }
      if (result.vdtPanelSize) {
        PANEL_W = Math.max(MIN_W, result.vdtPanelSize.w);
        PANEL_H = Math.max(MIN_H, result.vdtPanelSize.h);
        panel.style.width = PANEL_W + "px";
        panel.style.height = PANEL_H + "px";
      }
    });

    function positionPanel() {
      const rect = ball.getBoundingClientRect();
      const ballCX = rect.left + rect.width / 2;
      const ballCY = rect.top + rect.height / 2;
      let left = rect.left - PANEL_W - GAP;
      arrowSide = "right";
      if (left < 8) {
        left = rect.right + GAP;
        arrowSide = "left";
      }
      if (left + PANEL_W > window.innerWidth - 8) {
        left = window.innerWidth - PANEL_W - 8;
      }
      let top = ballCY - PANEL_H / 2;
      if (top < 8) top = 8;
      if (top + PANEL_H > window.innerHeight - 8) {
        top = window.innerHeight - PANEL_H - 8;
      }
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panelOffsetX = left - rect.left;
      panelOffsetY = top - rect.top;
      const arrowSize = 14;
      if (arrowSide === "right") {
        arrow.style.right = -arrowSize / 2 + "px";
        arrow.style.left = "auto";
      } else {
        arrow.style.left = -arrowSize / 2 + "px";
        arrow.style.right = "auto";
      }
      arrowTopFixed = ballCY - top - arrowSize / 2;
      arrowTopFixed = Math.max(16, Math.min(PANEL_H - 30, arrowTopFixed));
      arrow.style.top = arrowTopFixed + "px";
    }

    function movePanelWithBall() {
      const rect = ball.getBoundingClientRect();
      let left = rect.left + panelOffsetX;
      let top = rect.top + panelOffsetY;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      if (left + PANEL_W > window.innerWidth - 4) left = window.innerWidth - PANEL_W - 4;
      if (top + PANEL_H > window.innerHeight - 4) top = window.innerHeight - PANEL_H - 4;
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    }

    function togglePanel() {
      if (panelOpen) {
        panelOpen = false;
        panel.classList.remove("vdt-show");
        ball.classList.remove("vdt-active");
        setTimeout(() => {
          if (!panelOpen) {
            panel.style.display = "none";
            destroyIframe();
          }
        }, 180);
      } else {
        panelOpen = true;
        ensureIframe();
        panel.style.display = "block";
        positionPanel();
        requestAnimationFrame(() => panel.classList.add("vdt-show"));
        ball.classList.add("vdt-active");
      }
    }

    let mouseDownPos = null;
    on(ball, "mousedown", (e) => {
      if (e.button === 0) mouseDownPos = { x: e.clientX, y: e.clientY };
    });
    on(ball, "click", (e) => {
      e.stopPropagation();
      if (mouseDownPos) {
        const dx = Math.abs(e.clientX - mouseDownPos.x);
        const dy = Math.abs(e.clientY - mouseDownPos.y);
        if (dx > 5 || dy > 5) return;
      }
      togglePanel();
    });

    let isDragging = false;
    let dragStartX;
    let dragStartY;
    let ballStartX;
    let ballStartY;

    function onDragMove(e) {
      if (!ball.isConnected) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
      if (!isDragging) return;
      let newX = ballStartX + dx;
      let newY = ballStartY + dy;
      newX = Math.max(0, Math.min(window.innerWidth - ball.offsetWidth, newX));
      newY = Math.max(0, Math.min(window.innerHeight - ball.offsetHeight, newY));
      ball.style.left = newX + "px";
      ball.style.top = newY + "px";
      if (panelOpen) movePanelWithBall();
    }

    function onDragUp() {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragUp);
      ball.classList.remove("vdt-dragging");
      if (isDragging) {
        const rect = ball.getBoundingClientRect();
        chrome.storage.local.set({ vdtBallPosition: { x: rect.left, y: rect.top } }, () => {
          void chrome.runtime.lastError;
        });
      }
      isDragging = false;
      dragStartX = null;
      dragStartY = null;
    }

    on(ball, "mousedown", (e) => {
      if (e.button !== 0) return;
      isDragging = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = ball.getBoundingClientRect();
      ballStartX = rect.left;
      ballStartY = rect.top;
      ball.style.right = "auto";
      ball.style.transform = "none";
      ball.classList.add("vdt-dragging");
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragUp);
      e.preventDefault();
    });

    on(window, "resize", () => {
      if (panelOpen) movePanelWithBall();
    });

    let isResizing = false;
    let resizeStartX;
    let resizeStartY;
    let resizeStartW;
    let resizeStartH;

    function onResizeMove(e) {
      if (!isResizing) return;
      const dx = e.clientX - resizeStartX;
      const dy = e.clientY - resizeStartY;
      PANEL_W = Math.max(MIN_W, resizeStartW + dx);
      PANEL_H = Math.max(MIN_H, resizeStartH + dy);
      panel.style.width = PANEL_W + "px";
      panel.style.height = PANEL_H + "px";
      const ballRect = ball.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const ballCY = ballRect.top + ballRect.height / 2;
      const arrowSize = 14;
      arrowTopFixed = ballCY - panelRect.top - arrowSize / 2;
      arrowTopFixed = Math.max(16, Math.min(PANEL_H - 30, arrowTopFixed));
      arrow.style.top = arrowTopFixed + "px";
      panelOffsetX = panelRect.left - ballRect.left;
      panelOffsetY = panelRect.top - ballRect.top;
    }

    function onResizeUp() {
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
      panel.classList.remove("vdt-resizing");
      if (isResizing) {
        isResizing = false;
        chrome.storage.local.set({ vdtPanelSize: { w: PANEL_W, h: PANEL_H } }, () => {
          void chrome.runtime.lastError;
        });
      }
    }

    on(resizeHandle, "mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      panel.classList.add("vdt-resizing");
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = PANEL_W;
      resizeStartH = PANEL_H;
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
    });

    on(ball, "contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenu.style.left = e.clientX + "px";
      contextMenu.style.top = e.clientY + "px";
      contextMenu.style.display = "block";
    });

    on(document, "click", (e) => {
      if (!contextMenu.contains(e.target)) contextMenu.style.display = "none";
    });

    function teardown() {
      cleaned = true;
      destroyIframe();
      ball.remove();
      panel.remove();
      contextMenu.remove();
      style.remove();
      detachAll();
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragUp);
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
    }

    on(closeItem, "click", () => {
      chrome.storage.local.set({ vdtBallHidden: true }, () => {
        void chrome.runtime.lastError;
      });
      teardown();
      watchRestore();
    });

    on(document, "mousedown", (e) => {
      if (panelOpen && !panel.contains(e.target) && !ball.contains(e.target)) {
        panelOpen = false;
        panel.classList.remove("vdt-show");
        ball.classList.remove("vdt-active");
        setTimeout(() => {
          if (!panelOpen) {
            panel.style.display = "none";
            destroyIframe();
          }
        }, 180);
      }
    });
  }
})();
