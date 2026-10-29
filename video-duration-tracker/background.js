/**
 * background.js —— Service Worker：存储记录与自动导出
 * 免责声明：该程序由XZQ开发，仅供参考使用
 */
/* global VDTShared, importScripts, chrome */
importScripts("shared.js");

const {
  STORAGE_KEY,
  SETTINGS_KEY,
  REV_KEY,
  defaultSettings,
  upsertVideoRecord,
  applyReviewResult,
  updateRecordById,
  deleteRecordById,
  buildTxtContent,
  sanitizeRecord,
  AUTO_EXPORT_DEBOUNCE_MS
} = VDTShared;

// 审核结果持久化兜底队列（content script 在页面跳转前写入，防止消息丢失）
const PENDING_REVIEW_KEY = "vdtPendingReview";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    if (chrome.runtime.lastError) return;
    if (!result[SETTINGS_KEY]) {
      chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
});

let isSaving = false;
const saveQueue = [];

function waitForSaveSlot() {
  if (!isSaving) return Promise.resolve();
  return new Promise((resolve) => saveQueue.push(resolve));
}

function releaseSaveSlot() {
  isSaving = false;
  const next = saveQueue.shift();
  if (next) next();
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function mutateRecords(mutator) {
  await waitForSaveSlot();
  isSaving = true;
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await storageGet([STORAGE_KEY, REV_KEY]);
      const rev = snap[REV_KEY] || 0;
      const current = snap[STORAGE_KEY] || [];
      const outcome = mutator(current);
      const nextRecords = outcome.records;
      try {
        await storageSet({
          [STORAGE_KEY]: nextRecords,
          [REV_KEY]: rev + 1
        });
        return outcome;
      } catch (err) {
        lastError = err;
        const again = await storageGet([REV_KEY]);
        if ((again[REV_KEY] || 0) === rev) {
          throw err;
        }
      }
    }
    throw lastError || new Error("保存失败");
  } finally {
    releaseSaveSlot();
  }
}

async function handleVideoDuration(record) {
  const outcome = await mutateRecords((records) => upsertVideoRecord(records, record));
  return { ok: true, isNew: outcome.isNew };
}

// 处理 pending 队列里残留的审核结果（页面跳转导致消息丢失时的兜底通道）
async function drainPendingReview() {
  let queue;
  try {
    const res = await storageGet([PENDING_REVIEW_KEY]);
    queue = Array.isArray(res[PENDING_REVIEW_KEY]) ? res[PENDING_REVIEW_KEY] : [];
  } catch {
    return;
  }
  if (queue.length === 0) return;
  for (const data of queue) {
    try {
      await mutateRecords((records) => applyReviewResult(records, data || {}));
    } catch {
      /* 单条失败不影响其余 */
    }
  }
  try {
    await storageSet({ [PENDING_REVIEW_KEY]: [] });
  } catch {
    /* ignore */
  }
}

// 消息通道成功后，按 nonce 从 pending 队列移除对应项，避免重复
async function removePendingByNonce(nonce) {
  if (!nonce) return;
  try {
    const res = await storageGet([PENDING_REVIEW_KEY]);
    const queue = Array.isArray(res[PENDING_REVIEW_KEY]) ? res[PENDING_REVIEW_KEY] : [];
    const filtered = queue.filter((d) => d && d.nonce !== nonce);
    if (filtered.length !== queue.length) {
      await storageSet({ [PENDING_REVIEW_KEY]: filtered });
    }
  } catch {
    /* ignore */
  }
}

// content script 写入 pending 队列时触发（延迟一点，优先让消息通道处理）
let drainTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[PENDING_REVIEW_KEY]) return;
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainPendingReview();
  }, 800);
});

// Service Worker 启动时处理历史残留
drainPendingReview();

async function exportToTxt(fileName) {
  const result = await storageGet([STORAGE_KEY]);
  const records = result[STORAGE_KEY] || [];
  if (records.length === 0) return { ok: true, skipped: true };

  const content = buildTxtContent(records);
  const dataUrl = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
  const name = fileName || defaultSettings.fileName;

  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: name,
        conflictAction: "overwrite",
        saveAs: false
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "无效消息" });
    return false;
  }

  switch (message.type) {
    case "VIDEO_DURATION":
      handleVideoDuration(message.data)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
      return true;

    case "GET_RECORDS":
      storageGet([STORAGE_KEY])
        .then((result) => {
          const raw = result[STORAGE_KEY] || [];
          // 兼容旧数据：补全 id 等字段
          const records = raw.map((r) => sanitizeRecord(r));
          // 如果有旧数据被补全了 id，回写存储
          const changed = raw.some((r, i) => r.id !== records[i].id);
          if (changed) {
            storageSet({ [STORAGE_KEY]: records, [REV_KEY]: Date.now() }).catch(() => {});
          }
          sendResponse({ records });
        })
        .catch((e) => sendResponse({ records: [], error: String(e.message || e) }));
      return true;

    case "EXPORT_TXT":
      exportToTxt(message.fileName || defaultSettings.fileName)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case "CLEAR_RECORDS":
      storageSet({ [STORAGE_KEY]: [], [REV_KEY]: Date.now() })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case "UPDATE_RECORD":
      mutateRecords((records) => {
        if (message.id) return updateRecordById(records, message.id, message.patch);
        // 兼容旧弹层若仍传 index
        const index = Number(message.index);
        if (!Number.isInteger(index) || index < 0 || index >= records.length) {
          return { ok: false, error: "记录不存在", records };
        }
        return updateRecordById(records, records[index].id, message.patch);
      })
        .then((r) => sendResponse({ ok: r.ok, error: r.error }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case "DELETE_RECORD":
      mutateRecords((records) => {
        if (message.id) return deleteRecordById(records, message.id);
        const index = Number(message.index);
        if (!Number.isInteger(index) || index < 0 || index >= records.length) {
          return { ok: false, error: "记录不存在", records };
        }
        return deleteRecordById(records, records[index].id);
      })
        .then((r) => sendResponse({ ok: r.ok, error: r.error }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case "GET_SETTINGS":
      storageGet([SETTINGS_KEY])
        .then((result) => sendResponse({ settings: { ...defaultSettings, ...(result[SETTINGS_KEY] || {}) } }))
        .catch(() => sendResponse({ settings: defaultSettings }));
      return true;

    case "UPDATE_SETTINGS":
      storageGet([SETTINGS_KEY])
        .then((result) => {
          const settings = { ...defaultSettings, ...(result[SETTINGS_KEY] || {}), ...(message.patch || {}) };
          return storageSet({ [SETTINGS_KEY]: settings }).then(() => settings);
        })
        .then((settings) => sendResponse({ settings }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case "REVIEW_RESULT":
      mutateRecords((records) => applyReviewResult(records, message.data || {}))
        .then((r) => {
          // 消息通道已处理，清理持久化队列中的同一条（避免重复）
          removePendingByNonce(message.data && message.data.nonce).catch(() => {});
          sendResponse({ ok: r.ok, matched: r.matched, index: r.index, error: r.error });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    default:
      sendResponse({ ok: false, error: "未知消息类型" });
      return false;
  }
});
