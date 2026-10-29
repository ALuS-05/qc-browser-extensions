/**
 * content.js —— 任务时长排序助手
 * 在质检平台待认领任务页面，按时长升序/降序排列任务
 */

(function () {
  "use strict";

  let currentSort = "none"; // none | duration_asc | duration_desc | time_desc | time_asc
  let sortBarInjected = false;
  let observer = null;
  let claimTimes = {}; // 存储任务领取时间：{ taskId: timestamp }
  let claimListenerBound = false;

  const STORAGE_KEY = "task_claim_times";

  /**
   * 从 chrome.storage 加载所有领取时间
   */
  function loadClaimTimes() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          claimTimes = result[STORAGE_KEY] || {};
          resolve(claimTimes);
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  /**
   * 保存单个任务的领取时间
   */
  function saveClaimTime(taskId) {
    if (!taskId) return;
    const now = Date.now();
    claimTimes[taskId] = now;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: claimTimes }, () => {
        console.log(`[任务排序] 已记录任务 ${taskId} 的领取时间: ${new Date(now).toLocaleString()}`);
      });
    } catch (e) {
      console.log("[任务排序] 保存领取时间失败", e);
    }
  }

  /**
   * 获取任务的领取时间
   */
  function getClaimTime(taskId) {
    return claimTimes[taskId] || 0;
  }

  /**
   * 解析时长文本为秒数，支持格式：1.80m / 2.05m / 1m30s / 90s
   */
  function parseDuration(text) {
    if (!text) return 0;
    text = text.trim();

    // 格式：1.80m（分钟，小数）
    let m = text.match(/([\d.]+)\s*m$/i);
    if (m) return parseFloat(m[1]) * 60;

    // 格式：1m30s
    m = text.match(/(\d+)\s*m\s*(\d+)\s*s/i);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);

    // 格式：90s
    m = text.match(/([\d.]+)\s*s$/i);
    if (m) return parseFloat(m[1]);

    // 纯数字，默认秒
    m = text.match(/^([\d.]+)$/);
    if (m) return parseFloat(m[1]);

    return 0;
  }

  /**
   * 解析时间文本为时间戳，支持格式：2026-09-14 14:09:55 / 2026/09/14 14:09:55
   */
  function parseTime(text) {
    if (!text) return 0;
    text = text.trim();
    // 尝试标准日期时间格式
    const m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
      const year = parseInt(m[1]);
      const month = parseInt(m[2]) - 1;
      const day = parseInt(m[3]);
      const hour = parseInt(m[4]);
      const minute = parseInt(m[5]);
      const second = m[6] ? parseInt(m[6]) : 0;
      return new Date(year, month, day, hour, minute, second).getTime();
    }
    // 尝试只有日期
    const m2 = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m2) {
      return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3])).getTime();
    }
    return 0;
  }

  /**
   * 找到表格容器和数据行
   * 支持表头和表体分离的双 table 结构
   */
  function findTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    if (tables.length === 0) return null;

    // 第一步：找到包含"时长"表头的 table，确定各列索引
    let durationColIndex = -1;
    let timeColIndex = -1;
    let idColIndex = -1;
    for (const table of tables) {
      const headers = table.querySelectorAll("th");
      for (const th of headers) {
        const text = th.textContent.trim();
        if (text === "时长" && durationColIndex < 0) {
          durationColIndex = Array.from(headers).indexOf(th);
        }
        if ((text === "提交时间" || text === "领取时间" || text === "认领时间" || text === "创建时间") && timeColIndex < 0) {
          timeColIndex = Array.from(headers).indexOf(th);
        }
        if ((text === "记录编号" || text === "任务编号" || text === "编号" || text === "ID") && idColIndex < 0) {
          idColIndex = Array.from(headers).indexOf(th);
        }
      }
      if (durationColIndex >= 0 && timeColIndex >= 0 && idColIndex >= 0) break;
    }

    // 第二步：找到数据行最多的 table 作为数据表
    let dataTable = null;
    let maxRows = 0;
    for (const table of tables) {
      const rows = table.querySelectorAll("tr");
      if (rows.length > maxRows) {
        maxRows = rows.length;
        dataTable = table;
      }
    }

    if (dataTable && maxRows > 0) {
      const tbody = dataTable.querySelector("tbody") || dataTable;
      const rows = Array.from(tbody.querySelectorAll("tr"));
      // 过滤掉空行和表头行
      const dataRows = rows.filter((row) => {
        const cells = row.querySelectorAll("td");
        return cells.length > 0;
      });
      if (dataRows.length > 0) {
        return { table: dataTable, tbody, rows: dataRows, durationColIndex, timeColIndex, idColIndex };
      }
    }

    // 兼容 div 表格结构
    const divRows = document.querySelectorAll("[class*='row'], [class*='Row'], [class*='item'], [class*='Item']");
    if (divRows.length > 5) {
      for (const row of divRows) {
        if (row.textContent.includes("m") && row.querySelector("button")) {
          return { table: row.parentElement, tbody: row.parentElement, rows: Array.from(divRows), durationColIndex: -1, timeColIndex: -1, idColIndex: -1 };
        }
      }
    }

    return null;
  }

  /**
   * 从行中提取时长
   */
  function getRowDuration(row, colIndex) {
    if (colIndex >= 0) {
      const cells = row.querySelectorAll("td");
      if (cells[colIndex]) {
        return parseDuration(cells[colIndex].textContent);
      }
    }
    // 兜底：在行文本中找时长模式
    const text = row.textContent;
    const m = text.match(/([\d.]+)\s*m(?=\s|$)/);
    if (m) return parseFloat(m[1]) * 60;
    return 0;
  }

  /**
   * 从行中提取时间
   */
  function getRowTime(row, colIndex) {
    if (colIndex >= 0) {
      const cells = row.querySelectorAll("td");
      if (cells[colIndex]) {
        return parseTime(cells[colIndex].textContent);
      }
    }
    // 兜底：在行文本中找日期时间模式
    const text = row.textContent;
    const m = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?/);
    if (m) return parseTime(m[0]);
    return 0;
  }

  /**
   * 从行中提取记录编号（任务ID）
   */
  function getRowId(row, colIndex) {
    if (colIndex >= 0) {
      const cells = row.querySelectorAll("td");
      if (cells[colIndex]) {
        const text = cells[colIndex].textContent.trim();
        if (text) return text;
      }
    }
    // 兜底：在行文本中找记录编号模式（R开头 + 数字/字母）
    const text = row.textContent;
    const m = text.match(/R[A-Za-z0-9]{10,}/);
    if (m) return m[0];
    return "";
  }

  /**
   * 执行排序
   */
  function doSort(order) {
    const tableInfo = findTable();
    if (!tableInfo) {
      console.log("[任务排序] 未找到表格");
      return;
    }

    const { tbody, rows, durationColIndex, timeColIndex, idColIndex } = tableInfo;

    if (order === "none") {
      // 恢复默认顺序：刷新页面
      location.reload();
      return;
    }

    // 根据排序类型给每行附加排序数据
    let rowsWithData;
    if (order === "time_desc" || order === "time_asc") {
      // 按领取时间排序：使用插件记录的实际领取时间
      rowsWithData = rows.map((row) => {
        const taskId = getRowId(row, idColIndex);
        const claimTime = getClaimTime(taskId);
        // 如果没有记录领取时间，用页面上的提交时间兜底，排在有记录的后面
        const fallbackTime = getRowTime(row, timeColIndex);
        return {
          row,
          value: claimTime > 0 ? claimTime : fallbackTime,
          hasClaimRecord: claimTime > 0
        };
      });
      // 排序：有领取记录的排在前面，没有记录的排在后面
      rowsWithData.sort((a, b) => {
        if (a.hasClaimRecord && !b.hasClaimRecord) return -1;
        if (!a.hasClaimRecord && b.hasClaimRecord) return 1;
        if (order === "time_asc") return a.value - b.value;
        return b.value - a.value;
      });
    } else {
      // 按时长排序
      rowsWithData = rows.map((row) => ({
        row,
        value: getRowDuration(row, durationColIndex)
      }));
      rowsWithData.sort((a, b) => {
        if (order === "duration_asc") return a.value - b.value;
        return b.value - a.value;
      });
    }

    // 重新排列 DOM
    const fragment = document.createDocumentFragment();
    rowsWithData.forEach((item) => {
      fragment.appendChild(item.row);
    });
    tbody.appendChild(fragment);

    currentSort = order;
    updateSortBar();
    const sortName = {
      duration_asc: "时长升序",
      duration_desc: "时长降序",
      time_desc: "最新领取",
      time_asc: "最早领取"
    }[order] || order;
    console.log(`[任务排序] 已按${sortName}排列 ${rows.length} 条任务`);
  }

  /**
   * 注入排序控制条
   */
  function injectSortBar() {
    if (sortBarInjected) return;

    const bar = document.createElement("div");
    bar.id = "tch-sort-bar";
    bar.innerHTML = `
      <style>
        #tch-sort-bar {
          position: fixed;
          top: 80px;
          right: 20px;
          z-index: 99999;
          background: rgba(30, 40, 60, 0.95);
          border: 1px solid rgba(100, 150, 255, 0.3);
          border-radius: 8px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          color: #e0e6f0;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          backdrop-filter: blur(8px);
        }
        #tch-sort-bar .tch-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #tch-sort-bar .tch-label {
          font-weight: 600;
          color: #8ab4ff;
          min-width: 56px;
        }
        #tch-sort-bar .tch-btn {
          padding: 4px 10px;
          border: 1px solid rgba(100, 150, 255, 0.3);
          border-radius: 5px;
          background: transparent;
          color: #b0c4de;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
          white-space: nowrap;
        }
        #tch-sort-bar .tch-btn:hover {
          background: rgba(100, 150, 255, 0.15);
          border-color: rgba(100, 150, 255, 0.6);
        }
        #tch-sort-bar .tch-btn.active {
          background: #4a8eff;
          color: #fff;
          border-color: #4a8eff;
        }
        #tch-sort-bar .tch-close {
          margin-left: auto;
          padding: 2px 8px;
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
        }
        #tch-sort-bar .tch-close:hover {
          color: #fff;
        }
      </style>
      <div class="tch-row">
        <span class="tch-label">按时长</span>
        <button class="tch-btn" data-order="none">默认</button>
        <button class="tch-btn" data-order="duration_asc">升序 ↑</button>
        <button class="tch-btn" data-order="duration_desc">降序 ↓</button>
        <button class="tch-close" title="隐藏">×</button>
      </div>
      <div class="tch-row">
        <span class="tch-label">按领取</span>
        <button class="tch-btn" data-order="time_desc">最新 ↓</button>
        <button class="tch-btn" data-order="time_asc">最早 ↑</button>
      </div>
      <div class="tch-row">
        <button class="tch-btn tch-record-btn" style="background: rgba(74,142,255,0.2); border-color: #4a8eff; color: #8ab4ff;">记录当前页领取时间</button>
      </div>
    `;

    document.body.appendChild(bar);
    sortBarInjected = true;

    // 绑定排序按钮事件
    bar.querySelectorAll(".tch-btn:not(.tch-record-btn)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const order = btn.dataset.order;
        doSort(order);
      });
    });

    // 绑定"记录当前页领取时间"按钮事件
    const recordBtn = bar.querySelector(".tch-record-btn");
    if (recordBtn) {
      recordBtn.addEventListener("click", () => {
        const tableInfo = findTable();
        if (!tableInfo) {
          showToast("未找到任务表格");
          return;
        }
        const { rows, idColIndex } = tableInfo;
        let count = 0;
        rows.forEach((row) => {
          const taskId = getRowId(row, idColIndex);
          if (taskId && !getClaimTime(taskId)) {
            saveClaimTime(taskId);
            count++;
          }
        });
        if (count > 0) {
          showToast(`已记录 ${count} 条任务的领取时间为当前时间`);
          console.log(`[任务排序] 手动记录了 ${count} 条任务的领取时间`);
        } else {
          showToast("当前页所有任务都已有领取时间记录");
        }
      });
    }

    // 关闭按钮
    bar.querySelector(".tch-close").addEventListener("click", () => {
      bar.style.display = "none";
      setTimeout(() => {
        bar.style.display = "flex";
      }, 3000);
    });

    updateSortBar();
  }

  /**
   * 更新排序控制条的激活状态
   */
  function updateSortBar() {
    const bar = document.getElementById("tch-sort-bar");
    if (!bar) return;
    bar.querySelectorAll(".tch-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.order === currentSort);
    });
  }

  /**
   * 监听质检池页面的认领按钮点击，记录任务领取时间
   */
  function bindClaimButtons() {
    if (claimListenerBound) return;

    // 使用事件委托，监听所有认领按钮的点击
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      const btnText = btn.textContent.trim();
      // 匹配认领按钮（包含"认领"文字，且不是"已认领"状态）
      if (btnText.includes("认领") && !btnText.includes("已认领") && !btn.disabled) {
        // 找到按钮所在的行
        const row = btn.closest("tr") || btn.closest("[class*='row']") || btn.closest("[class*='item']");
        if (row) {
          // 延迟一点获取任务ID，确保页面状态已更新
          setTimeout(() => {
            const tableInfo = findTable();
            const taskId = getRowId(row, tableInfo ? tableInfo.idColIndex : -1);
            if (taskId) {
              saveClaimTime(taskId);
              showToast(`已记录任务 ${taskId} 的领取时间`);
            }
          }, 500);
        }
      }
    });

    // 定时扫描：检测任务状态变化（兼容批量领取助手等非点击方式）
    setInterval(() => {
      if (!isTargetPage()) return;
      const tableInfo = findTable();
      if (!tableInfo) return;

      const { rows, idColIndex } = tableInfo;
      rows.forEach((row) => {
        // 检查这一行是否有"已认领"状态
        const rowText = row.textContent;
        const hasClaimed = rowText.includes("已认领") || rowText.includes("已领取");
        const hasClaimBtn = row.querySelector("button") &&
          row.querySelector("button").textContent.trim().includes("认领") &&
          !row.querySelector("button").textContent.trim().includes("已认领");

        // 如果任务已认领，并且没有领取时间记录，就记录当前时间
        if ((hasClaimed || !hasClaimBtn) && rowText.includes("认领")) {
          const taskId = getRowId(row, idColIndex);
          if (taskId && !getClaimTime(taskId)) {
            // 只在质检池页面记录（避免把我的审核任务页面已有的任务都记录成当前时间）
            if (document.body.textContent.includes("质检池") ||
                document.body.textContent.includes("待认领") ||
                document.body.textContent.includes("未认领")) {
              saveClaimTime(taskId);
              console.log(`[任务排序] 扫描检测到任务 ${taskId} 已认领，记录领取时间`);
            }
          }
        }
      });
    }, 2000);

    claimListenerBound = true;
    console.log("[任务排序] 已绑定认领按钮监听和定时扫描");
  }

  /**
   * 显示短暂提示
   */
  function showToast(message) {
    let toast = document.getElementById("tch-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tch-toast";
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(30, 40, 60, 0.95);
        color: #fff;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 999999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        transition: opacity 0.3s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.opacity = "0";
    }, 2000);
  }
  function isTargetPage() {
    if (!document.body) return false;
    const text = document.body.textContent;
    return (
      text.includes("质检池") ||
      text.includes("待认领") ||
      text.includes("未认领") ||
      text.includes("我的审核任务") ||
      text.includes("已认领") ||
      text.includes("审核任务")
    );
  }

  /**
   * 检测并确保在目标页面上完成注入；非目标页面则隐藏排序条
   */
  function ensureOnTargetPage() {
    const bar = document.getElementById("tch-sort-bar");
    if (!isTargetPage()) {
      if (bar) bar.style.display = "none";
      return;
    }
    // 目标页面：加载数据、绑定监听、注入排序条
    loadClaimTimes();
    bindClaimButtons();
    injectSortBar();
    const barAfter = document.getElementById("tch-sort-bar");
    if (barAfter) barAfter.style.display = "flex";
  }

  // 防抖：DOM 变化频繁时避免重复执行
  let debounceTimer = null;
  function scheduleCheck() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(ensureOnTargetPage, 300);
  }

  /**
   * 拦截 SPA 路由切换（pushState / replaceState 不会触发 popstate）
   */
  function hookSpaNavigation() {
    const onNav = () => {
      currentSort = "none";
      // 路由切换后分两次检测，覆盖不同的页面渲染速度
      setTimeout(ensureOnTargetPage, 600);
      setTimeout(ensureOnTargetPage, 1500);
    };
    const origPushState = history.pushState;
    history.pushState = function () {
      const ret = origPushState.apply(this, arguments);
      onNav();
      return ret;
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function () {
      const ret = origReplaceState.apply(this, arguments);
      onNav();
      return ret;
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
  }

  /**
   * 启动：无条件监听 DOM + 轮询兜底，解决页面加载慢、SPA 路由切换识别不到的问题
   */
  function bootstrap() {
    hookSpaNavigation();

    // 无条件启动 DOM 监听（即使一开始页面还没渲染，后续内容变化也能捕获）
    const startObserver = () => {
      if (observer) observer.disconnect();
      observer = new MutationObserver(scheduleCheck);
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    };
    if (document.body) {
      startObserver();
    } else {
      document.addEventListener("DOMContentLoaded", startObserver);
    }

    // 轮询兜底：前 3 分钟每 500ms 检测一次，覆盖慢加载和路由切换
    let pollCount = 0;
    const MAX_POLLS = 360;
    const pollTimer = setInterval(() => {
      pollCount++;
      ensureOnTargetPage();
      if (pollCount >= MAX_POLLS) clearInterval(pollTimer);
    }, 500);

    // 立即尝试一次
    ensureOnTargetPage();

    console.log("[任务排序助手] 已启动，等待质检页面...");
  }

  bootstrap();
})();
