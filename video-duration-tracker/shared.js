/**
 * shared.js —— 纯逻辑，供 background / content / popup / 测试共用
 * 不依赖 DOM（除 extractTaskId 可选传入 document）
 * 免责声明：该程序由XZQ开发，仅供参考使用
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.VDTShared = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "video_records";
  const SETTINGS_KEY = "settings";
  const REV_KEY = "video_records_rev";
  const MAX_RECORDS = 2000;
  const VIDEO_SRC_MAX_LEN = 500;
  const TITLE_MAX_LEN = 300;
  const URL_MAX_LEN = 2000;
  const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
  // 任务ID正则：支持 AC 平台 日期_时间_UUID 格式（如 20261008_121530_963f384f-a8b6-...）
  // 注意：结尾不能用 \b，因为时间部分后面跟着下划线（单词字符），\b 不成立
  const TASK_ID_RE = /\b(\d{8}_\d{4,})/;
  const RECORD_ID_RE = /\b(R\d{8}[a-zA-Z]+\d{4,})\b/;
  const AUTO_EXPORT_DEBOUNCE_MS = 5000;

  const defaultSettings = {
    autoExport: false,
    fileName: "video_durations.txt",
    showFloatingBall: true
  };

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return "未知";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function formatSeconds(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function clampString(value, max) {
    const s = value == null ? "" : String(value);
    return s.length > max ? s.slice(0, max) : s;
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      const keepParams = [
        "v", "id", "videoid", "video_id", "bvid", "aid", "cid",
        "episode_id", "media_id", "room_id", "live_id", "vid",
        "movie_id", "series_id", "album_id"
      ];
      const toDelete = [];
      for (const key of u.searchParams.keys()) {
        // 去掉 AC 平台 iframe 标记参数，确保 iframe 和主页面 URL 一致
        if (key === "__aether_frame") {
          toDelete.push(key);
          continue;
        }
        if (!keepParams.includes(key.toLowerCase())) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((k) => u.searchParams.delete(k));
      let result = u.toString();
      if (result.endsWith("/")) result = result.slice(0, -1);
      return result;
    } catch {
      return url || "";
    }
  }

  function makeDedupKey(record) {
    const taskPart = record.taskFromPage || record.videoSrcBase || normalizeUrl(record.url || "");
    const duration = Math.round(Number(record.duration) || 0);
    return taskPart + "|" + duration;
  }

  function getVideoId(video) {
    const src = (video && (video.currentSrc || video.src)) || "";
    return src || "";
  }

  function getVideoSourceBase(video) {
    const src = (video && (video.currentSrc || video.src)) || "";
    if (!src) return "";
    if (src.startsWith("blob:")) {
      try {
        return "blob:" + new URL(src).origin;
      } catch {
        return "blob";
      }
    }
    try {
      const u = new URL(src);
      return u.origin + u.pathname;
    } catch {
      return src;
    }
  }

  function shouldReportVideo(video) {
    if (!video) return false;
    const duration = Number(video.duration);
    return isFinite(duration) && duration > 0;
  }

  function extractTaskIdFromText(text) {
    const m = String(text || "").match(TASK_ID_RE);
    return m ? m[1] : null;
  }

  function extractRecordIdFromText(text) {
    const m = String(text || "").match(RECORD_ID_RE);
    return m ? m[1] : null;
  }

  /**
   * 记录编号提取：从页面文本中提取 R20260912runxun0011198 格式的记录编号
   */
  function extractRecordId(doc, href, title) {
    const fromHref = extractRecordIdFromText(href);
    if (fromHref) return fromHref;
    const fromTitle = extractRecordIdFromText(title);
    if (fromTitle) return fromTitle;
    if (!doc || !doc.querySelectorAll) return null;
    try {
      // 优先查找表格中的记录编号列
      const tableCells = doc.querySelectorAll("td:first-child, .record-id, [class*='record'], [class*='Record']");
      const cellLimit = Math.min(tableCells.length, 50);
      for (let i = 0; i < cellLimit; i++) {
        const m = extractRecordIdFromText(String(tableCells[i].textContent || "").slice(0, 200));
        if (m) return m;
      }
      // 再查页面文本前30KB
      const text = String((doc.body && doc.body.textContent) || "").slice(0, 30000);
      return extractRecordIdFromText(text);
    } catch {
      return null;
    }
  }

  /**
   * 任务号提取：URL / title 优先，再查少量标记节点，最后只切 body.textContent 前 20KB。
   * 不用 innerText，避免强制整页布局。
   */
  function extractTaskId(doc, href, title) {
    const fromHref = extractTaskIdFromText(href);
    if (fromHref) return fromHref;
    const fromTitle = extractTaskIdFromText(title);
    if (fromTitle) return fromTitle;
    if (!doc || !doc.querySelectorAll) return null;
    try {
      const labeled = doc.querySelectorAll(
        "[class*='session'], [id*='session'], [class*='task'], [id*='task'], [class*='Session'], [id*='Session']"
      );
      const labeledLimit = Math.min(labeled.length, 40);
      for (let i = 0; i < labeledLimit; i++) {
        const m = extractTaskIdFromText(String(labeled[i].textContent || "").slice(0, 500));
        if (m) return m;
      }
      const text = String((doc.body && doc.body.textContent) || "").slice(0, 20000);
      const session = text.match(/Session\s*ID[\s\S]{0,80}?(\d{8}_\d{4,})/i);
      if (session) return session[1];
      return extractTaskIdFromText(text);
    } catch {
      return null;
    }
  }

  /**
   * 审核结论：
   * 1) 旧 PDATA 平台：已选中的 radio 及其 label
   * 2) 新 AetherCapture 平台：总体结论下拉框 select（PASS/REJECT/REWORK/NEEDS_REVIEW）
   * 3) AC 平台更新后：自定义下拉组件（div 模拟的 select，非原生 select）
   */
  function readReviewResult(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    // 1) 单选按钮（旧平台）
    const checked = doc.querySelectorAll('input[type="radio"]:checked');
    for (let i = 0; i < checked.length; i++) {
      const radio = checked[i];
      const chunks = [];
      if (radio.labels) {
        for (let j = 0; j < radio.labels.length; j++) {
          chunks.push(radio.labels[j].textContent || "");
        }
      }
      const parent = radio.closest("label") || radio.parentElement;
      if (parent) chunks.push(parent.textContent || "");
      const text = chunks.join(" ").replace(/\s+/g, " ").trim();
      if (text.includes("不通过")) return "fail";
      if (text.includes("通过")) return "pass";
    }

    // 2) 总体结论下拉框（原生 select）
    const verdictSelect = findVerdictSelect(doc);
    if (verdictSelect) return mapVerdictSelect(verdictSelect);

    // 3) 自定义下拉组件（AC平台更新后用 div 模拟的下拉框）
    const customVerdict = readCustomDropdownVerdict(doc);
    if (customVerdict) return customVerdict;

    return null;
  }

  /**
   * 识别 AC 平台自定义下拉组件中已选中的结论。
   * 特征：在"最终结论/审核结论/质检结论/结论"标签附近，有一个 div 模拟的下拉框，
   * 选中后显示"通过"/"不通过"/"合格"/"不合格"等文本。
   */
  function readCustomDropdownVerdict(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    // 方法A：查找包含"结论"的标签，然后在其同级/父级容器内找下拉选中值
    try {
      const allElements = doc.querySelectorAll("label, span, div, p, td, th");
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        const text = String(el.textContent || "").trim();
        // 只匹配精确的"结论"标签文本（避免匹配到大片正文）
        if (text !== "最终结论" && text !== "审核结论" && text !== "质检结论" && text !== "结论") continue;
        if (el.children.length > 2) continue; // 跳过包含大量子元素的容器

        // 向上找最近的表单行/容器
        let container = el.closest('[class*="form"], [class*="row"], [class*="item"], [class*="field"], [class*="group"], tr, li');
        if (!container) container = el.parentElement;
        if (!container) continue;

        // 在容器内查找自定义下拉组件的选中值显示元素
        const dropdownTriggers = container.querySelectorAll(
          '[role="combobox"], [aria-haspopup], [class*="select"], [class*="dropdown"], [class*="combobox"], [class*="picker"]'
        );
        for (let j = 0; j < dropdownTriggers.length; j++) {
          const trigger = dropdownTriggers[j];
          // 排除"请选择结论"这种占位文本
          const val = String(trigger.textContent || "").replace(/\s+/g, " ").trim();
          if (!val || val === "请选择结论" || val === "请选择" || val.length > 30) continue;
          if (val.includes("不通过") || val.includes("不合格") || val.includes("驳回") || val.includes("废弃") || val.includes("返工")) return "fail";
          if (val.includes("通过") || val.includes("合格")) return "pass";
        }
      }
    } catch {
      /* ignore */
    }

    // 方法B：直接查找页面上所有 role="combobox" 或自定义select，看哪个的值是结论枚举
    try {
      const comboboxes = doc.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [class*="ant-select"], [class*="el-select"]');
      for (let i = 0; i < comboboxes.length; i++) {
        const cb = comboboxes[i];
        const val = String(cb.textContent || "").replace(/\s+/g, " ").trim();
        if (!val || val === "请选择结论" || val === "请选择" || val.length > 30) continue;
        // 只匹配结论相关的值
        if (val.includes("不通过") || val.includes("不合格") || val.includes("驳回") || val.includes("废弃") || val.includes("返工")) return "fail";
        if (val === "通过" || val === "合格" || (val.includes("通过") && val.length < 10)) return "pass";
      }
    } catch {
      /* ignore */
    }

    // 方法C：查找页面中已选中的结论文本（AC平台选中后可能在某个地方显示）
    try {
      const bodyText = String((doc.body && doc.body.textContent) || "").slice(0, 50000);
      // 查找"结论：通过"或"结论：不通过"这种模式
      const m = bodyText.match(/(?:最终结论|审核结论|质检结论|结论)[：:\s]*([^\n，。；]{2,10})/);
      if (m) {
        const val = m[1].trim();
        if (val.includes("不通过") || val.includes("不合格") || val.includes("驳回") || val.includes("废弃")) return "fail";
        if (val === "通过" || val === "合格") return "pass";
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  // 判断一个 select 的值是否是"审核结论"枚举（避免误拿语言/倍速/组织等下拉框）
  function isVerdictEnumValue(v) {
    return /^(PASS|REJECT|REWORK|NEEDS_REVIEW|FAIL)$/i.test(String(v || "").trim());
  }

  /**
   * 定位"总体结论"下拉框：
   * 1) 最精确：id="conclusion"（AC平台实测）
   * 2) id/name/class 含 conclusion/verdict/decision 的 select（不验证 value）
   * 3) 在含"最终结论/总体结论/审核结论/质检结论"的容器内找（含label），不验证 value
   * 4) 遍历所有 select，按结论枚举值匹配（检查 options 中是否有枚举值，不只是当前 value）
   * 5) 遍历所有 select，按选项文本匹配（中文选项兜底）
   */
  function findVerdictSelect(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    // 1) 按 id="conclusion" 精确匹配（AC平台实测）
    try {
      const byId = doc.getElementById("conclusion");
      if (byId && byId.tagName === "SELECT") return byId;
    } catch {
      /* ignore */
    }

    // 2) 按 id/name/class 精确匹配（不验证 value，AC平台 value 可能是中文或数字）
    try {
      const all = doc.querySelectorAll("select");
      for (let i = 0; i < all.length; i++) {
        const sel = all[i];
        const sig = `${sel.id || ""} ${sel.name || ""} ${sel.className || ""}`.toLowerCase();
        if (/(conclusion|verdict|decision|review-?result)/.test(sig)) {
          return sel;
        }
      }
    } catch {
      /* ignore */
    }

    // 3) 在含"最终结论/总体结论/审核结论/质检结论"的容器内找，优先最小容器，不验证 value
    try {
      const containers = doc.querySelectorAll(
        "[class*=decision], [class*=conclusion], [class*=verdict], [class*=review], form, section, label, div"
      );
      const matched = [];
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const cText = String(c.textContent || "");
        if (cText.length > 3000) continue; // 跳过太大的容器
        if (cText.includes("最终结论") || cText.includes("总体结论") || cText.includes("审核结论") || cText.includes("质检结论")) {
          matched.push(c);
        }
      }
      matched.sort((a, b) => {
        const ra = /decision-row|decision-box|conclusion-box|verdict-box|form-item|form-row/.test(a.className || "") ? 0 : 1;
        const rb = /decision-row|decision-box|conclusion-box|verdict-box|form-item|form-row/.test(b.className || "") ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return String(a.textContent || "").length - String(b.textContent || "").length;
      });
      for (let i = 0; i < matched.length; i++) {
        const sels = matched[i].querySelectorAll("select");
        if (sels.length > 0) return sels[0];
      }
    } catch {
      /* ignore */
    }

    // 4) 遍历所有 select，检查 options 中是否有结论枚举值（不只是当前 value，因为未选择时 value 为空）
    const selects = doc.querySelectorAll("select");
    for (let i = 0; i < selects.length; i++) {
      const sel = selects[i];
      try {
        if (isVerdictEnumValue(sel.value)) return sel;
        // 检查 options 中是否有枚举值
        if (sel.options) {
          for (let j = 0; j < sel.options.length; j++) {
            if (isVerdictEnumValue(sel.options[j].value)) return sel;
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 5) 兜底：遍历所有 select，按选项文本匹配（中文选项）
    for (let i = 0; i < selects.length; i++) {
      const sel = selects[i];
      try {
        const options = sel.options;
        if (!options || options.length === 0) continue;
        let hasVerdictOption = false;
        for (let j = 0; j < options.length; j++) {
          const optText = String(options[j].textContent || "").trim();
          if (optText === "通过" || optText === "不通过" || optText.includes("不通过") ||
              optText.includes("废弃") || optText.includes("返工") || optText === "待复核" ||
              optText.includes("合格") || optText.includes("不合格")) {
            hasVerdictOption = true;
            break;
          }
        }
        if (hasVerdictOption) return sel;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  /**
   * 把新平台结论下拉框的值映射为 pass / fail。
   * PASS=通过；REJECT=不通过并废弃；REWORK=返工（归入不通过）；
   * NEEDS_REVIEW=待复核（未最终结论，返回 null）。
   */
  function mapVerdictSelect(sel) {
    const val = String(sel.value || "").trim().toUpperCase();
    let text = "";
    try {
      if (sel.options && sel.selectedIndex >= 0) {
        text = String(sel.options[sel.selectedIndex].textContent || "").trim();
      }
    } catch {
      /* ignore */
    }

    if (val === "PASS") return "pass";
    if (val === "REJECT" || val === "FAIL" || val === "REWORK") return "fail";
    if (val === "NEEDS_REVIEW") return null;

    // 枚举值不匹配时，按显示文本判断
    if (text.includes("不通过") || text.includes("废弃") || text.includes("返工") || text.includes("驳回")) return "fail";
    if (text.includes("通过")) return "pass";
    return null;
  }

  function isSubmitReviewButton(target) {
    if (!target || !target.closest) return false;
    const btn = target.closest("button, [role=button], [type=submit]");
    if (!btn) return false;
    const btnText = String(btn.textContent || "").replace(/\s+/g, "").trim();
    if (!btnText) return false;
    // 旧 PDATA 平台："提交审核"；新 AetherCapture 平台："正式提交任务结论"
    return (
      btnText.includes("提交审核") ||
      btnText.includes("提交任务结论") ||
      btnText.includes("提交结论") ||
      (btnText.includes("提交") && btnText.includes("结论"))
    );
  }

  /**
   * 审核匹配：精确 taskFromPage，或完整 sessionId 出现在 URL 中（特定网址检测）。
   * 去掉模糊的 includes(taskFromPage 片段) / dedupKey includes。
   */
  function findReviewMatchIndex(records, sessionId) {
    if (!sessionId || !Array.isArray(records)) return -1;
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r && r.taskFromPage && r.taskFromPage === sessionId) return i;
      if (r && typeof r.url === "string" && r.url.includes(sessionId)) return i;
    }
    return -1;
  }

  function sanitizeRecord(input) {
    const rec = input && typeof input === "object" ? input : {};
    const duration = Number(rec.duration);
    const safeDuration = isFinite(duration) && duration >= 0 ? duration : 0;
    const url = clampString(rec.url, URL_MAX_LEN);
    const title = clampString(rec.title, TITLE_MAX_LEN);
    const videoSrc = clampString(rec.videoSrc, VIDEO_SRC_MAX_LEN);
    const reviewStatus =
      rec.reviewStatus === "pass" || rec.reviewStatus === "fail" || rec.reviewStatus === "pending"
        ? rec.reviewStatus
        : rec.reviewStatus ? String(rec.reviewStatus) : undefined;
    const out = {
      id: rec.id ? String(rec.id) : generateId(),
      url,
      title,
      videoSrc,
      videoSrcBase: clampString(rec.videoSrcBase, URL_MAX_LEN),
      taskFromPage: rec.taskFromPage ? String(rec.taskFromPage) : null,
      recordId: rec.recordId ? String(rec.recordId) : null,
      duration: safeDuration,
      durationText: rec.durationText ? String(rec.durationText) : formatDuration(safeDuration),
      timestamp: rec.timestamp ? String(rec.timestamp) : new Date().toISOString(),
      timestampText: rec.timestampText ? String(rec.timestampText) : new Date().toLocaleString("zh-CN"),
      dedupKey: rec.dedupKey ? String(rec.dedupKey) : makeDedupKey({
        taskFromPage: rec.taskFromPage,
        videoSrcBase: rec.videoSrcBase,
        url,
        duration: safeDuration
      })
    };
    if (reviewStatus) out.reviewStatus = reviewStatus;
    if (rec.reviewTime) out.reviewTime = String(rec.reviewTime);
    if (rec.reviewTimeText) out.reviewTimeText = String(rec.reviewTimeText);
    return out;
  }

  function capRecords(records, max) {
    const limit = max == null ? MAX_RECORDS : max;
    if (!Array.isArray(records) || records.length <= limit) return records || [];
    return records.slice(records.length - limit);
  }

  function upsertVideoRecord(records, rawRecord) {
    const list = Array.isArray(records) ? records.slice() : [];
    const record = sanitizeRecord(rawRecord);
    record.dedupKey = makeDedupKey(record);
    const existingIndex = list.findIndex((r) => (r.dedupKey || makeDedupKey(r)) === record.dedupKey);
    let isNew = false;
    if (existingIndex >= 0) {
      const prev = list[existingIndex];
      list[existingIndex] = { ...prev, ...record, id: prev.id || record.id };
    } else {
      list.push(record);
      isNew = true;
    }
    return { records: capRecords(list), isNew, record: existingIndex >= 0 ? list[existingIndex] : record };
  }

  function applyReviewResult(records, data) {
    const list = Array.isArray(records) ? records.slice() : [];
    const sessionId = data && data.sessionId;
    if (!sessionId) {
      return { records: list, ok: false, error: "未找到任务编号", matched: false, index: -1 };
    }
    const matchedIndex = findReviewMatchIndex(list, sessionId);
    if (matchedIndex < 0) {
      list.push(sanitizeRecord({
        url: data.url,
        title: data.title || "审核任务",
        videoSrc: "",
        videoSrcBase: "",
        taskFromPage: sessionId,
        duration: 0,
        durationText: "未知",
        timestamp: data.timestamp,
        timestampText: data.timestampText,
        reviewStatus: data.result,
        reviewTime: data.timestamp,
        reviewTimeText: data.timestampText,
        dedupKey: sessionId + "|0"
      }));
      const capped = capRecords(list);
      return { records: capped, ok: true, matched: false, index: capped.length - 1 };
    }
    list[matchedIndex] = {
      ...list[matchedIndex],
      reviewStatus: data.result,
      reviewTime: data.timestamp,
      reviewTimeText: data.timestampText
    };
    return { records: list, ok: true, matched: true, index: matchedIndex };
  }

  function updateRecordById(records, id, patch) {
    const list = Array.isArray(records) ? records.slice() : [];
    const index = list.findIndex((r) => r && r.id === id);
    if (index < 0) return { ok: false, error: "记录不存在", records: list };
    const nextPatch = patch && typeof patch === "object" ? { ...patch } : {};
    if (nextPatch.duration != null) {
      nextPatch.durationText = formatDuration(nextPatch.duration);
    }
    list[index] = sanitizeRecord({ ...list[index], ...nextPatch, id: list[index].id });
    return { ok: true, records: list };
  }

  function deleteRecordById(records, id) {
    const list = Array.isArray(records) ? records.slice() : [];
    const index = list.findIndex((r) => r && r.id === id);
    if (index < 0) return { ok: false, error: "记录不存在", records: list };
    list.splice(index, 1);
    return { ok: true, records: list };
  }

  function mergeImportedRecords(existing, imported) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    const incoming = Array.isArray(imported) ? imported : [];
    let added = 0;
    let updated = 0;
    incoming.forEach((rec) => {
      if (!rec || rec.duration == null || rec.duration === "") return;
      const duration = Number(rec.duration);
      if (!isFinite(duration) || duration < 0) return;
      const sanitized = sanitizeRecord({ ...rec, duration });
      const idx = merged.findIndex((r) => (r.dedupKey || "") === sanitized.dedupKey);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...sanitized, id: merged[idx].id || sanitized.id };
        updated++;
      } else {
        merged.push(sanitized);
        added++;
      }
    });
    return { records: capRecords(merged), added, updated };
  }

  function parseImportJson(text, byteLength) {
    if (byteLength != null && byteLength > IMPORT_MAX_BYTES) {
      return { ok: false, error: "文件过大，超过 5MB 限制" };
    }
    if (typeof text !== "string" || text.length > IMPORT_MAX_BYTES) {
      return { ok: false, error: "文件过大或格式无效" };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "文件格式不正确，请选择插件导出的 JSON 备份文件。" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "文件中没有可导入的记录数据。" };
    }
    const importedRecords = data.video_records;
    if (!Array.isArray(importedRecords) || importedRecords.length === 0) {
      return { ok: false, error: "文件中没有可导入的记录数据。" };
    }
    if (importedRecords.length > MAX_RECORDS * 2) {
      return { ok: false, error: "导入条数过多" };
    }
    return { ok: true, data, importedRecords };
  }

  function buildTxtContent(records) {
    const list = Array.isArray(records) ? records : [];
    let content = "视频时长记录\n";
    content += "=".repeat(60) + "\n";
    content += `导出时间: ${new Date().toLocaleString("zh-CN")}\n`;
    content += `记录总数: ${list.length}\n`;
    content += "=".repeat(60) + "\n\n";
    list.forEach((r, i) => {
      const statusText = r.reviewStatus === "pass" ? "通过 ✓" : r.reviewStatus === "fail" ? "不通过 ✕" : "未审核 ○";
      const duration = Number(r.duration);
      const durationFixed = isFinite(duration) ? duration.toFixed(1) : "0.0";
      content += `[${String(i + 1).padStart(3, "0")}] ${r.title || "无标题"}\n`;
      if (r.recordId) content += `      记录编号 : ${r.recordId}\n`;
      content += `      页面URL : ${r.url || ""}\n`;
      if (r.videoSrc) content += `      视频源   : ${r.videoSrc}\n`;
      content += `      时长     : ${r.durationText}  (${durationFixed} 秒)\n`;
      content += `      审核状态 : ${statusText}\n`;
      content += `      记录时间 : ${r.timestampText || ""}\n`;
      content += "-".repeat(60) + "\n";
    });
    const totalSeconds = list.reduce(
      (sum, r) => sum + (isFinite(r.duration) ? r.duration : 0),
      0
    );
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    content += `\n总时长: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}\n`;
    return content;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function reviewStatusMeta(status) {
    const value = status === "pass" || status === "fail" ? status : "pending";
    if (value === "pass") return { value, icon: "✓", className: "status-pass", title: "已通过" };
    if (value === "fail") return { value, icon: "✕", className: "status-fail", title: "不通过" };
    return { value: "pending", icon: "○", className: "status-pending", title: "未审核" };
  }

  function summarizeRecords(records) {
    const list = Array.isArray(records) ? records : [];
    let passCount = 0;
    let failCount = 0;
    let pendingCount = 0;
    let totalSeconds = 0;
    let passTotalSeconds = 0;
    let failTotalSeconds = 0;
    list.forEach((r) => {
      const dur = isFinite(r.duration) ? r.duration : 0;
      totalSeconds += dur;
      if (r.reviewStatus === "pass") {
        passCount++;
        passTotalSeconds += dur;
      } else if (r.reviewStatus === "fail") {
        failCount++;
        failTotalSeconds += dur;
      } else {
        pendingCount++;
      }
    });
    return {
      count: list.length,
      totalSeconds,
      totalText: formatSeconds(totalSeconds),
      passCount,
      passTotalSeconds,
      passTotalText: formatSeconds(passTotalSeconds),
      failCount,
      failTotalSeconds,
      failTotalText: formatSeconds(failTotalSeconds),
      pendingCount
    };
  }

  return {
    STORAGE_KEY,
    SETTINGS_KEY,
    REV_KEY,
    MAX_RECORDS,
    VIDEO_SRC_MAX_LEN,
    TITLE_MAX_LEN,
    URL_MAX_LEN,
    IMPORT_MAX_BYTES,
    TASK_ID_RE,
    RECORD_ID_RE,
    AUTO_EXPORT_DEBOUNCE_MS,
    defaultSettings,
    formatDuration,
    formatSeconds,
    generateId,
    normalizeUrl,
    makeDedupKey,
    getVideoId,
    getVideoSourceBase,
    shouldReportVideo,
    extractTaskIdFromText,
    extractTaskId,
    extractRecordIdFromText,
    extractRecordId,
    readReviewResult,
    isSubmitReviewButton,
    findReviewMatchIndex,
    sanitizeRecord,
    capRecords,
    upsertVideoRecord,
    applyReviewResult,
    updateRecordById,
    deleteRecordById,
    mergeImportedRecords,
    parseImportJson,
    buildTxtContent,
    escapeHtml,
    reviewStatusMeta,
    summarizeRecords
  };
});
