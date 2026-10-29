/**
 * background.js —— 存储、去重、计时、统计、导出
 */

const STORAGE_KEY = "qc_records";
const CURRENT_KEY = "qc_current";
const SETTINGS_KEY = "qc_settings";

const defaultSettings = {
  autoExport: false,
  fileName: "video_qc_report",
  failReasons: ["画面质量问题", "音频质量问题", "内容违规", "字幕错误", "格式问题", "其他"]
};

// 安装初始化
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    if (!result[SETTINGS_KEY]) {
      chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings });
    }
  });
});

// ============ 工具函数 ============

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    const keepParams = [
      "v", "id", "videoid", "video_id", "bvid", "aid", "cid",
      "taskid", "task_id", "episode_id", "media_id", "room_id", "vid"
    ];
    const toDelete = [];
    for (const key of u.searchParams.keys()) {
      if (!keepParams.includes(key.toLowerCase())) {
        toDelete.push(key);
      }
    }
    toDelete.forEach((k) => u.searchParams.delete(k));
    let result = u.toString();
    if (result.endsWith("/")) result = result.slice(0, -1);
    return result;
  } catch {
    return url;
  }
}

function makeDedupKey(record) {
  const taskPart = record.taskFromPage || record.videoSrcBase || record.taskId || normalizeUrl(record.url);
  return taskPart + "|" + Math.round(record.videoDuration);
}

// 去重：同一任务/同一视频永久只更新不新增

function formatSeconds(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// 异步锁
let isSaving = false;
const saveQueue = [];
async function withLock(fn) {
  if (isSaving) {
    await new Promise((resolve) => saveQueue.push(resolve));
  }
  isSaving = true;
  try {
    return await fn();
  } finally {
    isSaving = false;
    const next = saveQueue.shift();
    if (next) next();
  }
}

// ============ 消息路由 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "VIDEO_DETECTED":
      handleVideoDetected(message.data);
      sendResponse({ ok: true });
      break;

    case "GET_CURRENT":
      getCurrent().then((data) => sendResponse(data));
      return true;

    case "GET_RECORDS":
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        sendResponse({ records: result[STORAGE_KEY] || [] });
      });
      return true;

    case "SUBMIT_RESULT":
      submitResult(message.result, message.reason)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;

    case "PAUSE_CURRENT":
      pauseCurrent().then((r) => sendResponse(r));
      return true;

    case "RESUME_CURRENT":
      resumeCurrent().then((r) => sendResponse(r));
      return true;

    case "CLEAR_RECORDS":
      chrome.storage.local.set({ [STORAGE_KEY]: [], [CURRENT_KEY]: null });
      sendResponse({ ok: true });
      break;

    case "EXPORT_CSV":
      exportCSV();
      sendResponse({ ok: true });
      break;

    case "EXPORT_TXT":
      exportTxt();
      sendResponse({ ok: true });
      break;

    case "GET_SETTINGS":
      chrome.storage.local.get([SETTINGS_KEY], (result) => {
        sendResponse({ settings: { ...defaultSettings, ...result[SETTINGS_KEY] } });
      });
      return true;

    case "UPDATE_SETTINGS":
      chrome.storage.local.get([SETTINGS_KEY], (result) => {
        const settings = { ...defaultSettings, ...result[SETTINGS_KEY], ...message.patch };
        chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
          sendResponse({ settings });
        });
      });
      return true;
  }
  return false;
});

// ============ 核心逻辑 ============

/**
 * 视频被检测到时：同一任务重进只更新，否则新建记录并开始质检计时
 */
async function handleVideoDetected(data) {
  await withLock(async () => {
    const result = await chrome.storage.local.get([STORAGE_KEY, CURRENT_KEY]);
    const records = result[STORAGE_KEY] || [];
    const current = result[CURRENT_KEY];
    const dedupKey = makeDedupKey(data);

    // 查找相同去重键的记录（同一任务重进，永久去重）
    const dupIdx = records.findIndex((r) => {
      const key = r.dedupKey || makeDedupKey(r);
      return key === dedupKey;
    });

    let recordId;
    if (dupIdx >= 0) {
      // 同一任务重进：更新已有记录，重置计时
      recordId = records[dupIdx]._id;
      records[dupIdx] = {
        ...records[dupIdx],
        ...data,
        dedupKey,
        qcStartTime: Date.now(),
        qcPausedDuration: 0,
        result: null,
        reason: null
      };
    } else if (current && current.recordId) {
      // 有进行中的任务：更新其视频信息
      const idx = records.findIndex((r) => r._id === current.recordId);
      if (idx >= 0) {
        recordId = current.recordId;
        records[idx] = {
          ...records[idx],
          ...data,
          dedupKey,
          qcStartTime: Date.now(),
          qcPausedDuration: 0,
          result: null,
          reason: null
        };
      } else {
        recordId = String(Date.now()) + Math.random().toString(36).slice(2, 6);
        records.push({
          ...data, _id: recordId, dedupKey,
          qcStartTime: Date.now(), qcPausedDuration: 0, result: null, reason: null
        });
      }
    } else {
      // 新任务：新建记录
      recordId = String(Date.now()) + Math.random().toString(36).slice(2, 6);
      records.push({
        ...data, _id: recordId, dedupKey,
        qcStartTime: Date.now(), qcPausedDuration: 0, result: null, reason: null
      });
    }

    await chrome.storage.local.set({
      [STORAGE_KEY]: records,
      [CURRENT_KEY]: { recordId, startTime: Date.now(), paused: false, pausedDuration: 0 }
    });
  });
}

