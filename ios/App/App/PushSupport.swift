import Capacitor
import Foundation
import WebKit

/**
 * Native push state shared by the AppDelegate, the server switching plugin and
 * the injected push bootstrap.
 *
 * The token and the origin it belongs to are stored natively so the shell can
 * remove the token from the old server when the user changes server, even if
 * the WebView has already navigated away from that server.
 */
enum PushStateStore {
    private static let tokenKey = "fsm.native.pushToken"
    private static let originKey = "fsm.native.pushOrigin"
    private static let pendingPathKey = "fsm.native.pushPendingPath"

    static var token: String? {
        let value = UserDefaults.standard.string(forKey: tokenKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    static var origin: String? {
        let value = UserDefaults.standard.string(forKey: originKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    static func save(token: String, origin: String) {
        UserDefaults.standard.set(token, forKey: tokenKey)
        UserDefaults.standard.set(normalizedOrigin(origin), forKey: originKey)
    }

    static func clearRegistration() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: originKey)
    }

    static var pendingDeepLink: String? {
        get {
            let value = UserDefaults.standard.string(forKey: pendingPathKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return value?.isEmpty == false ? value : nil
        }
        set {
            if let value = newValue, !value.isEmpty {
                UserDefaults.standard.set(value, forKey: pendingPathKey)
            } else {
                UserDefaults.standard.removeObject(forKey: pendingPathKey)
            }
        }
    }

    static func consumePendingDeepLink() -> String? {
        let value = pendingDeepLink
        if value != nil {
            UserDefaults.standard.removeObject(forKey: pendingPathKey)
        }
        return value
    }

    static func normalizedOrigin(_ raw: String) -> String {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") && value.count > 1 {
            value.removeLast()
        }
        return value
    }
}

/**
 * Extracts the in-app path from an APNs/FCM payload.
 *
 * Supported payload keys: url, link, path, deeplink, deepLink, deep_link,
 * route and target. A nested `data` object is also supported.
 */
enum PushDeepLink {
    private static let keys = ["url", "link", "path", "deeplink", "deepLink", "deep_link", "route", "target"]

    static func extract(from userInfo: [AnyHashable: Any]) -> String? {
        for key in keys {
            if let value = userInfo[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        if let data = userInfo["data"] as? [AnyHashable: Any] {
            return extract(from: data)
        }
        return nil
    }
}

/**
 * Best-effort token removal from the old server when the user changes server.
 *
 * Uses the WebView cookie store so the DELETE runs with the same authenticated
 * session as the page. Failures are silent: the local token is cleared
 * regardless, and the server must reject tokens without a valid session.
 */
enum PushTokenApi {
    static func unregister(origin: String?, token: String?) {
        guard let origin, let token,
              let baseURL = URL(string: PushStateStore.normalizedOrigin(origin)),
              let tokensURL = URL(string: "/api/mobile/push-tokens", relativeTo: baseURL) else {
            return
        }

        let body = try? JSONSerialization.data(withJSONObject: ["token": token])
        let host = baseURL.host ?? ""
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            var request = URLRequest(url: tokensURL)
            request.httpMethod = "DELETE"
            request.timeoutInterval = 5
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = body

            let matching = cookies.filter { cookie in
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return !domain.isEmpty && (host == domain || host.hasSuffix("." + domain))
            }
            if !matching.isEmpty {
                let headers = HTTPCookie.requestHeaderFields(with: matching)
                for (key, value) in headers {
                    request.setValue(value, forHTTPHeaderField: key)
                }
            }
            URLSession.shared.dataTask(with: request).resume()
        }
    }
}

/**
 * Native bridge used by the injected push bootstrap.
 */
@objc(FsmPushPlugin)
public class FsmPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FsmPushPlugin"
    public let jsName = "FsmPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingDeepLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingDeepLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveRegistration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearRegistration", returnType: CAPPluginReturnPromise)
    ]

    @objc func getInfo(_ call: CAPPluginCall) {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        call.resolve([
            "platform": "ios",
            "version": version
        ])
    }

    @objc func getPendingDeepLink(_ call: CAPPluginCall) {
        let path: Any = PushStateStore.pendingDeepLink ?? NSNull()
        call.resolve(["path": path])
    }

    @objc func consumePendingDeepLink(_ call: CAPPluginCall) {
        let path: Any = PushStateStore.consumePendingDeepLink() ?? NSNull()
        call.resolve(["path": path])
    }

    @objc func saveRegistration(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("missing_token", "missing_token")
            return
        }
        PushStateStore.save(token: token, origin: call.getString("origin") ?? "")
        call.resolve()
    }

    @objc func clearRegistration(_ call: CAPPluginCall) {
        PushStateStore.clearRegistration()
        call.resolve()
    }
}
