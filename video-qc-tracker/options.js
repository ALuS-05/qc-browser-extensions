/**
 * options.js —— 设置页面逻辑
 */

const defaultReasons = ["画面质量问题", "音频质量问题", "内容违规", "字幕错误", "格式问题", "其他"];
let currentReasons = [];

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();

  document.getElementById("addReasonBtn").addEventListener("click", addReason);
  document.getElementById("newReason").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addReason();
  });

  document.getElementById("saveBtn").addEventListener("click", saveSettings);
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("恢复默认不通过原因标签？")) {
      currentReasons = [...defaultReasons];
      renderReasons();
    }
  });
});

function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    currentReasons = response?.settings?.failReasons || [...defaultReasons];
    renderReasons();
  });
}

function renderReasons() {
  const container = document.getElementById("reasonList");
  container.innerHTML = currentReasons.map((r, i) =>
    `<span class="reason-item">${escapeHtml(r)}<span class="remove" data-index="${i}">&times;</span></span>`
  ).join("");

  container.querySelectorAll(".remove").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.index);
      currentReasons.splice(idx, 1);
      renderReasons();
    });
  });
}

function addReason() {
  const input = document.getElementById("newReason");
  const val = input.value.trim();
  if (!val) return;
  if (currentReasons.includes(val)) {
    alert("该原因已存在");
    return;
  }
  currentReasons.push(val);
  input.value = "";
  renderReasons();
}

function saveSettings() {
  chrome.runtime.sendMessage({
    type: "UPDATE_SETTINGS",
    patch: { failReasons: currentReasons }
  }, () => {
    const msg = document.getElementById("savedMsg");
    msg.style.display = "inline";
    setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
