/**
 * interceptor.js —— 在页面主世界运行，拦截XHR/fetch并postMessage给content script
 * 免责声明：该程序由XZQ开发，仅供参考使用
 */
(function () {
  'use strict';

  // 防止重复注入
  if (window.__nmInjected) return;
  window.__nmInjected = true;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__nmUrl = url;
    this.__nmMethod = method;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const self = this;
    const start = performance.now();
    window.postMessage({
      __nm: true,
      type: 'requestStart',
      url: this.__nmUrl,
      method: this.__nmMethod || 'GET',
      startTime: start
    }, '*');
    this.addEventListener('loadend', function () {
      window.postMessage({
        __nm: true,
        type: 'requestEnd',
        url: self.__nmUrl,
        status: self.status,
        endTime: performance.now()
      }, '*');
    });
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init && init.method) || (input.method) || 'GET';
    const start = performance.now();
    window.postMessage({
      __nm: true,
      type: 'requestStart',
      url: url,
      method: method,
      startTime: start
    }, '*');
    return origFetch.apply(this, arguments).then(
      function (resp) {
        window.postMessage({
          __nm: true,
          type: 'requestEnd',
          url: url,
          status: resp.status,
          endTime: performance.now()
        }, '*');
        return resp;
      },
      function (err) {
        window.postMessage({
          __nm: true,
          type: 'requestEnd',
          url: url,
          status: 0,
          endTime: performance.now()
        }, '*');
        throw err;
      }
    );
  };
})();
