/**
 * popup.js —— 任务批量领取助手弹窗逻辑
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("enableToggle");
  const statusText = document.getElementById("statusText");
  const successCount = document.getElementById("successCount");
  const conflictCount = document.getElementById("conflictCount");
  const failCount = document.getElementById("failCount");
  const resetBtn = document.getElementById("resetStats");
  const currentVersionEl = document.getElementById("currentVersion");
  const updateUrlInput = document.getElementById("updateUrl");
  const checkUpdateBtn = document.getElementById("checkUpdate");
  const downloadUpdateBtn = document.getElementById("downloadUpdate");
  const updateStatusEl = document.getElementById("updateStatus");

  const CURRENT_VERSION = "1.1.0";
  let latestVersionInfo = null;

  // 加载开关状态
  chrome.storage.local.get(["tch_enabled", "tch_stats"], (result) => {
    toggle.checked = result.tch_enabled !== false;
    updateStatusText(toggle.checked);
    const stats = result.tch_stats || { claimed: 0, failed: 0, conflicted: 0 };
    successCount.textContent = stats.claimed || 0;
    conflictCount.textContent = stats.conflicted || 0;
    failCount.textContent = stats.failed || 0;
  });

  // 监听 storage 变化，实时更新统计
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tch_stats) {
      const stats = changes.tch_stats.newValue || { claimed: 0, failed: 0, conflicted: 0 };
      successCount.textContent = stats.claimed || 0;
      conflictCount.textContent = stats.conflicted || 0;
      failCount.textContent = stats.failed || 0;
    }
    if (changes.tch_enabled) {
      toggle.checked = changes.tch_enabled.newValue;
      updateStatusText(changes.tch_enabled.newValue);
    }
  });

  // 开关切换
  toggle.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ tch_enabled: enabled });
    updateStatusText(enabled);
  });

  // 重置统计
  resetBtn.addEventListener("click", () => {
    chrome.storage.local.set({ tch_stats: { claimed: 0, failed: 0, conflicted: 0 } });
    successCount.textContent = "0";
    conflictCount.textContent = "0";
    failCount.textContent = "0";
  });

  // ========== 一键更新功能 ==========
  currentVersionEl.textContent = "v" + CURRENT_VERSION;

  // 加载保存的更新源URL
  chrome.storage.local.get("tch_update_url", (result) => {
    if (result.tch_update_url) {
      updateUrlInput.value = result.tch_update_url;
    }
  });

  // 保存更新源URL
  updateUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ tch_update_url: updateUrlInput.value.trim() });
  });

  // 版本号比较：返回 true 表示新版本
  function isNewer(latest, current) {
    const a = latest.split(".").map(Number);
    const b = current.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  function setUpdateStatus(text, type) {
    updateStatusEl.textContent = text;
    updateStatusEl.className = "update-status" + (type ? " " + type : "");
  }

  // 检查更新
  checkUpdateBtn.addEventListener("click", async () => {
    const url = updateUrlInput.value.trim();
    if (!url) {
      setUpdateStatus("请先填写更新源URL（version.json地址）", "error");
      return;
    }

    setUpdateStatus("正在检查更新...", "info");
    checkUpdateBtn.disabled = true;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();

      if (!data.version || !data.download_url) {
        throw new Error("version.json格式不正确");
      }

      latestVersionInfo = data;

      if (isNewer(data.version, CURRENT_VERSION)) {
        setUpdateStatus(
          "发现新版本 v" + data.version + "（当前 v" + CURRENT_VERSION + "）",
          "success"
        );
        downloadUpdateBtn.style.display = "inline-block";
      } else {
        setUpdateStatus("当前已是最新版本 v" + CURRENT_VERSION, "success");
        downloadUpdateBtn.style.display = "none";
      }
    } catch (err) {
      setUpdateStatus("检查失败：" + err.message, "error");
      downloadUpdateBtn.style.display = "none";
    } finally {
      checkUpdateBtn.disabled = false;
    }
  });

  // 立即更新：下载zip并打开扩展页面
  downloadUpdateBtn.addEventListener("click", () => {
    if (!latestVersionInfo || !latestVersionInfo.download_url) {
      setUpdateStatus("请先检查更新", "error");
      return;
    }

    setUpdateStatus("正在下载新版本...", "info");

    chrome.downloads.download(
      {
        url: latestVersionInfo.download_url,
        filename: "task-claim-helper-v" + latestVersionInfo.version + ".zip",
        conflictAction: "overwrite"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          setUpdateStatus("下载失败：" + chrome.runtime.lastError.message, "error");
          return;
        }

        // 下载完成后打开扩展页面
        chrome.downloads.onChanged.addListener(function listener(delta) {
          if (delta.id === downloadId && delta.state && delta.state.current === "complete") {
            chrome.downloads.onChanged.removeListener(listener);
            setUpdateStatus(
              "新版本已下载到下载文件夹！\n请解压覆盖插件目录，然后在扩展页面点刷新按钮",
              "success"
            );
            // 自动打开扩展页面
            chrome.tabs.create({ url: "chrome://extensions/" });
          }
        });
      }
    );
  });

  function updateStatusText(enabled) {
    if (enabled) {
      statusText.textContent = "已开启 - 点击领取不跳转";
      statusText.style.color = "#2e7d32";
    } else {
      statusText.textContent = "已关闭 - 恢复原始跳转行为";
      statusText.style.color = "#c62828";
    }
  }
});
