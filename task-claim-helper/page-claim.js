/**
 * page-claim.js —— 在页面上下文中执行（通过 web_accessible_resources 注入）
 * 接收 content script 的 postMessage，用页面的 fetch 发送认领请求（自动带上认证 cookies）
 */
(function () {
  "use strict";

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "tch_page_claim") return;

    var recordId = e.data.recordId;
    var callbackId = e.data.callbackId;

    if (!recordId || !callbackId) return;

    var url = "/admin/api/review/tasks/" + encodeURIComponent(recordId) + "/claim";

    // 从 localStorage 读取 JWT token（平台使用 Bearer token 认证）
    var token = localStorage.getItem("aethercapture.auth.token") || "";

    var headers = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: headers
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            window.postMessage(
              {
                type: "tch_page_claim_result",
                callbackId: callbackId,
                ok: response.ok,
                status: response.status,
                body: body
              },
              "*"
            );
          });
      })
      .catch(function (err) {
        window.postMessage(
          {
            type: "tch_page_claim_result",
            callbackId: callbackId,
            ok: false,
            error: err.message
          },
          "*"
        );
      });
  });
})();
