/*
 * FSM push bootstrap.
 *
 * This file is copied into the native projects by `npm run sync` and injected
 * by the native shell into the remote FSM page after the page has loaded. It
 * must not depend on the FSM web app being rebuilt: the native shell owns
 * permission, token registration and notification taps, while this script
 * talks to the same origin as the loaded FSM server.
 *
 * Server contract:
 *   POST   /api/mobile/push-tokens  { token, platform, appVersion?, deviceId? }
 *   DELETE /api/mobile/push-tokens  { token }
 *
 * Both requests use the WebView session cookie (`credentials: "include"`).
 * The server is not changed by the mobile repo.
 */
(function () {
  "use strict";

  // The local setup page is served by Capacitor, not by an FSM installation.
  // It must never ask for notification permission or call FSM APIs.
  if (window.__FSM_SHELL__) return;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

  var TOKENS_PATH = "/api/mobile/push-tokens";
  var SESSION_PATH = "/api/auth/session";
  var STATE_KEY = "fsm:push:v1";
  var DEVICE_KEY = "fsm:push:device-id";
  var CHANNEL_ID = "fsm_default";

  if (window.__FSM_PUSH__) {
    // The page was reloaded or the SPA re-executed the script. Reuse the
    // existing instance and ask it to sync again instead of adding duplicate
    // listeners.
    try {
      window.__FSM_PUSH__.sync();
    } catch (error) {
      /* ignore */
    }
    return;
  }

  var state = readState();
  var busy = false;
  var lastSyncAt = 0;
  var lastOpenPath = "";
  var lastOpenAt = 0;
  var permissionDeniedLogged = false;
  var endpointMissingLogged = false;

  function readState() {
    var empty = { origin: "", token: "", registered: false, permissionAsked: false };
    try {
      var raw = window.localStorage.getItem(STATE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return empty;
      return {
        origin: typeof parsed.origin === "string" ? parsed.origin : "",
        token: typeof parsed.token === "string" ? parsed.token : "",
        registered: parsed.registered === true,
        permissionAsked: parsed.permissionAsked === true
      };
    } catch (error) {
      return empty;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) {
      /* private mode / quota */
    }
  }

  function cap() {
    return window.Capacitor || {};
  }

  function getPlugin(name) {
    var plugins = cap().Plugins;
    return plugins && plugins[name] ? plugins[name] : null;
  }

  function pushPlugin() {
    return getPlugin("PushNotifications");
  }

  function nativePlugin() {
    return getPlugin("FsmPush");
  }

  function appPlugin() {
    return getPlugin("App");
  }

  function platformName() {
    try {
      if (cap().getPlatform) {
        var value = cap().getPlatform();
        if (value === "android" || value === "ios") return value;
      }
    } catch (error) {
      /* fall through */
    }
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios" : "android";
  }

  function endpoint(path) {
    return new URL(path, window.location.origin).toString();
  }

  function deviceId() {
    try {
      var existing = window.localStorage.getItem(DEVICE_KEY);
      if (existing) return existing;
      var generated =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(DEVICE_KEY, generated);
      return generated;
    } catch (error) {
      return "";
    }
  }

  function getAppVersion() {
    var fsmpush = nativePlugin();
    if (fsmpush && fsmpush.getInfo) {
      return Promise.resolve()
        .then(function () {
          return fsmpush.getInfo();
        })
        .then(function (info) {
          return info && info.version ? String(info.version) : "";
        })
        .catch(function () {
          return "";
        });
    }
    var app = appPlugin();
    if (app && app.getInfo) {
      return Promise.resolve()
        .then(function () {
          return app.getInfo();
        })
        .then(function (info) {
          return info && info.version ? String(info.version) : "";
        })
        .catch(function () {
          return "";
        });
    }
    return Promise.resolve("");
  }

  /**
   * Android builds without google-services.json have no Firebase
   * configuration. Do not call register() in that case: FirebaseMessaging
   * throws before JavaScript can handle a rejection.
   */
  function isPushAvailable() {
    var fsmpush = nativePlugin();
    if (!fsmpush || !fsmpush.getInfo) return Promise.resolve(true);
    return Promise.resolve()
      .then(function () {
        return fsmpush.getInfo();
      })
      .then(function (info) {
        return !info || info.pushAvailable !== false;
      })
      .catch(function () {
        return true;
      });
  }

  /**
   * NextAuth returns `{}` for anonymous users and an object with `user` or
   * `expires` for signed-in users. A few installations replace the auth layer,
   * so we also treat any non-empty session object as signed in and fall back to
   * looking for a session-looking cookie when the endpoint is missing.
   */
  function checkAuthenticated() {
    return fetch(endpoint(SESSION_PATH), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (response.status === 404 || response.status === 405) {
          return hasSessionCookie();
        }
        if (!response.ok) return false;
        return response.text().then(function (text) {
          if (!text) return false;
          var data;
          try {
            data = JSON.parse(text);
          } catch (error) {
            return false;
          }
          if (!data || typeof data !== "object") return false;
          if (data.user || data.session || data.expires || data.authenticated === true) return true;
          return hasSessionCookie();
        });
      })
      .catch(function () {
        return false;
      });
  }

  function hasSessionCookie() {
    try {
      return /(?:^|;\s*)(?:__Secure-)?(?:next-auth\.session-token|authjs\.session-token|session)=/i.test(
        document.cookie
      );
    } catch (error) {
      return false;
    }
  }

  function postToken(token, appVersion) {
    return fetch(endpoint(TOKENS_PATH), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        token: token,
        platform: platformName(),
        appVersion: appVersion || undefined,
        deviceId: deviceId() || undefined
      })
    });
  }

  function deleteToken(token) {
    return fetch(endpoint(TOKENS_PATH), {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ token: token })
    });
  }

  function rememberNativeRegistration(token) {
    var fsmpush = nativePlugin();
    if (!fsmpush || !fsmpush.saveRegistration) return;
    try {
      var result = fsmpush.saveRegistration({ token: token, origin: window.location.origin });
      if (result && result.catch) result.catch(function () {});
    } catch (error) {
      /* older shell without the method */
    }
  }

  function forgetNativeRegistration() {
    var fsmpush = nativePlugin();
    if (!fsmpush || !fsmpush.clearRegistration) return;
    try {
      var result = fsmpush.clearRegistration();
      if (result && result.catch) result.catch(function () {});
    } catch (error) {
      /* older shell without the method */
    }
  }

  function registerToken(token) {
    if (!token) return;
    state.token = token;
    state.origin = window.location.origin;
    saveState();
    rememberNativeRegistration(token);

    getAppVersion()
      .then(function (appVersion) {
        return postToken(token, appVersion);
      })
      .then(function (response) {
        if (response.ok) {
          state.registered = true;
          saveState();
          return;
        }
        if (response.status === 401 || response.status === 403) {
          // Not signed in yet (or the session expired). Keep the token and try
          // again on the next page load / resume.
          state.registered = false;
          saveState();
          return;
        }
        if (response.status === 404 && !endpointMissingLogged) {
          endpointMissingLogged = true;
          console.warn("[fsm-push] Server has no /api/mobile/push-tokens endpoint yet");
        }
        state.registered = false;
        saveState();
      })
      .catch(function () {
        // Offline: the token is persisted in localStorage and retried later.
        state.registered = false;
        saveState();
      });
  }

  function unregisterRemote() {
    var token = state.token;
    if (!token) {
      forgetNativeRegistration();
      return Promise.resolve();
    }
    return deleteToken(token)
      .then(function () {
        state.token = "";
        state.registered = false;
        saveState();
        forgetNativeRegistration();
      })
      .catch(function () {
        // Keep the token for a later retry; the server may already have
        // invalidated the session on logout.
      });
  }

  function requestPermissionAndRegister(push) {
    return push
      .checkPermissions()
      .then(function (permission) {
        if (permission && permission.receive === "granted") return permission;
        if (permission && permission.receive === "denied") {
          if (!permissionDeniedLogged) {
            permissionDeniedLogged = true;
            console.info("[fsm-push] Notification permission is denied");
          }
          return permission;
        }
        if (state.permissionAsked) return permission;
        state.permissionAsked = true;
        saveState();
        return push.requestPermissions();
      })
      .then(function (permission) {
        if (!permission || permission.receive !== "granted") return;
        return push.register();
      });
  }

  function sync() {
    if (busy) return Promise.resolve();
    var push = pushPlugin();
    if (!push) return Promise.resolve();
    busy = true;
    lastSyncAt = Date.now();
    var guard = window.setTimeout(function () {
      // Never leave the bootstrap permanently busy if a fetch hangs on a
      // captive portal or a frozen WebView.
      busy = false;
    }, 20000);

    return isPushAvailable()
      .then(function (available) {
        if (!available) {
          console.info("[fsm-push] Push is not configured in this build (missing google-services.json)");
          return;
        }
        return checkAuthenticated().then(function (authenticated) {
          if (!authenticated) {
            // Logout or expired session: remove this device's token from the
            // server so the previous user does not keep receiving notifications.
            return unregisterRemote();
          }
          return requestPermissionAndRegister(push);
        });
      })
      .catch(function () {
        /* Offline or plugin unavailable; retry on the next resume. */
      })
      .then(function () {
        window.clearTimeout(guard);
        busy = false;
      });
  }

  function openPath(raw) {
    if (!raw) return;
    var path = String(raw).trim();
    if (!path) return;
    // A bare `oppdrag/123` must resolve from the site root, not from the
    // current route.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(path) && path.charAt(0) !== "/") {
      path = "/" + path;
    }
    try {
      var url = new URL(path, window.location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        if (url.origin !== window.location.origin) return;
        path = url.pathname + url.search + url.hash;
      } else {
        // no.fsm.felt://oppdrag/123 -> /oppdrag/123
        path = "/" + (url.host || "") + url.pathname + url.search + url.hash;
        path = path.replace(/\/{2,}/g, "/");
      }
    } catch (error) {
      path = path.charAt(0) === "/" ? path : "/" + path;
    }
    if (!path || path === "/") path = "/";
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (path === current) return;
    var now = Date.now();
    if (lastOpenPath === path && now - lastOpenAt < 3000) return;
    lastOpenPath = path;
    lastOpenAt = now;
    window.location.assign(path);
  }

  function openNotificationData(data) {
    if (!data) return;
    var candidate =
      data.url ||
      data.link ||
      data.path ||
      data.deeplink ||
      data.deepLink ||
      data.deep_link ||
      data.route ||
      data.target;
    if (!candidate && data.data && typeof data.data === "object") {
      candidate =
        data.data.url ||
        data.data.link ||
        data.data.path ||
        data.data.deeplink ||
        data.data.deepLink ||
        data.data.route;
    }
    if (candidate) openPath(candidate);
  }

  function openPendingNative() {
    var fsmpush = nativePlugin();
    if (!fsmpush || !fsmpush.consumePendingDeepLink) return Promise.resolve();
    return Promise.resolve()
      .then(function () {
        return fsmpush.consumePendingDeepLink();
      })
      .then(function (result) {
        if (result && result.path) openPath(result.path);
      })
      .catch(function () {});
  }

  function createChannel(push) {
    if (platformName() !== "android" || !push.createChannel) return;
    try {
      var result = push.createChannel({
        id: CHANNEL_ID,
        name: "FSM-varsler",
        description: "Oppdrag, meldinger og påminnelser fra FSM",
        importance: 4,
        visibility: 1,
        vibration: true
      });
      if (result && result.catch) result.catch(function () {});
    } catch (error) {
      /* channel already exists or older plugin */
    }
  }

  function attachListeners() {
    var push = pushPlugin();
    if (!push) return false;

    if (push.addListener) {
      push.addListener("registration", function (event) {
        if (event && event.value) registerToken(event.value);
      });
      push.addListener("registrationError", function (event) {
        console.warn("[fsm-push] Registration failed", event && event.error);
      });
      push.addListener("pushNotificationReceived", function (event) {
        // Foreground notifications are displayed by the native plugin.
        // Nothing else to do here.
        void event;
      });
      push.addListener("pushNotificationActionPerformed", function (event) {
        if (!event || !event.notification) return;
        openNotificationData(event.notification.data);
      });
      createChannel(push);
    }

    var app = appPlugin();
    if (app && app.addListener) {
      app.addListener("appUrlOpen", function (event) {
        if (event && event.url) openPath(event.url);
      });
      app.addListener("appStateChange", function (event) {
        if (event && event.isActive) {
          openPendingNative();
          sync();
        }
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        openPendingNative();
        if (Date.now() - lastSyncAt > 5000) sync();
      }
    });
    window.addEventListener("pageshow", function () {
      openPendingNative();
      sync();
    });
    window.addEventListener("focus", function () {
      if (Date.now() - lastSyncAt > 15000) sync();
    });

    return true;
  }

  function boot() {
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (pushPlugin()) {
        window.clearInterval(timer);
        attachListeners();
        openPendingNative();
        sync();
      } else if (attempts >= 100) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  window.__FSM_PUSH__ = {
    sync: sync,
    unregister: unregisterRemote,
    open: openPath,
    openPending: openPendingNative
  };
  window.__FSM_PUSH_OPEN__ = openPath;
  window.__FSM_PUSH_OPEN_PENDING__ = openPendingNative;
  window.__FSM_PUSH_UNREGISTER__ = unregisterRemote;

  boot();
})();
