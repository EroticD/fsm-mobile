package no.fsm.felt;

import android.content.Context;
import android.content.pm.PackageInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small native bridge used by the injected push bootstrap.
 *
 * It exposes the app version, a cold-start deep link captured from the launch
 * intent, and the token/origin pair used to clean up the old server when the
 * user changes server.
 */
@CapacitorPlugin(name = "FsmPush")
public class FsmPushPlugin extends Plugin {

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("version", versionName());
        result.put("pushAvailable", isFirebaseConfigured());
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingDeepLink(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", PushStateStore.getPendingDeepLink(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void consumePendingDeepLink(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", PushStateStore.consumePendingDeepLink(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void saveRegistration(PluginCall call) {
        String token = call.getString("token");
        String origin = call.getString("origin");
        if (token == null || token.trim().isEmpty()) {
            call.reject("missing_token", "missing_token");
            return;
        }
        PushStateStore.setRegistration(getContext(), token, origin);
        call.resolve();
    }

    @PluginMethod
    public void clearRegistration(PluginCall call) {
        PushStateStore.clearRegistration(getContext());
        call.resolve();
    }

    private String versionName() {
        try {
            Context context = getContext();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception error) {
            return "";
        }
    }

    /**
     * Firebase generates the `google_app_id` string resource from
     * google-services.json. Without it, calling FirebaseMessaging would throw
     * before the JavaScript can show a useful error, so debug builds without
     * Firebase skip push entirely.
     */
    private boolean isFirebaseConfigured() {
        try {
            Context context = getContext();
            int id = context.getResources().getIdentifier("google_app_id", "string", context.getPackageName());
            return id != 0;
        } catch (Exception error) {
            return false;
        }
    }
}
