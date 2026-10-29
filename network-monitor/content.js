/**
 * content.js —— 网络请求监控助手
 * 拦截XHR/fetch + Performance API时间线 + 悬浮面板
 * 免责声明：该程序由XZQ开发，仅供参考使用
 */

(function () {
  'use strict';

  // ===== 数据存储 =====
  const requests = new Map();
  let nextId = 1;
  let panelOpen = false;
  let timerInterval = null;
  let ballEl = null, panelEl = null;

  // ===== 工具函数 =====
  function shortUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > 60 ? path.slice(0, 57) + '...' : path;
    } catch {
      return url.length > 60 ? url.slice(0, 57) + '...' : url;
    }
  }

  function formatMs(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  // ===== 渲染函数 =====
  function renderPanel() {
    if (!panelEl) return;
    if (!panelOpen) {
      const pending = [...requests.values()].filter(r => r.endTime === null).length;
      const badge = document.getElementById('nm-badge');
      if (badge) badge.textContent = pending;
      return;
    }
    const list = panelEl.querySelector('#nm-list');
    if (!list) return;
    const all = [...requests.values()].sort((a, b) => b.startTime - a.startTime).slice(0, 50);
    const pending = all.filter(r => r.endTime === null).length;
    const done = all.filter(r => r.endTime !== null && r.status >= 200 && r.status < 400).length;
    const failed = all.filter(r => r.endTime !== null && (r.status < 200 || r.status >= 400)).length;
    panelEl.querySelector('#nm-total').textContent = all.length;
    panelEl.querySelector('#nm-pending').textContent = pending;
    panelEl.querySelector('#nm-done').textContent = done;
    panelEl.querySelector('#nm-failed').textContent = failed;
    const now = performance.now();
    list.innerHTML = all.map(r => {
      const isPending = r.endTime === null;
      const elapsed = isPending ? now - r.startTime : r.duration;
      const mc = r.method.toLowerCase();
      const mClass = mc === 'get' ? 'get' : mc === 'post' ? 'post' : 'other';
      let statusHtml = isPending
        ? '<span class="nm-status pending">等待中</span>'
        : (r.status >= 200 && r.status < 400)
          ? `<span class="nm-status ok">${r.status}</span>`
          : `<span class="nm-status err">${r.status || 'ERR'}</span>`;

      // 行内彩色进度条（直接显示在每条请求下）
      let inlineBar = '';
      if (r.timing) {
        const total = r.duration || 1;
        const segs = [
          { ms: r.timing.dns, color: '#9aa0a6' },
          { ms: r.timing.tcp, color: '#1a73e8' },
          { ms: r.timing.tls, color: '#9334e6' },
          { ms: r.timing.wait, color: '#ea8600' },
          { ms: r.timing.download, color: '#137333' }
        ];
        inlineBar = `<div class="nm-inline-bar">${segs.map(s =>
          `<div class="nm-inline-seg" style="width:${(s.ms/total*100).toFixed(1)}%;background:${s.color}"></div>`
        ).join('')}</div>`;
      } else if (isPending) {
        inlineBar = `<div class="nm-inline-bar nm-pending-bar"></div>`;
      } else {
        // 没有详细timing时按总耗时染色：绿快(<300ms)/橙中(<1s)/红慢(>1s)
        const dur = r.duration || 0;
        const color = dur < 300 ? '#137333' : dur < 1000 ? '#ea8600' : '#ea4335';
        inlineBar = `<div class="nm-inline-bar"><div class="nm-inline-seg" style="width:100%;background:${color}"></div></div>`;
      }

      // 点击展开后的详细图例
      let detailHtml = '';
      if (r.timing) {
        const total = r.duration || 1;
        const segs = [
          { label: 'DNS', ms: r.timing.dns, color: '#9aa0a6' },
          { label: 'TCP', ms: r.timing.tcp, color: '#1a73e8' },
          { label: 'TLS', ms: r.timing.tls, color: '#9334e6' },
          { label: '等待', ms: r.timing.wait, color: '#ea8600' },
          { label: '下载', ms: r.timing.download, color: '#137333' }
        ].filter(s => s.ms > 0.5);
        const legendHtml = segs.map(s =>
          `<span><i style="background:${s.color}"></i>${s.label} ${formatMs(s.ms)}</span>`
        ).join('');
        detailHtml = `<div class="nm-detail"><div class="nm-legend">${legendHtml}</div></div>`;
      } else if (isPending) {
        detailHtml = `<div class="nm-detail">已等待 ${formatMs(elapsed)}...</div>`;
      }
      return `<div class="nm-item"><div class="nm-item-row">
        <span class="nm-method ${mClass}">${r.method.toUpperCase()}</span>
        <span class="nm-url">${shortUrl(r.url)}</span>${statusHtml}
        <span class="nm-time">${formatMs(elapsed)}</span></div>${inlineBar}${detailHtml}</div>`;
    }).join('');
  }

  // ===== 接收来自页面主世界的消息 =====
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__nm !== true) return;

    if (data.type === 'requestStart') {
      const id = nextId++;
      requests.set(id, {
        id,
        method: data.method,
        url: data.url,
        startTime: data.startTime,
        endTime: null,
        status: null,
        duration: null,
        timing: null
      });
      renderPanel();
    } else if (data.type === 'requestEnd') {
      // 根据url匹配最近的进行中请求
      let best = null;
      for (const r of requests.values()) {
        if (r.url === data.url && r.endTime === null) {
          if (!best || r.startTime > best.startTime) best = r;
        }
      }
      if (best) {
        best.endTime = data.endTime;
        best.status = data.status;
        best.duration = data.endTime - best.startTime;
        // 从Performance API获取时间分解
        setTimeout(() => {
          const entry = performance.getEntriesByType('resource').find(e => e.name === data.url);
          if (entry) {
            best.timing = {
              dns: entry.domainLookupEnd - entry.domainLookupStart,
              tcp: entry.connectEnd - entry.connectStart,
              tls: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
              wait: entry.responseStart - entry.requestStart,
              download: entry.responseEnd - entry.responseStart
            };
          }
          renderPanel();
        }, 50);
      }
      renderPanel();
    }
  });

  // ===== 注入拦截脚本到页面主世界（外部JS文件，绕过CSP） =====
  function injectInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }

  // ===== 创建UI =====
  function createUI() {
    if (document.getElementById('nm-ball')) return;
    const style = document.createElement('style');
    style.textContent = `
      #nm-ball{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:44px;height:44px;border-radius:50%;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:transform .15s;user-select:none}
      #nm-ball:hover{transform:scale(1.08)}
      #nm-ball .nm-badge{position:absolute;top:-4px;right:-4px;background:#ea4335;color:#fff;font-size:10px;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-weight:700}
      #nm-panel{position:fixed;right:16px;bottom:72px;z-index:2147483646;width:520px;max-height:480px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.25);display:none;flex-direction:column;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;color:#333;overflow:hidden}
      #nm-panel.open{display:flex}
      .nm-header{padding:12px 16px;background:#1a73e8;color:#fff;display:flex;justify-content:space-between;align-items:center}
      .nm-header .nm-title{font-size:14px;font-weight:600}
      .nm-header .nm-close{cursor:pointer;font-size:18px;padding:0 4px}
      .nm-stats{padding:8px 16px;background:#f1f3f4;display:flex;gap:16px;font-size:11px;color:#666;border-bottom:1px solid #e0e0e0}
      .nm-stats b{color:#1a73e8;font-size:13px}
      .nm-list{flex:1;overflow-y:auto}
      .nm-item{padding:8px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer}
      .nm-item:hover{background:#f8f9fa}
      .nm-item-row{display:flex;align-items:center;gap:8px}
      .nm-method{font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;min-width:42px;text-align:center}
      .nm-method.get{background:#e6f4ea;color:#137333}
      .nm-method.post{background:#e8f0fe;color:#1a73e8}
      .nm-method.other{background:#f1f3f4;color:#5f6368}
      .nm-url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333}
      .nm-status{font-size:11px;font-weight:600;min-width:36px;text-align:right}
      .nm-status.ok{color:#137333}.nm-status.err{color:#ea4335}.nm-status.pending{color:#f9ab00}
      .nm-time{font-size:11px;color:#888;min-width:60px;text-align:right}
      .nm-detail{display:none;margin-top:6px;padding:6px 8px;background:#f8f9fa;border-radius:4px;font-size:11px}
      .nm-item.open .nm-detail{display:block}
      .nm-legend{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap}
      .nm-legend span{display:flex;align-items:center;gap:3px;font-size:10px;color:#666}
      .nm-legend i{width:8px;height:8px;border-radius:2px;display:inline-block}
      .nm-inline-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:5px;background:#f0f0f0}
      .nm-inline-seg{height:100%}
      .nm-pending-bar{background:linear-gradient(90deg,#e8f0fe 0%,#1a73e8 50%,#e8f0fe 100%);background-size:200% 100%;animation:nm-shimmer 1.2s linear infinite}
      @keyframes nm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    `;
    (document.head || document.documentElement).appendChild(style);

    ballEl = document.createElement('div');
    ballEl.id = 'nm-ball';
    ballEl.innerHTML = '🌐<span class="nm-badge" id="nm-badge">0</span>';
    (document.body || document.documentElement).appendChild(ballEl);

    panelEl = document.createElement('div');
    panelEl.id = 'nm-panel';
    panelEl.innerHTML = `<div class="nm-header"><span class="nm-title">网络请求监控</span><span class="nm-close" id="nm-close">×</span></div>
      <div class="nm-stats">
        <span>总请求 <b id="nm-total">0</b></span>
        <span>进行中 <b id="nm-pending" style="color:#f9ab00">0</b></span>
        <span>完成 <b id="nm-done" style="color:#137333">0</b></span>
        <span>失败 <b id="nm-failed" style="color:#ea4335">0</b></span>
      </div>
      <div class="nm-list" id="nm-list"></div>`;
    (document.body || document.documentElement).appendChild(panelEl);

    ballEl.addEventListener('click', () => {
      panelOpen = !panelOpen;
      panelEl.classList.toggle('open', panelOpen);
      if (panelOpen) renderPanel();
    });
    panelEl.querySelector('#nm-close').addEventListener('click', () => {
      panelOpen = false; panelEl.classList.remove('open');
    });
    panelEl.querySelector('#nm-list').addEventListener('click', (e) => {
      const item = e.target.closest('.nm-item');
      if (item) item.classList.toggle('open');
    });
  }

  // ===== 初始化 =====
  function init() {
    // 拦截脚本尽早注入（抢在页面业务JS之前替换XHR/fetch）
    injectInterceptor();
    // UI等body ready再建
    if (document.body) {
      createUI();
    } else {
      document.addEventListener('DOMContentLoaded', createUI);
    }
    timerInterval = setInterval(() => {
      if (panelOpen) renderPanel();
      else {
        const pending = [...requests.values()].filter(r => r.endTime === null).length;
        const badge = document.getElementById('nm-badge');
        if (badge) badge.textContent = pending;
      }
    }, 1000);
  }

  init();
})();
