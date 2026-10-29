/**
 * popup.js —— 任务时长排序助手弹窗
 */

document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("statusText");

  // 检查当前标签页是否是质检平台（线上环境 + 本地模拟平台）
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const url = tab && tab.url ? tab.url : "";
    const isQcPlatform =
      url.includes("noitom.project.ostimes.net") ||
      url.includes("localhost") ||
      url.includes("127.0.0.1");

    if (isQcPlatform) {
      statusText.textContent = "运行中";
      statusText.style.color = "#2e7d32";
    } else {
      statusText.textContent = "当前页面不适用";
      statusText.style.color = "#c62828";
    }
  });
});
