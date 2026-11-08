package no.fsm.felt;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Native push state.
 *
 * The token and the origin it belongs to are stored natively so the shell can
 * remove the token from the old server when the user changes server, even if
 * the WebView has already navigated away from that server.
 */
final class PushStateStore {

    private static final String PREFS = "fsm_native";
    private static final String KEY_TOKEN = "push_token";
    private static final String KEY_ORIGIN = "push_origin";
    private static final String KEY_PENDING_PATH = "push_pending_path";

    private PushStateStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String getToken(Context context) {
        return emptyToNull(preferences(context).getString(KEY_TOKEN, null));
    }

    static String getOrigin(Context context) {
        return emptyToNull(preferences(context).getString(KEY_ORIGIN, null));
    }

    static void setRegistration(Context context, String token, String origin) {
        preferences(context)
            .edit()
            .putString(KEY_TOKEN, emptyToNull(token))
            .putString(KEY_ORIGIN, emptyToNull(origin))
            .apply();
    }

    static void clearRegistration(Context context) {
        preferences(context).edit().remove(KEY_TOKEN).remove(KEY_ORIGIN).apply();
    }

    static String getPendingDeepLink(Context context) {
        return emptyToNull(preferences(context).getString(KEY_PENDING_PATH, null));
    }

    static void setPendingDeepLink(Context context, String path) {
        preferences(context).edit().putString(KEY_PENDING_PATH, emptyToNull(path)).apply();
    }

    static String consumePendingDeepLink(Context context) {
        String path = getPendingDeepLink(context);
        if (path != null) {
            preferences(context).edit().remove(KEY_PENDING_PATH).apply();
        }
        return path;
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
