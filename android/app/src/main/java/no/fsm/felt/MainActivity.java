package no.fsm.felt;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "FsmPush";
    private static final String PUSH_CHANNEL_ID = "fsm_default";
    private static final String PUSH_BOOTSTRAP_ASSET = "public/fsm-push.js";
    private static final String[] DEEP_LINK_KEYS = {
        "url",
        "link",
        "path",
        "deeplink",
        "deepLink",
        "deep_link",
        "route",
        "target"
    };

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
        // The launch intent is the only reliable source for a notification tap
        // that cold-starts the app. Read it before the WebView is created so the
        // bootstrap can consume it as soon as the page has loaded. On
        // configuration changes/recreates the old intent must not re-open the
        // previous notification.
        if (savedInstanceState == null) {
            PushStateStore.setPendingDeepLink(this, extractDeepLink(getIntent()));
        }
        ensureNotificationChannel();

        registerPlugin(ServerConfigPlugin.class);
        registerPlugin(FsmPushPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new FsmMobileBridge(), "FsmMobile");
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    if (ServerConfigStore.get(MainActivity.this) != null &&
                        !ServerConfigStore.isSetupMode(MainActivity.this)) {
                        webView.evaluateJavascript(SERVER_BUTTON_JS, null);
                        injectPushBootstrap(webView);
                    }
                }
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String deepLink = extractDeepLink(intent);
        if (deepLink == null) return;
        PushStateStore.setPendingDeepLink(this, deepLink);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "window.__FSM_PUSH_OPEN_PENDING__ && window.__FSM_PUSH_OPEN_PENDING__();",
                null
            );
        }
    }

    private void injectPushBootstrap(WebView webView) {
        String script = readAsset(PUSH_BOOTSTRAP_ASSET);
        if (script == null || script.isEmpty()) {
            Log.w(TAG, "Push bootstrap asset is missing: " + PUSH_BOOTSTRAP_ASSET);
            return;
        }
        webView.evaluateJavascript(script, null);
        webView.evaluateJavascript(
            "window.__FSM_PUSH_OPEN_PENDING__ && window.__FSM_PUSH_OPEN_PENDING__();",
            null
        );
    }

    private String readAsset(String path) {
        try (InputStream stream = getAssets().open(path)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            Log.w(TAG, "Could not read " + path, error);
            return null;
        }
    }

    /**
     * Extracts a path or URL from an FCM notification tap.
     *
     * FCM puts custom data keys directly into the launch intent extras. Some
     * senders wrap them in a `data` JSON object instead, so both forms are
     * supported. A custom URL scheme (`no.fsm.felt://...`) is also accepted.
     */
    private String extractDeepLink(Intent intent) {
        if (intent == null) return null;

        Uri data = intent.getData();
        if (data != null && data.toString().trim().length() > 0) {
            return data.toString().trim();
        }

        Bundle extras = intent.getExtras();
        if (extras == null) return null;

        for (String key : DEEP_LINK_KEYS) {
            String value = extras.getString(key);
            if (value != null && value.trim().length() > 0) {
                return value.trim();
            }
        }

        String nested = extras.getString("data");
        if (nested != null && nested.trim().length() > 0) {
            try {
                JSONObject json = new JSONObject(nested);
                for (String key : DEEP_LINK_KEYS) {
                    if (!json.has(key)) continue;
                    String value = json.optString(key, null);
                    if (value != null && value.trim().length() > 0) {
                        return value.trim();
                    }
                }
            } catch (Exception error) {
                Log.d(TAG, "Notification data was not JSON");
            }
        }

        return null;
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            PUSH_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(getString(R.string.notification_channel_description));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
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
