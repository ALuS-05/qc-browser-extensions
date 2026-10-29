/**
 * popup.js —— 弹窗界面逻辑
 */
/* global VDTShared, chrome */

const S = VDTShared;

let editingId = "";
let lastRecordsJson = "";
let loadTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  loadRecords();
  loadSettings();

  // 打开插件弹窗时自动显示悬浮球
  try {
    chrome.storage.local.set({ vdtBallHidden: false }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* ignore */
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[S.STORAGE_KEY]) scheduleLoadRecords();
    if (changes[S.SETTINGS_KEY]) loadSettings();
  });

  document.getElementById("recordList").addEventListener("click", (e) => {
    const editBtn = e.target.closest(".btn-edit");
    if (editBtn) {
      openEditModal(editBtn.dataset.id);
      return;
    }
    const delBtn = e.target.closest(".btn-delete");
    if (delBtn) deleteRecord(delBtn.dataset.id);
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    exportToTxt();
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (confirm("确定要清空所有视频记录吗？此操作不可恢复。")) {
      chrome.runtime.sendMessage({ type: "CLEAR_RECORDS" }, () => {
        void chrome.runtime.lastError;
        loadRecords();
      });
    }
  });

  document.getElementById("exportDataBtn").addEventListener("click", exportData);
  document.getElementById("importDataBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", handleImportFile);

  // "更多"按钮展开/收起
  document.getElementById("moreBtn").addEventListener("click", () => {
    const content = document.getElementById("moreContent");
    const btn = document.getElementById("moreBtn");
    if (content.style.display === "none") {
      content.style.display = "block";
      btn.textContent = "⚙️ 收起";
    } else {
      content.style.display = "none";
      btn.textContent = "⚙️ 更多";
    }
  });

  document.getElementById("editCancel").addEventListener("click", closeEditModal);
  document.getElementById("editSave").addEventListener("click", saveEdit);
  document.getElementById("editModal").addEventListener("click", (e) => {
    if (e.target.id === "editModal") closeEditModal();
  });

  document.getElementById("editDuration").addEventListener("input", (e) => {
    const sec = parseInt(e.target.value, 10) || 0;
    document.getElementById("editDurationHint").textContent = S.formatSeconds(sec);
  });
});

function scheduleLoadRecords() {
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    loadTimer = null;
    loadRecords();
  }, 80);
}

function loadSettings() {
  // 设置项已简化，保留函数入口以备后续扩展
}

function loadRecords() {
  chrome.runtime.sendMessage({ type: "GET_RECORDS" }, (response) => {
    void chrome.runtime.lastError;
    const records = response?.records || [];
    renderRecords(records);
  });
}

function renderRecords(records) {
  const snapshot = JSON.stringify(records);
  if (snapshot === lastRecordsJson) return;
  lastRecordsJson = snapshot;

  const list = document.getElementById("recordList");
  const stats = S.summarizeRecords(records);
  document.getElementById("count").textContent = String(stats.count);
  document.getElementById("total").textContent = stats.totalText;
  document.getElementById("passCount").textContent = String(stats.passCount);
  document.getElementById("passTotal").textContent = stats.passTotalText;
  document.getElementById("failCount").textContent = String(stats.failCount);
  document.getElementById("failTotal").textContent = stats.failTotalText;
  document.getElementById("pendingCount").textContent = String(stats.pendingCount);

  if (records.length === 0) {
    list.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无记录，打开含视频的页面后自动记录";
    list.appendChild(empty);
    return;
  }

  const indexed = records.map((r) => r).reverse();
  const frag = document.createDocumentFragment();

  indexed.forEach((r) => {
    const status = S.reviewStatusMeta(r.reviewStatus);
    const item = document.createElement("div");
    item.className = "record-item";

    const top = document.createElement("div");
    top.className = "record-top";

    const title = document.createElement("div");
    title.className = "record-title";
    title.title = r.title || "";
    title.textContent = r.title || "无标题";

    const actions = document.createElement("div");
    actions.className = "record-actions";

    const badge = document.createElement("span");
    badge.className = "status-badge " + status.className;
    badge.title = status.title;
    badge.textContent = status.icon;

    const editBtn = document.createElement("button");
    editBtn.className = "btn-edit";
    editBtn.dataset.id = r.id || "";
    editBtn.title = "编辑";
    editBtn.textContent = "✎";

    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.dataset.id = r.id || "";
    delBtn.title = "删除";
    delBtn.textContent = "✕";

    actions.append(badge, editBtn, delBtn);
    top.append(title, actions);

    const meta = document.createElement("div");
    meta.className = "record-meta";
    const duration = document.createElement("span");
    duration.className = "duration";
    duration.textContent = r.durationText || "";
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = r.timestampText || "";
    meta.append(duration, time);

    const url = document.createElement("div");
    url.className = "record-url";
    url.title = r.url || "";
    url.textContent = r.url || "";

    if (r.recordId) {
      const recordIdEl = document.createElement("div");
      recordIdEl.className = "record-id";
      recordIdEl.textContent = "编号: " + r.recordId;
      item.append(top, meta, recordIdEl, url);
    } else {
      item.append(top, meta, url);
    }
    frag.appendChild(item);
  });

  list.replaceChildren(frag);
}

