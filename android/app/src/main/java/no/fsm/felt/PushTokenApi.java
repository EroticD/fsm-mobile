package no.fsm.felt;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Best-effort token removal from the old server when the user changes server.
 *
 * The WebView session cookie is read from CookieManager, so this uses the same
 * authenticated session as the page. Failures are intentionally silent: the
 * local token is cleared regardless, and the server must reject tokens that no
 * longer belong to a valid session.
 */
final class PushTokenApi {

    private static final String TAG = "FsmPush";
    private static final String TOKENS_PATH = "/api/mobile/push-tokens";

    private PushTokenApi() {}

    static void unregister(Context context, String origin, String token) {
        if (context == null || origin == null || token == null) return;
        final String targetOrigin = trimTrailingSlash(origin);
        final String targetToken = token;
        if (targetOrigin.isEmpty() || targetToken.isEmpty()) return;

        // CookieManager must be read on the thread that owns the WebView.
        final String cookie = CookieManager.getInstance().getCookie(targetOrigin);

        new Thread(
            () -> {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL(targetOrigin + TOKENS_PATH);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestMethod("DELETE");
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.setRequestProperty("Accept", "application/json");
                    if (cookie != null && !cookie.isEmpty()) {
                        connection.setRequestProperty("Cookie", cookie);
                    }

                    JSONObject body = new JSONObject();
                    body.put("token", targetToken);
                    byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream stream = connection.getOutputStream()) {
                        stream.write(payload);
                    }

                    int code = connection.getResponseCode();
                    if (code >= 200 && code < 300) {
                        Log.d(TAG, "Removed push token from " + targetOrigin);
                    } else {
                        Log.d(TAG, "Push token removal returned HTTP " + code);
                    }
                } catch (Exception error) {
                    Log.d(TAG, "Could not remove push token from old server", error);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            },
            "fsm-push-unregister"
        ).start();
    }

    private static String trimTrailingSlash(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/") && result.length() > 1) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }
}