async function getCurrent() {
  const result = await chrome.storage.local.get([CURRENT_KEY, STORAGE_KEY]);
  const current = result[CURRENT_KEY];
  if (!current) return { current: null, record: null };

  const records = result[STORAGE_KEY] || [];
  const record = records.find((r) => r._id === current.recordId) || null;

  let elapsed = 0;
  if (current.paused) {
    elapsed = current.pausedDuration || 0;
  } else {
    elapsed = (Date.now() - current.startTime) - (current.pausedDuration || 0);
  }

  return { current, record, elapsed: Math.max(0, elapsed) };
}

async function pauseCurrent() {
  const result = await chrome.storage.local.get([CURRENT_KEY]);
  const current = result[CURRENT_KEY];
  if (!current || current.paused) return { ok: false };

  const elapsed = Date.now() - current.startTime;
  current.paused = true;
  current.pausedAt = Date.now();
  // 不在这里累加 pausedDuration，resume 时再算
  await chrome.storage.local.set({ [CURRENT_KEY]: current });
  return { ok: true };
}

async function resumeCurrent() {
  const result = await chrome.storage.local.get([CURRENT_KEY]);
  const current = result[CURRENT_KEY];
  if (!current || !current.paused) return { ok: false };

  const pauseLen = Date.now() - current.pausedAt;
  current.pausedDuration = (current.pausedDuration || 0) + pauseLen;
  current.paused = false;
  current.pausedAt = null;
  await chrome.storage.local.set({ [CURRENT_KEY]: current });
  return { ok: true };
}

/**
 * 提交质检结果（通过/不通过）
 */
async function submitResult(result, reason) {
  return await withLock(async () => {
    const data = await chrome.storage.local.get([CURRENT_KEY, STORAGE_KEY]);
    const current = data[CURRENT_KEY];
    if (!current) return { ok: false, error: "当前没有进行中的质检任务" };

    const records = data[STORAGE_KEY] || [];
    const idx = records.findIndex((r) => r._id === current.recordId);
    if (idx < 0) return { ok: false, error: "未找到对应记录" };

    // 计算质检耗时
    let qcDuration;
    if (current.paused) {
      qcDuration = current.pausedDuration || 0;
    } else {
      qcDuration = (Date.now() - current.startTime) - (current.pausedDuration || 0);
    }
    qcDuration = Math.max(0, Math.round(qcDuration / 1000));

    records[idx].result = result; // "pass" | "fail"
    records[idx].reason = reason || null;
    records[idx].qcDuration = qcDuration;
    records[idx].qcDurationText = formatSeconds(qcDuration);
    records[idx].submitTime = new Date().toLocaleString("zh-CN");

    await chrome.storage.local.set({
      [STORAGE_KEY]: records,
      [CURRENT_KEY]: null
    });

    return { ok: true, record: records[idx] };
  });
}

// ============ 导出 ============

function escapeCsv(str) {
  if (str == null) return "";
  const s = String(str);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function exportCSV() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  const records = result[STORAGE_KEY] || [];
  if (records.length === 0) return;

  const header = [
    "序号", "任务ID", "视频标题", "页面URL", "视频时长", "质检耗时",
    "质检结果", "不通过原因", "开始时间", "提交时间"
  ];

  const rows = records.map((r, i) => [
    i + 1,
    r.taskId || "",
    r.title || "",
    r.url,
    r.videoDurationText || "",
    r.qcDurationText || "",
    r.result === "pass" ? "通过" : r.result === "fail" ? "不通过" : "未完成",
    r.reason || "",
    r.timestampText || "",
    r.submitTime || ""
  ]);

  const csv = "\uFEFF" + [header, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url, filename: "video_qc_report.csv",
    conflictAction: "overwrite", saveAs: false
  }, () => setTimeout(() => URL.revokeObjectURL(url), 10000));
}

async function exportTxt() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  const records = result[STORAGE_KEY] || [];
  if (records.length === 0) return;

  const today = new Date().toLocaleDateString("zh-CN");
  const todayRecords = records.filter((r) => r.timestampText?.startsWith(today));
  const passCount = records.filter((r) => r.result === "pass").length;
  const failCount = records.filter((r) => r.result === "fail").length;
  const totalQcTime = records.reduce((s, r) => s + (r.qcDuration || 0), 0);

  let content = "视频质检报告\n";
  content += "=".repeat(60) + "\n";
  content += `导出时间: ${new Date().toLocaleString("zh-CN")}\n`;
  content += `总任务数: ${records.length}  通过: ${passCount}  不通过: ${failCount}\n`;
  content += `总质检耗时: ${formatSeconds(totalQcTime)}\n`;
  content += "=".repeat(60) + "\n\n";

  records.forEach((r, i) => {
    content += `[${String(i + 1).padStart(3, "0")}] ${r.title || "无标题"}\n`;
    content += `      任务ID   : ${r.taskId || "未识别"}\n`;
    content += `      视频时长 : ${r.videoDurationText || "未知"}\n`;
    content += `      质检耗时 : ${r.qcDurationText || "未完成"}\n`;
    content += `      质检结果 : ${r.result === "pass" ? "通过" : r.result === "fail" ? "不通过" : "未完成"}\n`;
    if (r.reason) content += `      不通过原因: ${r.reason}\n`;
    content += `      页面URL  : ${r.url}\n`;
    content += "-".repeat(60) + "\n";
  });

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url, filename: "video_qc_report.txt",
    conflictAction: "overwrite", saveAs: false
  }, () => setTimeout(() => URL.revokeObjectURL(url), 10000));
}
