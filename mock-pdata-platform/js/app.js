/**
 * PDATA质检平台 - 模拟演示环境（完整版）
 * 用于面试演示 Chrome 插件功能
 */

(function () {
  "use strict";

  // ========== 常量 ==========
  const STORAGE_KEY = "mock_pdata_state_v2";
  const PAGE_SIZE = 10;

  // 本地视频列表（已下载到 videos 目录，确保稳定可播放）
  const VIDEO_URLS = [
    "videos/video1.mp4",
    "videos/video2.mp4",
    "videos/video3.mp4",
    "videos/video4.mp4",
    "videos/video5.mp4",
    "videos/video6.mp4"
  ];

  // 根据字符串生成哈希值，用于稳定分配视频
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // ========== 假数据生成 ==========
  function generateTasks() {
    const projects = ["诺亦腾项目", "居家场景采集任务", "工业场景采集", "医疗场景采集"];
    const scenes = ["--", "居家场景采集任务", "工业场景采集任务", "医疗场景采集任务"];
    const titles = [
      "制作手链", "手工活整理雪糕棒绑在一起", "数冰糕棒", "捆绑数据线",
      "拔大葱", "摘大蒜", "整理药品", "整理数据线", "拆卸螺丝", "包装糖果",
      "折叠整理毛巾", "拆键盘并擦拭", "整理衣物", "将托盘中的杯子拿出",
      "包混沌", "擦椅子", "清洁手串", "整理笔", "归纳物品", "擦拭桌面",
      "整理书架", "清洗水果", "切蔬菜", "煮面条", "叠衣服", "扫地", "拖地"
    ];
    const statuses = ["pending", "pending", "pending", "pending", "pending", "claimed", "claimed", "passed", "failed"];

    const tasks = [];
    const now = Date.now();

    for (let i = 0; i < 50; i++) {
      const idNum = String(1000000 + Math.floor(Math.random() * 9000000));
      const dateOffset = Math.floor(Math.random() * 7);
      const date = new Date(now - dateOffset * 86400000 - Math.random() * 86400000);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
      const prefix = ["meiluo", "runxun", "deii", "gongye"][Math.floor(Math.random() * 4)];
      const id = `R${dateStr}${prefix}${idNum}`;
      const durationMin = (Math.random() * 20 + 1).toFixed(2);
      const durationSec = Math.round(parseFloat(durationMin) * 60);
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const submitTime = new Date(date.getTime() + Math.random() * 3600000);

      const task = {
        id,
        title: titles[Math.floor(Math.random() * titles.length)],
        duration: `${durationMin}m`,
        durationSec,
        status,
        submitTime: formatDateTime(submitTime),
        submitTimeTs: submitTime.getTime(),
        project: projects[Math.floor(Math.random() * projects.length)],
        scene: scenes[Math.floor(Math.random() * scenes.length)],
        reviewer: status === "pending" ? "" : "qczyj05_nr",
        recordUser: String(Math.floor(Math.random() * 1000) + 100),
        category: ["居家", "工业", "医疗", "其他"][Math.floor(Math.random() * 4)],
        environment: ["居家", "办公室", "户外", "其他"][Math.floor(Math.random() * 4)],
        storageBucket: "itw-review",
        videoUrl: VIDEO_URLS[hashString(id) % VIDEO_URLS.length],
        claimTimeTs: status === "pending" ? 0 : submitTime.getTime() + Math.random() * 86400000,
        reviewResult: status === "passed" ? "pass" : status === "failed" ? "fail" : null,
        reviewReason: status === "failed" ? "画面模糊，人物动作不清晰" : "",
        reviewTimeTs: status === "passed" || status === "failed" ? submitTime.getTime() + Math.random() * 172800000 : 0
      };
      tasks.push(task);
    }

    // 按提交时间倒序
    tasks.sort((a, b) => b.submitTimeTs - a.submitTimeTs);
    return tasks;
  }

  // ========== 状态 ==========
  let state = {
    currentPage: "dashboard",
    currentTaskId: null,
    tasks: [],
    filters: {
      dashboard: { project: "", scene: "", status: "", keyword: "" },
      recordings: { project: "", scene: "", status: "", keyword: "", dateFrom: "", dateTo: "" },
      pool: { project: "", scene: "", keyword: "" },
      mine: { project: "", scene: "", status: "unreviewed", keyword: "" }
    },
    pagination: {
      dashboard: 1,
      recordings: 1,
      pool: 1,
      mine: 1
    },
    sortMode: {
      pool: "default",
      mine: "default"
    },
    reviewForm: {
      result: "",
      reason: ""
    }
  };

  // ========== 工具函数 ==========
  function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const s = String(date.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function showToast(message, type = "") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "toast show " + type;
    setTimeout(() => {
      toast.className = "toast";
    }, 2500);
  }

  function showModal(title, bodyHtml, footerHtml) {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").innerHTML = bodyHtml;
    document.getElementById("modalFooter").innerHTML = footerHtml || "";
    document.getElementById("modalOverlay").style.display = "flex";
  }

  function closeModal() {
    document.getElementById("modalOverlay").style.display = "none";
  }

  // ========== 数据持久化 ==========
  function saveState() {
    try {
      const toSave = {
        tasks: state.tasks,
        filters: state.filters,
        pagination: state.pagination
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.log("保存状态失败", e);
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.tasks && parsed.tasks.length > 0) {
          state.tasks = parsed.tasks;
          // 数据迁移：确保所有任务都有稳定的视频URL（替换旧的不可访问URL）
          let needSave = false;
          state.tasks.forEach(task => {
            const expectedUrl = VIDEO_URLS[hashString(task.id) % VIDEO_URLS.length];
            if (task.videoUrl !== expectedUrl) {
              task.videoUrl = expectedUrl;
              needSave = true;
            }
          });
          if (needSave) saveState();
          if (parsed.filters) state.filters = { ...state.filters, ...parsed.filters };
          if (parsed.pagination) state.pagination = { ...state.pagination, ...parsed.pagination };
          return true;
        }
      }
    } catch (e) {
      console.log("加载状态失败", e);
    }
    return false;
  }

  function resetData() {
    if (confirm("确定要重置所有数据吗？这将清除所有认领和审核记录。")) {
      localStorage.removeItem(STORAGE_KEY);
      state.tasks = generateTasks();
      saveState();
      renderPage();
      showToast("数据已重置", "success");
    }
  }

  // ========== 路由 ==========
  function navigateTo(page, taskId = null) {
    state.currentPage = page;
    state.currentTaskId = taskId;

    // 更新导航激活状态
    document.querySelectorAll(".nav-item").forEach(item => {
      item.classList.toggle("active", item.dataset.page === page);
    });

    // 更新面包屑
    const titles = {
      dashboard: "统计首页",
      recordings: "录制记录",
      pool: "质检池",
      mine: "我的审核任务",
      review: "审核详情"
    };
    document.getElementById("breadcrumbCurrent").textContent = titles[page] || "";

    // 隐藏加载动画
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";

    renderPage();
  }

  // ========== 筛选和分页 ==========
  function filterTasks(tasks, pageKey) {
    const f = state.filters[pageKey];
    if (!f) return tasks;

    return tasks.filter(task => {
      if (f.project && task.project !== f.project) return false;
      if (f.scene && task.scene !== f.scene) return false;
      if (f.keyword && !task.title.includes(f.keyword) && !task.id.includes(f.keyword)) return false;
      if (pageKey === "mine" && f.status) {
        if (f.status === "unreviewed" && task.status !== "claimed") return false;
        if (f.status === "reviewed" && (task.status !== "passed" && task.status !== "failed")) return false;
      }
      if (pageKey === "recordings" && f.status && task.status !== f.status) return false;
      return true;
    });
  }

  function sortTasks(tasks, pageKey) {
    const mode = state.sortMode[pageKey];
    if (!mode || mode === "default") return tasks;

    const sorted = [...tasks];
    if (mode === "duration_asc") {
      sorted.sort((a, b) => a.durationSec - b.durationSec);
    } else if (mode === "duration_desc") {
      sorted.sort((a, b) => b.durationSec - a.durationSec);
    } else if (mode === "time_desc") {
      sorted.sort((a, b) => (b.claimTimeTs || 0) - (a.claimTimeTs || 0));
    } else if (mode === "time_asc") {
      sorted.sort((a, b) => (a.claimTimeTs || 0) - (b.claimTimeTs || 0));
    }
    return sorted;
  }

  function paginate(tasks, pageKey) {
    const page = state.pagination[pageKey] || 1;
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return {
      items: tasks.slice(start, end),
      total: tasks.length,
      page,
      totalPages: Math.ceil(tasks.length / PAGE_SIZE)
    };
  }

  function renderPagination(pagination, pageKey) {
    if (pagination.totalPages <= 1) return "";

    let pagesHtml = "";
    const maxVisible = 5;
    let startPage = Math.max(1, pagination.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pagesHtml += `<button class="pagination-btn ${i === pagination.page ? "active" : ""}" onclick="goToPage('${pageKey}', ${i})">${i}</button>`;
    }

    return `
      <div class="pagination">
        <span class="pagination-info">共 ${pagination.total} 条，第 ${pagination.page}/${pagination.totalPages} 页</span>
        <button class="pagination-btn" onclick="goToPage('${pageKey}', ${pagination.page - 1})" ${pagination.page <= 1 ? "disabled" : ""}>上一页</button>
        ${pagesHtml}
        <button class="pagination-btn" onclick="goToPage('${pageKey}', ${pagination.page + 1})" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>下一页</button>
      </div>
    `;
  }

  function goToPage(pageKey, page) {
    state.pagination[pageKey] = page;
    saveState();
    renderPage();
  }

  function updateFilter(pageKey, field, value) {
    state.filters[pageKey][field] = value;
    state.pagination[pageKey] = 1;
    saveState();
    renderPage();
  }

  function clearFilters(pageKey) {
    Object.keys(state.filters[pageKey]).forEach(k => {
      state.filters[pageKey][k] = "";
    });
    if (pageKey === "mine") state.filters[pageKey].status = "unreviewed";
    state.pagination[pageKey] = 1;
    saveState();
    renderPage();
  }

  // ========== 状态标签 ==========
  function getStatusTag(status) {
    const map = {
      pending: { text: "待认领", class: "pending" },
      claimed: { text: "已认领", class: "claimed" },
      passed: { text: "已通过", class: "passed" },
      failed: { text: "未通过", class: "failed" }
    };
    const s = map[status] || { text: status, class: "" };
    return `<span class="status-tag ${s.class}">${s.text}</span>`;
  }

  // ========== 页面渲染 ==========
  function renderPage() {
    const content = document.getElementById("content");
    if (!content) return;

    switch (state.currentPage) {
      case "dashboard":
        content.innerHTML = renderDashboard();
        break;
      case "recordings":
        content.innerHTML = renderRecordings();
        break;
      case "pool":
        content.innerHTML = renderPool();
        break;
      case "mine":
        content.innerHTML = renderMine();
        break;
      case "review":
        content.innerHTML = renderReview();
        break;
      default:
        content.innerHTML = renderDashboard();
    }
  }

  // ========== 统计首页 ==========
  function renderDashboard() {
    const tasks = state.tasks;
    const totalDuration = tasks.reduce((sum, t) => sum + t.durationSec, 0);
    const passedTasks = tasks.filter(t => t.status === "passed");
    const failedTasks = tasks.filter(t => t.status === "failed");
    const pendingTasks = tasks.filter(t => t.status === "pending" || t.status === "claimed");
    const passedDuration = passedTasks.reduce((sum, t) => sum + t.durationSec, 0);
    const failedDuration = failedTasks.reduce((sum, t) => sum + t.durationSec, 0);

    const filtered = filterTasks(tasks, "dashboard");
    const sorted = sortTasks(filtered, "dashboard");
    const pagination = paginate(sorted, "dashboard");

    return `
      <div class="page-header">
        <div class="page-title">项目维度统计</div>
        <div class="page-desc">支持按项目、场景任务和时间范围查看录制与审核统计。</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">项目总时长</div>
          <div class="stat-value">${(totalDuration / 3600).toFixed(2)}h</div>
          <div class="stat-sub">项目下场景任务数量 ${tasks.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">项目已录制时长</div>
          <div class="stat-value blue">${(totalDuration / 3600).toFixed(2)}h</div>
          <div class="stat-sub">录制数量 ${tasks.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">项目已审核通过时长</div>
          <div class="stat-value green">${(passedDuration / 3600).toFixed(2)}h</div>
          <div class="stat-sub">通过数量 ${passedTasks.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">项目已驳回时长</div>
          <div class="stat-value red">${(failedDuration / 3600).toFixed(2)}h</div>
          <div class="stat-sub">驳回数量 ${failedTasks.length}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>录制统计（模拟数据）</span>
          <button class="btn btn-sm secondary" onclick="resetData()">重置数据</button>
        </div>
        <div class="stats-grid" style="margin-bottom: 0;">
          <div class="stat-card" style="background: transparent; border: none; padding: 0;">
            <div class="stat-label">录制数量总数</div>
            <div class="stat-value">${tasks.length}</div>
            <div class="stat-sub">累计时长 ${(totalDuration / 3600).toFixed(2)}h</div>
          </div>
          <div class="stat-card" style="background: transparent; border: none; padding: 0;">
            <div class="stat-label">已审核通过数量</div>
            <div class="stat-value green">${passedTasks.length}</div>
            <div class="stat-sub">通过率 ${tasks.length > 0 ? ((passedTasks.length / tasks.length) * 100).toFixed(1) : 0}%</div>
          </div>
          <div class="stat-card" style="background: transparent; border: none; padding: 0;">
            <div class="stat-label">已驳回数量</div>
            <div class="stat-value red">${failedTasks.length}</div>
            <div class="stat-sub">不通过率 ${tasks.length > 0 ? ((failedTasks.length / tasks.length) * 100).toFixed(1) : 0}%</div>
          </div>
          <div class="stat-card" style="background: transparent; border: none; padding: 0;">
            <div class="stat-label">待处理数量</div>
            <div class="stat-value yellow">${pendingTasks.length}</div>
            <div class="stat-sub">含 OTS 不通过 / 待质检 / 审核中</div>
          </div>
        </div>
      </div>

      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">项目</span>
          <select class="filter-select" onchange="updateFilter('dashboard', 'project', this.value)">
            <option value="">全部项目</option>
            <option value="诺亦腾项目" ${state.filters.dashboard.project === "诺亦腾项目" ? "selected" : ""}>诺亦腾项目</option>
            <option value="居家场景采集任务" ${state.filters.dashboard.project === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <div class="filter-item">
          <span class="filter-label">场景任务</span>
          <select class="filter-select" onchange="updateFilter('dashboard', 'scene', this.value)">
            <option value="">全部场景</option>
            <option value="--" ${state.filters.dashboard.scene === "--" ? "selected" : ""}>--</option>
            <option value="居家场景采集任务" ${state.filters.dashboard.scene === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <div class="filter-item">
          <input class="filter-input" placeholder="搜索关键词" value="${state.filters.dashboard.keyword}" onchange="updateFilter('dashboard', 'keyword', this.value)">
        </div>
        <button class="filter-btn secondary" onclick="clearFilters('dashboard')">重置</button>
      </div>

      <div class="table-container">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>记录编号</th>
                <th>标题</th>
                <th>录制用户</th>
                <th>项目</th>
                <th>场景任务</th>
                <th>时长</th>
                <th>当前状态</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              ${pagination.items.length > 0 ? pagination.items.map(task => `
                <tr>
                  <td style="color: #4a8eff; cursor: pointer;">${task.id}</td>
                  <td>${task.title}</td>
                  <td>${task.recordUser}</td>
                  <td>${task.project}</td>
                  <td>${task.scene}</td>
                  <td style="color: #f59e0b; font-weight: 500;">${task.duration}</td>
                  <td>${getStatusTag(task.status)}</td>
                  <td>${task.submitTime}</td>
                </tr>
              `).join("") : `
                <tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无数据</div></div></td></tr>
              `}
            </tbody>
          </table>
        </div>
        ${renderPagination(pagination, "dashboard")}
      </div>
    `;
  }

  // ========== 录制记录页面 ==========
  function renderRecordings() {
    const filtered = filterTasks(state.tasks, "recordings");
    const pagination = paginate(filtered, "recordings");

    return `
      <div class="page-header">
        <div class="page-title">录制记录</div>
        <div class="page-desc">查看所有录制任务的详细信息，支持多条件筛选。</div>
      </div>

      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">用户ID</span>
          <input class="filter-input" placeholder="请输入用户ID" value="${state.filters.recordings.keyword}" onchange="updateFilter('recordings', 'keyword', this.value)">
        </div>
        <div class="filter-item">
          <span class="filter-label">录制编号</span>
          <input class="filter-input" placeholder="请输入录制编号">
        </div>
        <div class="filter-item">
          <span class="filter-label">选择项目</span>
          <select class="filter-select" onchange="updateFilter('recordings', 'project', this.value)">
            <option value="">全部项目</option>
            <option value="诺亦腾项目" ${state.filters.recordings.project === "诺亦腾项目" ? "selected" : ""}>诺亦腾项目</option>
            <option value="居家场景采集任务" ${state.filters.recordings.project === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <div class="filter-item">
          <span class="filter-label">选择场景任务</span>
          <select class="filter-select" onchange="updateFilter('recordings', 'scene', this.value)">
            <option value="">全部场景</option>
            <option value="--" ${state.filters.recordings.scene === "--" ? "selected" : ""}>--</option>
            <option value="居家场景采集任务" ${state.filters.recordings.scene === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <button class="filter-btn primary">查询</button>
        <button class="filter-btn secondary" onclick="clearFilters('recordings')">重置</button>
      </div>

      <div class="table-container">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>记录编号</th>
                <th>标题</th>
                <th>录制用户</th>
                <th>项目</th>
                <th>场景任务</th>
                <th>时长</th>
                <th>分类</th>
                <th>环境</th>
                <th>当前状态</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              ${pagination.items.length > 0 ? pagination.items.map(task => `
                <tr>
                  <td style="color: #4a8eff; cursor: pointer;">${task.id}</td>
                  <td>${task.title}</td>
                  <td>${task.recordUser}</td>
                  <td>${task.project}</td>
                  <td>${task.scene}</td>
                  <td style="color: #f59e0b; font-weight: 500;">${task.duration}</td>
                  <td>${task.category}</td>
                  <td>${task.environment}</td>
                  <td>${getStatusTag(task.status)}</td>
                  <td>${task.submitTime}</td>
                </tr>
              `).join("") : `
                <tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无数据</div></div></td></tr>
              `}
            </tbody>
          </table>
        </div>
        ${renderPagination(pagination, "recordings")}
      </div>
    `;
  }

  // ========== 质检池页面 ==========
  function renderPool() {
    const pendingTasks = state.tasks.filter(t => t.status === "pending");
    const filtered = filterTasks(pendingTasks, "pool");
    const sorted = sortTasks(filtered, "pool");
    const pagination = paginate(sorted, "pool");

    return `
      <div class="page-header">
        <div class="page-title">质检池</div>
        <div class="page-desc">展示上传完成且待人工审核的录制任务，支持质检员认领处理。</div>
      </div>

      <div class="tabs">
        <div class="tab active">全部</div>
        <div class="tab">未认领</div>
        <div class="tab">已认领</div>
        <div class="tab">已通过</div>
        <div class="tab">未通过</div>
      </div>

      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">用户ID</span>
          <input class="filter-input" placeholder="请输入用户ID" value="${state.filters.pool.keyword}" onchange="updateFilter('pool', 'keyword', this.value)">
        </div>
        <div class="filter-item">
          <span class="filter-label">录制编号</span>
          <input class="filter-input" placeholder="请输入录制编号">
        </div>
        <div class="filter-item">
          <span class="filter-label">选择项目</span>
          <select class="filter-select" onchange="updateFilter('pool', 'project', this.value)">
            <option value="">全部项目</option>
            <option value="诺亦腾项目" ${state.filters.pool.project === "诺亦腾项目" ? "selected" : ""}>诺亦腾项目</option>
            <option value="居家场景采集任务" ${state.filters.pool.project === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <div class="filter-item">
          <span class="filter-label">选择场景任务</span>
          <select class="filter-select" onchange="updateFilter('pool', 'scene', this.value)">
            <option value="">全部场景</option>
            <option value="--" ${state.filters.pool.scene === "--" ? "selected" : ""}>--</option>
            <option value="居家场景采集任务" ${state.filters.pool.scene === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <button class="filter-btn primary">查询</button>
        <button class="filter-btn secondary" onclick="clearFilters('pool')">重置</button>
      </div>

      <div class="table-container">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>记录编号</th>
                <th>标题</th>
                <th>审核人</th>
                <th>项目</th>
                <th>场景任务</th>
                <th>时长</th>
                <th>当前状态</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${pagination.items.length > 0 ? pagination.items.map(task => `
                <tr>
                  <td style="color: #4a8eff; cursor: pointer;">${task.id}</td>
                  <td>${task.title}</td>
                  <td>${task.reviewer || "--"}</td>
                  <td>${task.project}</td>
                  <td>${task.scene}</td>
                  <td style="color: #f59e0b; font-weight: 500;">${task.duration}</td>
                  <td>${getStatusTag(task.status)}</td>
                  <td>${task.submitTime}</td>
                  <td>
                    <button class="btn btn-sm primary" data-task-claim="${task.id}" onclick="claimTask('${task.id}')">认领</button>
                    <button class="btn btn-sm secondary" style="margin-left: 6px;">查看详情</button>
                  </td>
                </tr>
              `).join("") : `
                <tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无待认领任务</div></div></td></tr>
              `}
            </tbody>
          </table>
        </div>
        ${renderPagination(pagination, "pool")}
      </div>
    `;
  }

  // 认领任务
  function claimTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.status !== "pending") {
      showToast("该任务已被认领", "error");
      return;
    }

    task.status = "claimed";
    task.reviewer = "qczyj05_nr";
    task.claimTimeTs = Date.now();
    saveState();
    showToast(`认领成功：${taskId}`, "success");
    // 模拟真实平台行为：认领成功后自动跳转到我的审核任务页面
    // （任务批量领取助手插件会阻止这个跳转，实现批量领取）
    navigateTo("mine");
  }

  // ========== 我的审核任务页面 ==========
  function renderMine() {
    const myTasks = state.tasks.filter(t => t.reviewer === "qczyj05_nr" && t.status !== "pending");
    const filtered = filterTasks(myTasks, "mine");
    const sorted = sortTasks(filtered, "mine");
    const pagination = paginate(sorted, "mine");

    const total = myTasks.length;
    const passed = myTasks.filter(t => t.status === "passed").length;
    const failed = myTasks.filter(t => t.status === "failed").length;
    const unreviewed = myTasks.filter(t => t.status === "claimed").length;
    const totalDuration = myTasks.reduce((sum, t) => sum + t.durationSec, 0);
    const passedDuration = myTasks.filter(t => t.status === "passed").reduce((sum, t) => sum + t.durationSec, 0);
    const failedDuration = myTasks.filter(t => t.status === "failed").reduce((sum, t) => sum + t.durationSec, 0);
    const unreviewedDuration = myTasks.filter(t => t.status === "claimed").reduce((sum, t) => sum + t.durationSec, 0);

    return `
      <div class="page-header">
        <div class="page-title">我的审核任务</div>
        <div class="page-desc">查看当前质检员已认领的任务，提交人工审核结论。</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">我的审核总数</div>
          <div class="stat-value">${total.toFixed(2)}</div>
          <div class="stat-sub">时长 ${(totalDuration / 3600).toFixed(2)}h</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">通过总数</div>
          <div class="stat-value green">${passed.toFixed(2)}</div>
          <div class="stat-sub">时长 ${(passedDuration / 3600).toFixed(2)}h</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">不通过总数</div>
          <div class="stat-value red">${failed.toFixed(2)}</div>
          <div class="stat-sub">时长 ${(failedDuration / 3600).toFixed(2)}h</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">未审核总数</div>
          <div class="stat-value yellow">${unreviewed.toFixed(2)}</div>
          <div class="stat-sub">时长 ${(unreviewedDuration / 3600).toFixed(2)}h</div>
        </div>
      </div>

      <div class="tabs">
        <div class="tab ${state.filters.mine.status === "" ? "active" : ""}" onclick="updateFilter('mine', 'status', '')">全部</div>
        <div class="tab ${state.filters.mine.status === "unreviewed" ? "active" : ""}" onclick="updateFilter('mine', 'status', 'unreviewed')">未审核</div>
        <div class="tab ${state.filters.mine.status === "reviewed" ? "active" : ""}" onclick="updateFilter('mine', 'status', 'reviewed')">已审核</div>
      </div>

      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">用户ID</span>
          <input class="filter-input" placeholder="请输入用户ID" value="${state.filters.mine.keyword}" onchange="updateFilter('mine', 'keyword', this.value)">
        </div>
        <div class="filter-item">
          <span class="filter-label">录制编号</span>
          <input class="filter-input" placeholder="请输入录制编号">
        </div>
        <div class="filter-item">
          <span class="filter-label">选择项目</span>
          <select class="filter-select" onchange="updateFilter('mine', 'project', this.value)">
            <option value="">全部项目</option>
            <option value="诺亦腾项目" ${state.filters.mine.project === "诺亦腾项目" ? "selected" : ""}>诺亦腾项目</option>
            <option value="居家场景采集任务" ${state.filters.mine.project === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <div class="filter-item">
          <span class="filter-label">选择场景任务</span>
          <select class="filter-select" onchange="updateFilter('mine', 'scene', this.value)">
            <option value="">全部场景</option>
            <option value="--" ${state.filters.mine.scene === "--" ? "selected" : ""}>--</option>
            <option value="居家场景采集任务" ${state.filters.mine.scene === "居家场景采集任务" ? "selected" : ""}>居家场景采集任务</option>
          </select>
        </div>
        <button class="filter-btn primary">查询</button>
        <button class="filter-btn secondary" onclick="clearFilters('mine')">重置</button>
      </div>

      <div class="table-container">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>记录编号</th>
                <th>标题</th>
                <th>审核人</th>
                <th>项目</th>
                <th>场景任务</th>
                <th>时长</th>
                <th>当前状态</th>
                <th>最新驳回</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${pagination.items.length > 0 ? pagination.items.map(task => `
                <tr>
                  <td style="color: #4a8eff; cursor: pointer;">${task.id}</td>
                  <td>${task.title}</td>
                  <td>${task.reviewer}</td>
                  <td>${task.project}</td>
                  <td>${task.scene}</td>
                  <td style="color: #f59e0b; font-weight: 500;">${task.duration}</td>
                  <td>${getStatusTag(task.status)}</td>
                  <td>${task.reviewReason || "--"}</td>
                  <td>${task.submitTime}</td>
                  <td>
                    ${task.status === "claimed" ? `
                      <button class="btn btn-sm primary" onclick="navigateTo('review', '${task.id}')">审核</button>
                    ` : `
                      <button class="btn btn-sm secondary" onclick="navigateTo('review', '${task.id}')">查看</button>
                    `}
                  </td>
                </tr>
              `).join("") : `
                <tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无任务</div></div></td></tr>
              `}
            </tbody>
          </table>
        </div>
        ${renderPagination(pagination, "mine")}
      </div>
    `;
  }

  // ========== 审核详情页面 ==========
  function renderReview() {
    const task = state.tasks.find(t => t.id === state.currentTaskId);
    if (!task) {
      return `
        <div class="page-header">
          <div class="page-title">审核详情</div>
        </div>
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-text">任务不存在</div>
          <button class="btn primary" style="margin-top: 16px;" onclick="navigateTo('mine')">返回我的审核任务</button>
        </div>
      `;
    }

    const sessionId = task.id.replace(/^R(\d{8}).*/, '$1') + '_' + Math.floor(10000 + Math.random() * 90000);

    return `
      <div class="review-header">
        <button class="back-btn" onclick="navigateTo('mine')">← 返回</button>
      </div>

      <div class="page-header">
        <div class="page-title">审核详情</div>
        <div class="page-desc">查看录制任务基础信息、媒体预览与审核记录。</div>
      </div>

      <div class="session-id">
        <div class="session-label">记录编号</div>
        <div class="session-value">${task.id}</div>
      </div>

      <div class="session-id">
        <div class="session-label">Session ID</div>
        <div class="session-value">${sessionId}</div>
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div style="padding: 16px 20px; border-bottom: 1px solid rgba(100,150,255,0.1);">
          <div style="font-size: 16px; font-weight: 600; color: #fff;">${task.title}</div>
        </div>
        <div class="info-grid" style="padding: 20px; margin-bottom: 0;">
          <div class="info-item">
            <div class="info-label">当前状态</div>
            <div class="info-value">${getStatusTag(task.status)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">当前处理人</div>
            <div class="info-value">${task.reviewer}</div>
          </div>
          <div class="info-item">
            <div class="info-label">录制用户ID</div>
            <div class="info-value">${task.recordUser}</div>
          </div>
          <div class="info-item">
            <div class="info-label">录制用户</div>
            <div class="info-value">--</div>
          </div>
          <div class="info-item">
            <div class="info-label">项目</div>
            <div class="info-value">${task.project}</div>
          </div>
          <div class="info-item">
            <div class="info-label">任务</div>
            <div class="info-value">--</div>
          </div>
          <div class="info-item">
            <div class="info-label">分类</div>
            <div class="info-value">${task.category}</div>
          </div>
          <div class="info-item">
            <div class="info-label">场景</div>
            <div class="info-value">${task.scene}</div>
          </div>
          <div class="info-item">
            <div class="info-label">环境</div>
            <div class="info-value">${task.environment}</div>
          </div>
          <div class="info-item">
            <div class="info-label">录制时长</div>
            <div class="info-value highlight">${task.duration}</div>
          </div>
          <div class="info-item">
            <div class="info-label">提交时间</div>
            <div class="info-value">${task.submitTime}</div>
          </div>
          <div class="info-item">
            <div class="info-label">存储桶</div>
            <div class="info-value">${task.storageBucket}</div>
          </div>
        </div>
      </div>

      <div class="video-section">
        <div class="video-section-title">
          <span>媒体预览</span>
          <button class="btn btn-sm secondary">在线裁剪</button>
        </div>
        <div style="font-size: 13px; color: #8b9bb8; margin-bottom: 12px;">视频预览</div>
        <div class="video-player" style="max-height: 360px; max-width: 640px; margin: 0 auto;">
          <video controls poster="" style="max-height: 360px;" onerror="this.parentElement.innerHTML='<div style=\\'padding:40px;text-align:center;color:#f59e0b;\\'>视频加载中...如长时间无法播放，请检查网络连接<br><span style=\\'font-size:12px;color:#6b7a99;\\'>视频源：${task.videoUrl.substring(0, 50)}...</span></div>'">
            <source src="${task.videoUrl}" type="video/mp4">
            您的浏览器不支持视频播放。
          </video>
        </div>
        <div style="font-size: 13px; color: #8b9bb8; margin: 20px 0 12px;">图片预览</div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <span style="font-size: 12px; color: #6b7a99;">抽帧间隔</span>
          <button class="btn btn-sm ${true ? 'primary' : 'secondary'}">5s</button>
          <button class="btn btn-sm secondary">10s</button>
        </div>
        <div class="image-preview-grid">
          ${[1,2,3,4,5,6,7,8].map(i => `
            <div class="image-preview-item" onclick="showToast('图片预览功能演示')">
              📷 抽帧 ${i}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="checklist-section">
        <div class="checklist-title">人工质检检查项</div>
        <table class="checklist-table">
          <thead>
            <tr>
              <th style="width: 50px;">序号</th>
              <th>检查项</th>
              <th style="width: 120px;">检查结果</th>
              <th style="width: 200px;">备注</th>
            </tr>
          </thead>
          <tbody>
            ${[
              "视频画面清晰，无模糊、花屏、黑屏",
              "音频清晰，无杂音、静音、不同步",
              "人物动作完整，无截断、缺失",
              "场景环境符合任务要求",
              "录制时长符合要求（不少于1分钟）",
              "无违规内容、无敏感信息"
            ].map((item, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${item}</td>
                <td>
                  <label style="margin-right: 12px; cursor: pointer;">
                    <input type="radio" name="check_${i}" value="pass" style="accent-color: #10b981;"> 通过
                  </label>
                  <label style="cursor: pointer;">
                    <input type="radio" name="check_${i}" value="fail" style="accent-color: #ef4444;"> 不通过
                  </label>
                </td>
                <td><input type="text" class="filter-input" style="min-width: auto; width: 100%;" placeholder="备注（选填）"></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="checklist-section">
        <div class="checklist-title">打标检查项</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
          ${[
            "人物着装规范", "场景光照充足", "设备摆放正确",
            "动作完成度高", "语音指令清晰", "环境无干扰"
          ].map(item => `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px 12px; background: #0a0e1a; border-radius: 6px; border: 1px solid rgba(100,150,255,0.1);">
              <input type="checkbox" style="accent-color: #4a8eff; width: 16px; height: 16px;">
              <span style="font-size: 13px; color: #b0c4de;">${item}</span>
            </label>
          `).join("")}
        </div>
      </div>

      ${task.status === "claimed" ? `
        <div class="submit-section">
          <div class="submit-title">提交审核</div>
          <div class="radio-group">
            <label class="radio-item pass">
              <input type="radio" name="reviewResult" value="pass" onchange="state.reviewForm.result='pass'">
              <span style="font-size: 15px; font-weight: 500;">✓ 通过</span>
            </label>
            <label class="radio-item fail">
              <input type="radio" name="reviewResult" value="fail" onchange="state.reviewForm.result='fail'">
              <span style="font-size: 15px; font-weight: 500;">✗ 不通过</span>
            </label>
          </div>
          <textarea class="textarea" id="reviewReason" placeholder="请输入不通过原因（不通过时必填）..."></textarea>
          <div class="submit-actions">
            <button class="btn secondary" onclick="navigateTo('mine')">取消</button>
            <button class="btn-submit" onclick="submitReview('${task.id}')">提交审核</button>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="card-title">审核结果</div>
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
            ${task.status === "passed" ? `<span class="status-tag passed" style="font-size: 14px; padding: 6px 16px;">已通过</span>` : `<span class="status-tag failed" style="font-size: 14px; padding: 6px 16px;">未通过</span>`}
            <span style="font-size: 13px; color: #6b7a99;">审核时间：${task.reviewTimeTs ? formatDateTime(new Date(task.reviewTimeTs)) : "--"}</span>
          </div>
          ${task.reviewReason ? `
            <div style="font-size: 13px; color: #b0c4de;">
              <span style="color: #ef4444; font-weight: 500;">不通过原因：</span>${task.reviewReason}
            </div>
          ` : ""}
        </div>
      `}
    `;
  }

  // 提交审核
  function submitReview(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const result = state.reviewForm.result;
    const reason = document.getElementById("reviewReason")?.value || "";

    if (!result) {
      showToast("请选择审核结果（通过/不通过）", "error");
      return;
    }

    if (result === "fail" && !reason.trim()) {
      showToast("不通过时请填写原因", "error");
      return;
    }

    task.status = result === "pass" ? "passed" : "failed";
    task.reviewResult = result;
    task.reviewReason = reason;
    task.reviewTimeTs = Date.now();
    state.reviewForm.result = "";
    saveState();

    showToast(result === "pass" ? "审核通过，提交成功" : "审核不通过，已提交", "success");

    setTimeout(() => {
      navigateTo("mine");
    }, 1000);
  }

  // ========== 初始化 ==========
  function init() {
    // 加载数据
    if (!loadState()) {
      state.tasks = generateTasks();
      saveState();
    }

    // 绑定模态框关闭
    document.getElementById("modalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") {
        closeModal();
      }
    });

    // 监听任务批量领取助手插件的 postMessage 请求
    // 插件拦截认领按钮点击后，会发送 tch_page_claim 消息
    // 模拟平台本地执行认领逻辑并返回成功，实现"不跳转批量领取"的演示效果
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "tch_page_claim") return;

      const recordId = e.data.recordId;
      const callbackId = e.data.callbackId;

      if (!recordId || !callbackId) return;

      console.log("[模拟平台] 收到插件认领请求:", recordId);

      // 本地执行认领逻辑
      const task = state.tasks.find(t => t.id === recordId);
      let success = false;

      if (task && task.status === "pending") {
        task.status = "claimed";
        task.reviewer = "qczyj05_nr";
        task.claimTimeTs = Date.now();
        saveState();
        success = true;
        console.log("[模拟平台] 本地认领成功:", recordId);
      } else if (task && task.status !== "pending") {
        // 任务已被认领，返回409冲突（模拟真实平台的并发冲突）
        window.postMessage({
          type: "tch_page_claim_result",
          callbackId: callbackId,
          ok: false,
          status: 409,
          body: { message: "任务已被领取" }
        }, "*");
        return;
      }

      // 返回认领结果给插件
      window.postMessage({
        type: "tch_page_claim_result",
        callbackId: callbackId,
        ok: success,
        status: success ? 200 : 404,
        body: success ? { success: true, recordId: recordId } : { message: "任务不存在" }
      }, "*");
    });

    // 渲染首页
    navigateTo("dashboard");

    console.log("[PDATA模拟平台] 初始化完成，共 " + state.tasks.length + " 条任务数据");
  }

  // 暴露全局函数
  window.state = state;
  window.navigateTo = navigateTo;
  window.goToPage = goToPage;
  window.updateFilter = updateFilter;
  window.clearFilters = clearFilters;
  window.claimTask = claimTask;
  window.submitReview = submitReview;
  window.closeModal = closeModal;
  window.resetData = resetData;

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
