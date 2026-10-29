/**
 * background.js —— 任务批量领取助手后台
 */

// 安装时初始化默认设置
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["tch_enabled"], (result) => {
    if (result.tch_enabled === undefined) {
      chrome.storage.local.set({ tch_enabled: true });
    }
  });
});
