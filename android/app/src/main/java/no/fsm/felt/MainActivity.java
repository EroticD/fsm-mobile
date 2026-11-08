package no.fsm.felt;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String SERVER_BUTTON_JS =
        "(function(){" +
        "if(window.__FSM_SHELL__)return;" +
        "if(document.getElementById('fsm-mobile-server'))return;" +
        "var b=document.createElement('button');" +
        "b.id='fsm-mobile-server';b.type='button';b.textContent='\\u2699';" +
        "b.setAttribute('aria-label','Serverinnstillinger');" +
        "b.style.cssText='position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 5.2rem);z-index:2147483647;width:42px;height:42px;border-radius:999px;border:1px solid #101310;background:#101310;color:#d8ff3e;font-size:20px;line-height:1;box-shadow:0 2px 10px rgba(0,0,0,.35);padding:0;cursor:pointer;'" +
        "b.onclick=function(){" +
        "if(window.FsmMobile&&window.FsmMobile.openSetup){window.FsmMobile.openSetup();return;}" +
        "if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.fsmMobile){window.webkit.messageHandlers.fsmMobile.postMessage('openSetup');}" +
        "};" +
        "document.body.appendChild(b);" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerConfigPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new FsmMobileBridge(), "FsmMobile");
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    if (ServerConfigStore.get(MainActivity.this) != null &&
                        !ServerConfigStore.isSetupMode(MainActivity.this)) {
                        webView.evaluateJavascript(SERVER_BUTTON_JS, null);
                    }
                }
            });
        }
    }

    private class FsmMobileBridge {
        @JavascriptInterface
        public void openSetup() {
            runOnUiThread(() -> {
                ServerConfigStore.setSetupMode(MainActivity.this, true);
                recreate();
            });
        }
    }

    /**
     * Bygger Capacitor-konfigurasjonen på nytt hver gang appen starter.
     *
     * Uten en lagret serveradresse lastes den lokale oppsettsiden. Når brukeren
     * har lagret en adresse, brukes den som `server.url`, slik at FSM-appen
     * lastes direkte fra riktig installasjon. Adressen er aldri kompilert inn.
     */
    @Override
    protected void load() {
        boolean setupMode = ServerConfigStore.isSetupMode(this);
        String serverUrl = setupMode ? null : ServerConfigStore.get(this);
        CapConfig.Builder builder = new CapConfig.Builder(this)
            .setAllowNavigation(new String[] { "*" })
            .setBackgroundColor("#101310")
            .setErrorPath("index.html")
            .setLoggingEnabled(true);

        if (serverUrl != null) {
            builder.setServerUrl(serverUrl);
        }

        this.config = builder.create();
        super.load();
    }
}
