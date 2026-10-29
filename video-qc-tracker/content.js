/**
 * content.js —— 注入页面，检测视频、提取任务ID、上报质检开始
 * 修复：同一video换src、SPA切换任务、Shadow DOM、iframe
 */

const recordedVideos = new Set();
let scanScheduled = false;
let observer = null;
let foundVideo = false;
let lastUrl = location.href;

function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "未知";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function getVideoId(video) {
  const src = video.currentSrc || video.src || "";
  return src || location.href;
}

/**
 * 从页面文本中提取任务编号（格式如 20260910_133626）
 */
function extractTaskFromPage() {
  try {
    const text = document.body.innerText || "";
    const match = text.match(/\b(\d{8}_\d{4,})\b/);
    if (match) return match[1];
  } catch (e) {}
  return null;
}

/**
 * 视频源基础路径（去掉查询参数，用于去重；blob URL 取 origin）
 */
function getVideoSourceBase(video) {
  const src = video.currentSrc || video.src || "";
  if (!src) return "";
  if (src.startsWith("blob:")) {
    try { return "blob:" + new URL(src).origin; } catch { return "blob"; }
  }
  try {
    const u = new URL(src);
    return u.origin + u.pathname;
  } catch {
    return src;
  }
}

function extractTaskId() {
  try {
    const params = new URLSearchParams(location.search);
    const candidates = [
      "taskId", "task_id", "taskid", "id", "videoId", "video_id",
      "vid", "taskNo", "task_no", "qcId", "qc_id", "jobId", "job_id"
    ];
    for (const key of candidates) {
      const val = params.get(key);
      if (val) return val;
    }
    const match = location.pathname.match(/\/(?:task|video|qc|job|detail)\/([^\/?#]+)/i);
    if (match) return match[1];
  } catch (e) {}
  return null;
}

function reportVideo(video, videoId) {
  if (recordedVideos.has(videoId)) return;
  if (!isFinite(video.duration) || video.duration <= 0) return;

  recordedVideos.add(videoId);
  foundVideo = true;

  const data = {
    url: location.href,
    title: document.title,
    videoSrc: video.currentSrc || video.src || "",
    videoSrcBase: getVideoSourceBase(video),
    taskFromPage: extractTaskFromPage(),
    videoDuration: video.duration,
    videoDurationText: formatDuration(video.duration),
    taskId: extractTaskId(),
    timestamp: new Date().toISOString(),
    timestampText: new Date().toLocaleString("zh-CN")
  };

  chrome.runtime.sendMessage({ type: "VIDEO_DETECTED", data });
}

/**
 * 处理单个 video：所有事件回调都实时计算 videoId，不使用闭包旧值
 */
function handleVideo(video) {
  const tryReport = () => {
    const videoId = getVideoId(video);
    if (recordedVideos.has(videoId)) return;
    if (!isFinite(video.duration) || video.duration <= 0) return;
    reportVideo(video, videoId);
  };

  tryReport();

  video.addEventListener("loadedmetadata", tryReport);
  video.addEventListener("canplay", tryReport);
  video.addEventListener("durationchange", tryReport);
  video.addEventListener("play", tryReport);
  video.addEventListener("loadstart", tryReport);
}

function findAllVideos(root) {
  const results = [];
  if (!root) return results;
  try {
    if (root.querySelectorAll) {
      root.querySelectorAll("video").forEach((v) => results.push(v));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) results.push(...findAllVideos(el.shadowRoot));
      });
    }
  } catch (e) {}
  return results;
}

function scanVideos() {
  if (document.hidden) return;
  findAllVideos(document).forEach(handleVideo);
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

// ============ 检测策略 ============

scanVideos();
[1000, 3000, 5000, 10000, 20000].forEach((t) => setTimeout(scanVideos, t));

observer = new MutationObserver(() => scheduleScan());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("play", (e) => {
  if (e.target && e.target.tagName === "VIDEO") handleVideo(e.target);
}, true);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleScan();
});

// SPA URL 变化时清空本地去重缓存，重新扫描
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    recordedVideos.clear();
    setTimeout(scanVideos, 500);
    setTimeout(scanVideos, 2000);
  }
}, 800);

setTimeout(() => {
  if (!foundVideo && observer) {
    observer.disconnect();
    observer = null;
  }
}, 30000);
