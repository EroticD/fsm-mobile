package no.fsm.felt;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Leser, lagrer og fjerner FSM-serveradressen.
 *
 * Første oppstart viser den lokale oppsettsiden. Når brukeren lagrer en
 * adresse, lastes FSM-plattformen i samme WebView. Ved neste oppstart bruker
 * MainActivity den lagrede adressen som `server.url`, slik at adressen aldri
 * er hardkodet i appen.
 */
@CapacitorPlugin(name = "ServerConfig")
public class ServerConfigPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("url", ServerConfigStore.get(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String raw = call.getString("url");
        String normalized = normalize(raw);
        if (normalized == null) {
            call.reject("invalid_url", "invalid_url");
            return;
        }

        ServerConfigStore.set(getContext(), normalized);
        ServerConfigStore.setSetupMode(getContext(), false);
        JSObject result = new JSObject();
        result.put("url", normalized);
        call.resolve(result);

        // Bygg activityen på nytt slik at Capacitor lager en ny WebView med
        // serveradressen satt i konfigurasjonen. Da injiseres den native broen
        // i FSM-appen, og «Bytt server» virker også etter første tilkobling.
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        ServerConfigStore.setSetupMode(getContext(), false);
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void clear(PluginCall call) {
        ServerConfigStore.clear(getContext());
        ServerConfigStore.setSetupMode(getContext(), true);
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    /**
     * Godtar bare absolutte http(s)-adresser. HTTP tillates fordi lokale
     * testservere (emulator/LAN) ofte kjører uten TLS; produksjon skal bruke
     * HTTPS. Adressen normaliseres uten fragment og uten avsluttende skråstrek.
     */
    private String normalize(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        if (!value.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*$")) {
            value = "https://" + value;
        }
        Uri uri;
        try {
            uri = Uri.parse(value);
        } catch (Exception error) {
            return null;
        }
        String scheme = uri.getScheme();
        if (scheme == null) return null;
        scheme = scheme.toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        if (uri.getUserInfo() != null) return null;

        Uri.Builder builder = uri.buildUpon().fragment(null);
        String path = uri.getPath();
        if (path != null) {
            while (path.endsWith("/") && path.length() > 1) {
                path = path.substring(0, path.length() - 1);
            }
            builder.path(path.isEmpty() ? "/" : path);
        }
        return builder.build().toString();
    }
}
