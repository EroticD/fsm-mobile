#!/usr/bin/env node
/**
 * Push/release configuration check.
 *
 * Debug mode verifies that the committed native wiring is present. Release mode
 * additionally requires the files that must never be committed (Firebase
 * google-services.json and Android signing credentials) to be materialised by
 * the release workflow. Debug builds intentionally do not need them.
 *
 * Usage:
 *   node scripts/check-push-config.mjs
 *   node scripts/check-push-config.mjs --mode release --platform android
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const root = process.cwd();
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const mode = argValue("--mode", "debug");
const platform = argValue("--platform", "all");

if (!["debug", "release"].includes(mode)) {
  console.error(`Unknown --mode "${mode}". Use debug or release.`);
  process.exit(2);
}
if (!["android", "ios", "all"].includes(platform)) {
  console.error(`Unknown --platform "${platform}". Use android, ios or all.`);
  process.exit(2);
}

const failures = [];
const warnings = [];
const checks = [];

function file(relative) {
  return path.join(root, relative);
}

function exists(relative) {
  return fs.existsSync(file(relative));
}

function read(relative) {
  return fs.readFileSync(file(relative), "utf8");
}

function check(name, condition, message) {
  if (condition) {
    checks.push(name);
  } else {
    failures.push(`${name}: ${message}`);
  }
}

function contains(relative, needle) {
  return exists(relative) && read(relative).includes(needle);
}

function checkCommon() {
  const packageJson = JSON.parse(read("package.json"));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  check(
    "package.json push dependency",
    Boolean(dependencies["@capacitor/push-notifications"]),
    "add @capacitor/push-notifications and run npm install"
  );
  check(
    "package.json app dependency",
    Boolean(dependencies["@capacitor/app"]),
    "add @capacitor/app (used for resume and appUrlOpen deep links)"
  );
  check(
    "push bootstrap",
    exists("capacitor-shell/fsm-push.js"),
    "capacitor-shell/fsm-push.js is missing"
  );
  if (exists("capacitor-shell/fsm-push.js")) {
    try {
      new vm.Script(read("capacitor-shell/fsm-push.js"), { filename: "capacitor-shell/fsm-push.js" });
      checks.push("push bootstrap syntax");
    } catch (error) {
      failures.push(`push bootstrap syntax: ${error.message}`);
    }
  }
  let config = null;
  try {
    config = JSON.parse(read("capacitor.config.json"));
  } catch {
    failures.push("capacitor.config.json: not valid JSON");
  }
  check(
    "capacitor config push presentation",
    Boolean(config?.plugins?.PushNotifications?.presentationOptions?.length),
    "plugins.PushNotifications.presentationOptions is not configured"
  );
}

function checkAndroid() {
  const manifest = "android/app/src/main/AndroidManifest.xml";
  check(
    "Android notification permission",
    contains(manifest, "android.permission.POST_NOTIFICATIONS"),
    "AndroidManifest.xml must declare POST_NOTIFICATIONS"
  );
  check(
    "Android notification channel metadata",
    contains(manifest, "default_notification_channel_id"),
    "AndroidManifest.xml must set the default FCM notification channel"
  );
  check(
    "Android notification icon metadata",
    contains(manifest, "default_notification_icon"),
    "AndroidManifest.xml must set a white status-bar notification icon"
  );
  check(
    "Android push plugin registration",
    contains("android/app/src/main/java/no/fsm/felt/MainActivity.java", "FsmPushPlugin.class"),
    "MainActivity must register FsmPushPlugin"
  );
  check(
    "Android push bootstrap injection",
    contains("android/app/src/main/java/no/fsm/felt/MainActivity.java", "PUSH_BOOTSTRAP_ASSET"),
    "MainActivity must inject capacitor-shell/fsm-push.js after page load"
  );
  check(
    "Android release signing wiring",
    contains("android/app/build.gradle", "signingConfigs"),
    "android/app/build.gradle must define signingConfigs"
  );
  check(
    "Android keystore wiring",
    contains("android/app/build.gradle", "keystore.properties"),
    "android/app/build.gradle must read keystore.properties or ANDROID_KEYSTORE_* env"
  );
  check(
    "Android google-services hook",
    contains("android/app/build.gradle", "com.google.gms.google-services"),
    "android/app/build.gradle must apply the google-services plugin when google-services.json exists"
  );

  if (mode === "release") {
    const googleServices = "android/app/google-services.json";
    if (!exists(googleServices)) {
      failures.push(
        `Android release push config: ${googleServices} is missing. ` +
          "Decode GOOGLE_SERVICES_JSON_BASE64 in CI or download it from the Firebase console."
      );
    }
    const keystoreProperties = exists("android/keystore.properties");
    const envSigning = [
      "ANDROID_KEYSTORE_PATH",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEY_PASSWORD"
    ].every((name) => process.env[name]);
    if (!keystoreProperties && !envSigning) {
      failures.push(
        "Android release signing: create android/keystore.properties or set " +
          "ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and " +
          "ANDROID_KEY_PASSWORD."
      );
    }
  } else {
    if (!exists("android/app/google-services.json")) {
      warnings.push(
        "google-services.json is not present; debug builds still compile, but push registration will not work."
      );
    }
  }
}

function checkIos() {
  check(
    "iOS APNs AppDelegate",
    contains("ios/App/App/AppDelegate.swift", "capacitorDidRegisterForRemoteNotifications"),
    "AppDelegate.swift must forward didRegisterForRemoteNotificationsWithDeviceToken"
  );
  check(
    "iOS APNs error AppDelegate",
    contains("ios/App/App/AppDelegate.swift", "capacitorDidFailToRegisterForRemoteNotifications"),
    "AppDelegate.swift must forward didFailToRegisterForRemoteNotificationsWithError"
  );
  check(
    "iOS entitlements file",
    exists("ios/App/App/App.entitlements") && contains("ios/App/App/App.entitlements", "aps-environment"),
    "ios/App/App/App.entitlements must contain aps-environment"
  );
  check(
    "iOS entitlements build setting",
    contains("ios/App/App.xcodeproj/project.pbxproj", "CODE_SIGN_ENTITLEMENTS"),
    "the Xcode target must use CODE_SIGN_ENTITLEMENTS = App/App.entitlements"
  );
  check(
    "iOS APNs environment build setting",
    contains("ios/App/App.xcodeproj/project.pbxproj", "APS_ENVIRONMENT"),
    "Debug/Release must set APS_ENVIRONMENT (development/production)"
  );
  check(
    "iOS background mode",
    exists("ios/App/App/Info.plist") && contains("ios/App/App/Info.plist", "remote-notification"),
    "Info.plist must declare UIBackgroundModes remote-notification"
  );
  check(
    "iOS push native bridge",
    exists("ios/App/App/PushSupport.swift"),
    "ios/App/App/PushSupport.swift is missing"
  );
  check(
    "iOS push bootstrap injection",
    contains("ios/App/App/SceneDelegate.swift", "fsm-push"),
    "SceneDelegate must inject capacitor-shell/fsm-push.js after page load"
  );
  check(
    "iOS export options template",
    exists("ios/ExportOptions.plist.template"),
    "ios/ExportOptions.plist.template is missing"
  );

  if (mode === "release") {
    if (!exists("ios/App/App/App.entitlements")) {
      failures.push("iOS release push config: the Push Notifications entitlement is missing.");
    }
    if (exists("ios/App/App/GoogleService-Info.plist")) {
      warnings.push(
        "GoogleService-Info.plist exists locally (ignored by git). It is only needed if the server sends FCM to iOS."
      );
    }
  }
}

checkCommon();
if (platform === "android" || platform === "all") checkAndroid();
if (platform === "ios" || platform === "all") checkIos();

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  console.error(`\nPush/release configuration check failed (${mode}, ${platform}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`Push/release configuration OK (${mode}, ${platform}, ${checks.length} checks).`);
