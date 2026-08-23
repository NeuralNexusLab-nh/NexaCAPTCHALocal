(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll(
      'script[src*="/captcha.js"], script[src*="/captcha/gravity.js"], script[src*="/captcha/algebra.js"]'
    );
    script = candidates[candidates.length - 1];
  }
  if (!script || !script.src) return;

  var loaderUrl = new URL(script.src, window.location.href);
  var serviceOrigin = loaderUrl.origin;
  var defaultCaptchaType = loaderUrl.pathname.includes("/captcha/algebra.js")
    ? "algebra"
    : "gravity";
  var instances = new WeakMap();
  var sequence = 0;

  function resolveTarget(target) {
    if (typeof target === "string") return document.querySelector(target);
    return target instanceof HTMLElement ? target : null;
  }

  function render(target, options) {
    var mount = resolveTarget(target);
    if (!mount) throw new Error("NexaCAPTCHA mount element was not found.");
    if (instances.has(mount)) return instances.get(mount);

    options = options || {};
    var captchaType = options.captchaType || mount.dataset.captchaType || defaultCaptchaType;
    if (captchaType !== "gravity" && captchaType !== "algebra") {
      throw new Error("Unsupported NexaCAPTCHA type.");
    }
    sequence += 1;
    var widgetId = "nexa_" + Date.now().toString(36) + "_" + sequence.toString(36);
    var result = { success: false, verificationId: null, responseToken: null };
    var listeners = [];
    var iframe = document.createElement("iframe");
    iframe.src =
      serviceOrigin +
      "/widget?v=10&parentOrigin=" +
      encodeURIComponent(window.location.origin) +
      "&widgetId=" +
      encodeURIComponent(widgetId) +
      "&captchaType=" +
      encodeURIComponent(captchaType);
    iframe.title = "NexaCAPTCHA verification";
    iframe.width = "100%";
    iframe.height = "360";
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
    iframe.setAttribute("referrerpolicy", "strict-origin");
    iframe.className = "nexacaptcha-frame";
    mount.replaceChildren(iframe);

    function notify(payload) {
      result = payload;
      listeners.forEach(function (listener) {
        listener(payload);
      });
      var callbackName = options.callback || mount.dataset.callback;
      if (callbackName && typeof window[callbackName] === "function") {
        window[callbackName](payload);
      }
      if (payload.success && typeof options.onComplete === "function") {
        options.onComplete(payload);
      }
    }

    function onMessage(event) {
      if (event.origin !== serviceOrigin || event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || data.namespace !== "NexaCAPTCHA" || data.widgetId !== widgetId) return;
      if (data.type === "resize" && Number.isFinite(data.height)) {
        iframe.height = String(Math.max(260, Math.min(520, data.height)));
      }
      if (data.type === "result") notify(data.result);
    }

    window.addEventListener("message", onMessage);
    var api = {
      getResult: function () {
        return Object.assign({}, result);
      },
      onComplete: function (listener) {
        if (typeof listener !== "function") {
          throw new TypeError("onComplete requires a function.");
        }
        listeners.push(listener);
        return function () {
          listeners = listeners.filter(function (entry) {
            return entry !== listener;
          });
        };
      },
      reset: function () {
        result = { success: false, verificationId: null, responseToken: null };
        iframe.contentWindow.postMessage(
          { namespace: "NexaCAPTCHA", widgetId: widgetId, type: "reset" },
          serviceOrigin
        );
      },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        instances.delete(mount);
        mount.replaceChildren();
      }
    };
    instances.set(mount, api);
    return api;
  }

  function autoMount() {
    document.querySelectorAll(".nexa-captcha").forEach(function (element) {
      if (!instances.has(element)) render(element);
    });
  }

  window.NexaCAPTCHA = Object.freeze({ render: render });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  } else {
    autoMount();
  }
})();
