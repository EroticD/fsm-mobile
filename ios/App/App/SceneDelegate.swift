import UIKit
import WebKit
import Capacitor

/**
 * Lagrer FSM-serveradressen i UserDefaults.
 *
 * Adressen er ikke bygget inn i appen. Den skrives av oppsettsiden eller av
 * «Bytt server» i FSM-appen, og leses av FSMBridgeViewController ved oppstart.
 */
enum ServerConfigStore {
    private static let key = "fsm.native.serverUrl"
    private static let setupKey = "fsm.native.setupMode"

    static var setupMode: Bool {
        get { UserDefaults.standard.bool(forKey: setupKey) }
        set { UserDefaults.standard.set(newValue, forKey: setupKey) }
    }

    static var url: URL? {
        get {
            guard let raw = UserDefaults.standard.string(forKey: key) else { return nil }
            return normalize(raw)
        }
        set {
            if let value = newValue {
                UserDefaults.standard.set(value.absoluteString, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
    }

    /**
     * Godtar absolutte http(s)-adresser. HTTP tillates for lokal testing
     * (simulator/LAN); produksjon skal bruke HTTPS. Fragment og avsluttende
     * skråstrek fjernes, mens en eventuell understi beholdes.
     */
    static func normalize(_ raw: String) -> URL? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        if value.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) == nil {
            value = "https://" + value
        }
        guard var components = URLComponents(string: value) else { return nil }
        guard let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host,
              !host.isEmpty,
              components.user == nil,
              components.password == nil else {
            return nil
        }
        components.scheme = scheme
        components.fragment = nil
        var path = components.path
        while path.count > 1 && path.hasSuffix("/") {
            path.removeLast()
        }
        components.path = path.isEmpty ? "/" : path
        return components.url
    }
}

/**
 * Bygger Capacitor-konfigurasjonen med serveradressen fra native lagring.
 * Uten lagret adresse lastes den lokale oppsettsiden (`index.html`).
 */
class FSMBridgeViewController: CAPBridgeViewController {
    private static let serverButtonJS = #"""
    (function(){
      if(window.__FSM_SHELL__)return;
      if(document.getElementById('fsm-mobile-server'))return;
      var b=document.createElement('button');
      b.id='fsm-mobile-server';b.type='button';b.textContent='\u2699';
      b.setAttribute('aria-label','Serverinnstillinger');
      b.style.cssText='position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 5.2rem);z-index:2147483647;width:42px;height:42px;border-radius:999px;border:1px solid #101310;background:#101310;color:#d8ff3e;font-size:20px;line-height:1;box-shadow:0 2px 10px rgba(0,0,0,.35);padding:0;cursor:pointer;';
      b.onclick=function(){
        if(window.FsmMobile&&window.FsmMobile.openSetup){window.FsmMobile.openSetup();return;}
        if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.fsmMobile){window.webkit.messageHandlers.fsmMobile.postMessage('openSetup');}
      };
      document.body.appendChild(b);
    })();
    """#

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.allowedNavigationHostnames = ["*"]
        if !ServerConfigStore.setupMode, let serverURL = ServerConfigStore.url {
            descriptor.serverURL = serverURL.absoluteString
        }
        return descriptor
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.add(self, name: "fsmMobile")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.serverButtonJS,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        return configuration
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ServerConfigPlugin())
    }
}

extension FSMBridgeViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "fsmMobile" else { return }
        ServerConfigStore.setupMode = true
        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            bridge.webView?.load(URLRequest(url: bridge.config.localURL))
        }
    }
}

/**
 * Native bro for oppsettsiden og «Bytt server» i FSM-appen.
 */
@objc(ServerConfigPlugin)
public class ServerConfigPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerConfigPlugin"
    public let jsName = "ServerConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func get(_ call: CAPPluginCall) {
        let value: Any = ServerConfigStore.url?.absoluteString ?? NSNull()
        call.resolve(["url": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = ServerConfigStore.normalize(raw) else {
            call.reject("invalid_url", "invalid_url")
            return
        }

        ServerConfigStore.url = url
        ServerConfigStore.setupMode = false
        call.resolve(["url": url.absoluteString])

        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.load(URLRequest(url: url))
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        ServerConfigStore.setupMode = false
        call.resolve()

        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            let target = ServerConfigStore.url ?? bridge.config.localURL
            bridge.webView?.load(URLRequest(url: target))
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        ServerConfigStore.url = nil
        ServerConfigStore.setupMode = true
        call.resolve()

        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            bridge.webView?.load(URLRequest(url: bridge.config.localURL))
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = FSMBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
