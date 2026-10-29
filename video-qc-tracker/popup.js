/**
 * popup.js —— 弹窗逻辑
 */

let timerInterval = null;
let selectedReasons = new Set();

document.addEventListener("DOMContentLoaded", () => {
  loadAll();
  // 每秒刷新计时
  timerInterval = setInterval(loadCurrent, 1000);

  document.getElementById("passBtn").addEventListener("click", () => {
    if (confirm("确认该视频质检通过？")) {
      submitResult("pass", null);
    }
  });

  document.getElementById("failBtn").addEventListener("click", () => {
    showFailPanel();
  });

  document.getElementById("failCancel").addEventListener("click", () => {
    hideFailPanel();
  });

  document.getElementById("failConfirm").addEventListener("click", () => {
    const remark = document.getElementById("failRemark").value.trim();
    const reasons = Array.from(selectedReasons);
    const reasonText = reasons.length > 0 ? reasons.join("、") + (remark ? "；" + remark : "") : remark;
    if (!reasonText) {
      alert("请至少选择一个不通过原因或填写备注");
      return;
    }
    submitResult("fail", reasonText);
  });

  document.getElementById("pauseBtn").addEventListener("click", togglePause);

  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "EXPORT_CSV" });
  });

  document.getElementById("exportTxtBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "EXPORT_TXT" });
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (confirm("确定清空所有质检记录？此操作不可恢复。")) {
      chrome.runtime.sendMessage({ type: "CLEAR_RECORDS" }, () => loadAll());
    }
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});

function loadAll() {
  loadCurrent();
  loadRecords();
  loadFailReasons();
}

function loadCurrent() {
  chrome.runtime.sendMessage({ type: "GET_CURRENT" }, (response) => {
    const card = document.getElementById("currentCard");
    const noCurrent = document.getElementById("noCurrent");

    if (response && response.current && response.record) {
      card.style.display = "block";
      noCurrent.style.display = "none";

      document.getElementById("currentTitle").textContent = response.record.title || "无标题";
      document.getElementById("currentVideoDur").textContent = response.record.videoDurationText || "未知";
      document.getElementById("currentTimer").textContent = formatMs(response.elapsed);

      const pauseBtn = document.getElementById("pauseBtn");
      if (response.current.paused) {
        pauseBtn.textContent = "继续计时";
      } else {
        pauseBtn.textContent = "暂停计时";
      }
    } else {
      card.style.display = "none";
      noCurrent.style.display = "block";
      hideFailPanel();
    }
  });
}

function togglePause() {
  chrome.runtime.sendMessage({ type: "GET_CURRENT" }, (response) => {
    if (response.current?.paused) {
      chrome.runtime.sendMessage({ type: "RESUME_CURRENT" }, () => loadCurrent());
    } else {
      chrome.runtime.sendMessage({ type: "PAUSE_CURRENT" }, () => loadCurrent());
    }
  });
}

function showFailPanel() {
  document.getElementById("failPanel").style.display = "block";
  selectedReasons.clear();
  document.getElementById("failRemark").value = "";
  loadFailReasons();
}

function hideFailPanel() {
  document.getElementById("failPanel").style.display = "none";
  selectedReasons.clear();
}

function loadFailReasons() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    const reasons = response?.settings?.failReasons || [];
    const container = document.getElementById("failReasons");
    container.innerHTML = reasons.map((r) =>
      `<label class="reason-tag"><input type="checkbox" value="${escapeHtml(r)}"> ${escapeHtml(r)}</label>`
    ).join("");

    container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) selectedReasons.add(cb.value);
        else selectedReasons.delete(cb.value);
      });
    });
  });
}

function submitResult(result, reason) {
  chrome.runtime.sendMessage({ type: "SUBMIT_RESULT", result, reason }, (response) => {
    if (response?.ok) {
      hideFailPanel();
      loadAll();
    } else {
      alert("提交失败: " + (response?.error || "未知错误"));
    }
  });
}

function loadRecords() {
  chrome.runtime.sendMessage({ type: "GET_RECORDS" }, (response) => {
    const records = response?.records || [];
    renderRecords(records);
    renderStats(records);
  });
}

function renderStats(records) {
  const today = new Date().toLocaleDateString("zh-CN");
  const todayRecords = records.filter((r) => r.timestampText?.startsWith(today));
  const completed = todayRecords.filter((r) => r.result);
  const pass = completed.filter((r) => r.result === "pass").length;
  const fail = completed.filter((r) => r.result === "fail").length;
  const totalTime = completed.reduce((s, r) => s + (r.qcDuration || 0), 0);

  document.getElementById("todayCount").textContent = completed.length;
  document.getElementById("passCount").textContent = pass;
  document.getElementById("failCount").textContent = fail;
  document.getElementById("passRate").textContent =
    completed.length > 0 ? Math.round((pass / completed.length) * 100) + "%" : "--";
  document.getElementById("todayTime").textContent = formatSeconds(totalTime);
  document.getElementById("avgTime").textContent =
    completed.length > 0 ? formatSeconds(Math.round(totalTime / completed.length)) : "00:00:00";
}

function renderRecords(records) {
  const list = document.getElementById("recordList");
  if (records.length === 0) {
    list.innerHTML = '<p class="empty">暂无记录</p>';
    return;
  }

  const sorted = [...records].reverse();
  list.innerHTML = sorted.map((r) => {
    const resultClass = r.result === "pass" ? "pass" : r.result === "fail" ? "fail" : "pending";
    const resultText = r.result === "pass" ? "通过" : r.result === "fail" ? "不通过" : "进行中";
    return `
      <div class="record-item">
        <div class="record-top">
          <span class="record-title" title="${escapeHtml(r.title || "")}">${escapeHtml(r.title || "无标题")}</span>
          <span class="result-badge ${resultClass}">${resultText}</span>
        </div>
        <div class="record-meta">
          <span>视频 ${r.videoDurationText || "--"}</span>
          <span>质检 ${r.qcDurationText || "--"}</span>
          <span class="record-time">${r.timestampText || ""}</span>
        </div>
        ${r.reason ? `<div class="record-reason">原因: ${escapeHtml(r.reason)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  return formatSeconds(s);
}

function formatSeconds(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
