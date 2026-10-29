/**
 * content.js —— 任务批量领取助手
 * 针对质检平台（AetherCapture）待认领页面精准适配：
 * - 识别 button[data-task-claim] 认领按钮
 * - 拦截点击，通过 page-claim.js 在页面上下文中 POST /admin/api/review/tasks/{recordId}/claim
 * - 阻止页面跳转到已认领页面，支持连续领取多条任务
 */

(function () {
  "use strict";

  const CONFIG = {
    // 请求超时（毫秒）
    timeout: 10000,
    // 调试日志
    debug: true
  };

  let enabled = true;
  let stats = { claimed: 0, failed: 0, conflicted: 0 };
  let pageScriptInjected = false;

  // 从 storage 读取开关状态
  chrome.storage.local.get(["tch_enabled", "tch_stats"], (result) => {
    enabled = result.tch_enabled !== false;
    if (result.tch_stats) stats = result.tch_stats;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tch_enabled) enabled = changes.tch_enabled.newValue;
  });

  function log(...args) {
    if (CONFIG.debug) console.log("[任务领取助手]", ...args);
  }

  /**
   * 注入 page-claim.js 到页面上下文（只注入一次）
   * 该脚本在页面上下文中运行，可使用页面的 fetch（自动带上认证 cookies）
   */
  function injectPageScript() {
    if (pageScriptInjected) return;
    pageScriptInjected = true;

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-claim.js");
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    log("page-claim.js 已注入");
  }

  // 尽早注入
  if (document.head || document.documentElement) {
    injectPageScript();
  } else {
    document.addEventListener("DOMContentLoaded", injectPageScript, { once: true });
  }

  /**
   * 通过 postMessage 让 page-claim.js 在页面上下文中执行认领请求
   */
  function claimInPageContext(recordId) {
    return new Promise((resolve, reject) => {
      const callbackId = "tch_" + Date.now() + "_" + Math.random().toString(36).slice(2);

      const handler = (e) => {
        if (e.data && e.data.type === "tch_page_claim_result" && e.data.callbackId === callbackId) {
          window.removeEventListener("message", handler);
          clearTimeout(timeoutId);
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            resolve({ ok: e.data.ok, status: e.data.status, body: e.data.body });
          }
        }
      };
      window.addEventListener("message", handler);

      const timeoutId = setTimeout(() => {
        window.removeEventListener("message", handler);
        reject(new Error("请求超时"));
      }, CONFIG.timeout);

      window.postMessage(
        {
          type: "tch_page_claim",
          recordId: recordId,
          callbackId: callbackId
        },
        "*"
      );
    });
  }

  /**
   * 判断是否是认领按钮：有 data-task-claim 属性且文本为"认领"
   */
  function isClaimButton(el) {
    if (!el) return false;
    if (el.tagName !== "BUTTON") return false;
    const recordId = el.getAttribute("data-task-claim");
    if (!recordId) return false;
    const text = (el.textContent || "").trim();
    return text === "认领";
  }

  /**
   * 执行认领
   */
  async function doClaim(btn, recordId) {
    const originalText = btn.textContent;
    setButtonState(btn, "领取中...", "loading");

    log("发起认领请求, recordId:", recordId);

    try {
      const result = await claimInPageContext(recordId);

      if (result.ok) {
        // 200/201 真正认领成功
        log("认领成功:", result.body || result.status);
        setButtonState(btn, "已领取", "success");
        stats.claimed++;
        updateStats();
        return true;
      } else if (result.status === 409) {
        // 409 Conflict：任务已被别人领走
        log("任务已被别人领取（409 Conflict）:", result.body);
        setButtonState(btn, "已被领取", "conflicted");
        stats.conflicted++;
        updateStats();
        return false;
      } else {
        throw new Error("HTTP " + result.status);
      }
    } catch (err) {
      log("认领失败:", err);
      setButtonState(btn, "失败", "error");
      stats.failed++;
      updateStats();
      // 2秒后恢复按钮文本，允许重试
      setTimeout(() => {
        setButtonState(btn, originalText, "");
        btn.dataset.claimProcessed = "";
      }, 2000);
      return false;
    }
  }

  /**
   * 设置按钮视觉状态
   */
  function setButtonState(btn, text, state) {
    btn.textContent = text;
    btn.style.pointerEvents = "none";

    if (state === "loading") {
      btn.style.opacity = "0.6";
      btn.style.cursor = "wait";
    } else if (state === "success") {
      btn.style.opacity = "0.5";
      btn.style.background = "#e8f5e9";
      btn.style.color = "#2e7d32";
      btn.style.borderColor = "#a5d6a7";
    } else if (state === "conflicted") {
      // 任务被别人领走了：橙色提示
      btn.style.opacity = "0.7";
      btn.style.background = "#fff3e0";
      btn.style.color = "#e65100";
      btn.style.borderColor = "#ffcc80";
    } else if (state === "error") {
      btn.style.opacity = "1";
      btn.style.background = "#ffebee";
      btn.style.color = "#c62828";
    } else {
      btn.style.pointerEvents = "";
      btn.style.opacity = "";
      btn.style.cursor = "";
      btn.style.background = "";
      btn.style.color = "";
      btn.style.borderColor = "";
    }
  }

  /**
   * 更新统计到 storage
   */
  function updateStats() {
    chrome.storage.local.set({ tch_stats: stats });
  }

  /**
   * 核心：捕获阶段拦截认领按钮点击
   * 使用 capture=true + stopImmediatePropagation 确保在 Vue 事件处理之前拦截
   */
  document.addEventListener(
    "click",
    (e) => {
      if (!enabled) return;

      // 找到点击的认领按钮
      const btn = e.target.closest("button[data-task-claim]");
      if (!btn) return;

      // 只处理文本为"认领"的按钮（排除已领取状态）
      if (!isClaimButton(btn)) return;

      // 已处理过的按钮跳过
      if (btn.dataset.claimProcessed === "true") return;

      const recordId = btn.getAttribute("data-task-claim");
      if (!recordId) return;

      log("拦截认领按钮点击, recordId:", recordId);

      // 阻止默认行为和所有事件传播（关键：阻止 Vue 的 click 处理器和页面跳转）
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      btn.dataset.claimProcessed = "true";

      // 确保 page-claim.js 已注入
      injectPageScript();

      // 后台执行认领
      doClaim(btn, recordId);
    },
    true // 捕获阶段
  );

  log("任务批量领取助手已加载（精准适配版）");
})();
