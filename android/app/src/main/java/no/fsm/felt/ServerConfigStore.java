package no.fsm.felt;

import android.content.Context;
import android.content.SharedPreferences;

/** Lagrer FSM-serveradressen i native lagring, ikke i webvisningen. */
final class ServerConfigStore {

    private static final String PREFS = "fsm_native";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_SETUP_MODE = "setup_mode";

    private ServerConfigStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String get(Context context) {
        String value = preferences(context).getString(KEY_SERVER_URL, null);
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }

    static void set(Context context, String url) {
        preferences(context).edit().putString(KEY_SERVER_URL, url).apply();
    }

    static void clear(Context context) {
        preferences(context).edit().remove(KEY_SERVER_URL).remove(KEY_SETUP_MODE).apply();
    }

    static boolean isSetupMode(Context context) {
        return preferences(context).getBoolean(KEY_SETUP_MODE, false);
    }

    static void setSetupMode(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(KEY_SETUP_MODE, enabled).apply();
    }
}