function openEditModal(id) {
  chrome.runtime.sendMessage({ type: "GET_RECORDS" }, (response) => {
    void chrome.runtime.lastError;
    const records = response?.records || [];
    const r = records.find((item) => item.id === id);
    if (!r) return;
    editingId = id;
    document.getElementById("editTitle").value = r.title || "";
    document.getElementById("editRecordId").value = r.recordId || "";
    document.getElementById("editDuration").value = Math.round(r.duration || 0);
    document.getElementById("editDurationHint").textContent = r.durationText || S.formatSeconds(r.duration || 0);
    document.getElementById("editDate").value = r.timestampText || "";
    document.getElementById("editUrl").value = r.url || "";
    document.getElementById("editReviewStatus").value = r.reviewStatus || "pending";
    document.getElementById("editModal").style.display = "flex";
  });
}

function closeEditModal() {
  editingId = "";
  document.getElementById("editModal").style.display = "none";
}

function saveEdit() {
  if (!editingId) return;
  const title = document.getElementById("editTitle").value.trim();
  const recordId = document.getElementById("editRecordId").value.trim();
  const duration = parseFloat(document.getElementById("editDuration").value);
  const timestampText = document.getElementById("editDate").value.trim();
  const url = document.getElementById("editUrl").value.trim();
  if (isNaN(duration) || duration < 0) {
    alert("请输入有效的时长（秒数）");
    return;
  }
  const reviewStatus = document.getElementById("editReviewStatus").value;
  const patch = {
    title: title || "无标题",
    recordId: recordId || null,
    duration,
    durationText: S.formatSeconds(duration),
    timestampText: timestampText || new Date().toLocaleString("zh-CN"),
    url: url || "",
    reviewStatus
  };
  chrome.runtime.sendMessage(
    { type: "UPDATE_RECORD", id: editingId, patch },
    (response) => {
      void chrome.runtime.lastError;
      if (response?.ok) {
        closeEditModal();
        lastRecordsJson = "";
        loadRecords();
      } else {
        alert("保存失败: " + (response?.error || "未知错误"));
      }
    }
  );
}

function deleteRecord(id) {
  if (!confirm("确定要删除这条记录吗？此操作不可恢复。")) return;
  chrome.runtime.sendMessage({ type: "DELETE_RECORD", id }, (response) => {
    void chrome.runtime.lastError;
    if (response?.ok) {
      lastRecordsJson = "";
      loadRecords();
    } else {
      alert("删除失败: " + (response?.error || "未知错误"));
    }
  });
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportToTxt() {
  chrome.runtime.sendMessage({ type: "GET_RECORDS" }, (response) => {
    void chrome.runtime.lastError;
    const records = response?.records || [];
    if (records.length === 0) {
      alert("暂无视频记录，无法导出。\n请先打开含视频的网页播放视频。");
      return;
    }
    downloadBlob(S.buildTxtContent(records), "text/plain;charset=utf-8", "video_durations.txt");
  });
}

function exportData() {
  chrome.storage.local.get([S.STORAGE_KEY, S.SETTINGS_KEY], (allData) => {
    if (chrome.runtime.lastError) {
      alert("导出失败: " + chrome.runtime.lastError.message);
      return;
    }
    const exportObj = {
      version: "1.0",
      exportTime: new Date().toISOString(),
      exportTimeText: new Date().toLocaleString("zh-CN"),
      video_records: allData[S.STORAGE_KEY] || [],
      settings: allData[S.SETTINGS_KEY] || null
    };
    const json = JSON.stringify(exportObj, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(json, "application/json;charset=utf-8", `video-tracker-backup-${dateStr}.json`);
  });
}

function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > S.IMPORT_MAX_BYTES) {
    alert("导入失败：文件超过 5MB 限制。");
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    const parsed = S.parseImportJson(String(event.target.result || ""), file.size);
    if (!parsed.ok) {
      alert("导入失败：" + parsed.error);
      return;
    }
    if (!confirm(`即将导入 ${parsed.importedRecords.length} 条记录。\n\n选择"确定"：合并导入（与现有记录合并，相同任务编号的会去重更新）\n选择"取消"：放弃导入`)) {
      return;
    }
    chrome.storage.local.get([S.STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        alert("导入失败: " + chrome.runtime.lastError.message);
        return;
      }
      const existing = result[S.STORAGE_KEY] || [];
      const merged = S.mergeImportedRecords(existing, parsed.importedRecords);
      chrome.storage.local.set({ [S.STORAGE_KEY]: merged.records, [S.REV_KEY]: Date.now() }, () => {
        if (chrome.runtime.lastError) {
          alert("导入失败: " + chrome.runtime.lastError.message);
          return;
        }
        lastRecordsJson = "";
        alert(`导入完成！\n新增：${merged.added} 条\n更新：${merged.updated} 条\n现有总计：${merged.records.length} 条`);
        loadRecords();
      });
    });
  };
  reader.readAsText(file);
}
