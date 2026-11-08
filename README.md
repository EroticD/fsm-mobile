# fsm-mobile

Native Android- og iOS-skall for FSM-plattformen. Appen er en tynn
Capacitor-WebView som laster en FSM-installasjon som brukeren velger selv.
Serveradressen er **ikke** bygget inn i appen.

## Hva appen gjør

- Første oppstart viser en lokal oppsettside der brukeren skriver inn
  `https://felt.firma.no` (eller tilsvarende).
- Adressen valideres og lagres i native lagring (Android `SharedPreferences`,
  iOS `UserDefaults`).
- Deretter lastes FSM-plattformen i WebView-en med PWA-ens service worker,
  offline-kladder, PIN-lås, kamera, kart og `tel:`/`geo:`-lenker.
- En liten serverknapp nederst i appen åpner oppsettsiden igjen, slik at
  serveren kan byttes uten å avinstallere.
- Pushvarsler via FCM (Android) og APNs (iOS). Appen registrerer enheten etter
  innlogging og lagrer tokenet på den valgte FSM-serveren. Trykk på et varsel
  åpner målsiden i WebView-en, også når appen var lukket.
- Service workeren cacher sider, API-GET og filer under `/uploads/` i
  **7 døgn**, per bruker. Cacheene slettes ved utlogging, utløpt økt og
  «Bytt server».

## Krav

- Node.js 22 eller nyere.
- Android: JDK 21 og Android SDK 36.
- iOS: macOS med Xcode 16 eller nyere. iOS kan ikke bygges på Linux.
- En kjørende FSM-installasjon. HTTPS i produksjon; HTTP er bare for lokal
  testing.
- For push: Firebase-prosjekt med Android-appen `no.fsm.felt`, og en
  Apple-utviklerkonto med Push Notifications for iOS.

## Kom i gang

```bash
npm ci
npm run sync
```

`sync` kopierer `capacitor-shell` inn i Android- og iOS-prosjektene og
oppdaterer native avhengigheter. Kjøres etter endringer i skallet eller
Capacitor-konfigurasjonen.

```bash
npm run check:push   # verifiserer native push-oppsett (debug)
npm run doctor
```

### Android

```bash
npm run build:android
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

eller åpne prosjektet i Android Studio:

```bash
npm run open:android
```

### iOS (macOS)

```bash
npm run sync:ios
npm run open:ios
```

Velg simulator/enhet i Xcode og kjør.

## Lokal testserver

Service workers krever en sikker kontekst. På Android-emulator bruker du
`adb reverse` og `http://localhost:3000`:

```bash
adb reverse tcp:3000 tcp:3000
# i FSM-plattformen:
npm run build && npm run start
```

På iOS-simulator kan du bruke `http://localhost:3000` direkte. Skriv adressen i
oppsettsiden. For test på fysisk telefon kan du bruke maskinens LAN-adresse,
men offline-cachen krever HTTPS eller `localhost`.

## Bytte server

Trykk på tannhjulet nederst i appen. Oppsettsiden åpnes med lagret adresse
forhåndsutfylt. Du kan:

- **Koble til** en ny adresse,
- **Bruk lagret server** for å gå tilbake uten endringer,
- **Glem server** for å slette adressen og lokal data.

## Pushvarsler

Push bruker `@capacitor/push-notifications` og `@capacitor/app`. Native-skallet
eier tillatelse, token og varseltrykk; `capacitor-shell/fsm-push.js` injiseres i
den eksterne FSM-siden etter at den er lastet. Det krever ingen endringer i
plattformrepoet utover API-endepunktene.

Tokenflyt:

1. Etter at FSM-siden er lastet, sjekker skriptet om brukeren har en aktiv økt
   (`/api/auth/session`). Uten økt spørres det ikke om varseltillatelse.
2. Ved innlogging bes det om tillatelse (Android 13+ og iOS) og enheten
   registreres hos FCM/APNs.
3. Tokenet sendes til samme opprinnelse som FSM-serveren:
   `POST /api/mobile/push-tokens` med
   `{ token, platform, appVersion?, deviceId? }` og WebView-ens øktcookie.
4. Ved utlogging, utløpt økt eller «Bytt server» sendes
   `DELETE /api/mobile/push-tokens` med `{ token }`. Native-skallet gjør også et
   best-effort forsøk mot den gamle serveren når serveren byttes.
5. Et varseltrykk åpner `url`, `link`, `path`, `deeplink` eller `route` fra
   varseldataene i WebView-en. Kaldstart og bakgrunn håndteres både av
   Capacitor-hendelsen og av et native ventende dyp lenke.

Android krever `google-services.json` og et Firebase-prosjekt med pakken
`no.fsm.felt`. iOS krever Push Notifications-capability, en APNs-nøkkel i Apple
Developer og en provisioning profile med push. Nøkler og plist-filer skal aldri
i git; se [`docs/NATIVE.md`](docs/NATIVE.md) for oppsett, CI-hemmeligheter og
hva som må fylles inn manuelt.

## Bygg for butikk

### Android

1. Lag en egen upload-keystore (én gang, ta backup):
   ```bash
   keytool -genkeypair -v -keystore upload-keystore.jks \
     -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Kopier malen og legg `android/keystore.properties` utenfor git:
   ```bash
   cp android/keystore.properties.example android/keystore.properties
   ```
   Fyll inn verdiene:
   ```properties
   storeFile=/absolutt/sti/upload-keystore.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
   CI kan bruke `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` og `ANDROID_KEY_PASSWORD` i stedet.
3. Legg `android/app/google-services.json` på plass (ignoreres av git).
4. Bygg AAB:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
   `versionName` hentes fra `package.json`, `versionCode` fra
   `ANDROID_VERSION_CODE` (eller Gradle-property `versionCode`). Release-bygg
   uten keystore eller `google-services.json` feiler med en tydelig melding.
5. Last opp AAB-en i Google Play Console.

### iOS

1. Aktiver **Push Notifications** og **Background Modes → Remote notifications**
   for `no.fsm.felt` i Apple Developer/Xcode. Entitlements ligger i
   `ios/App/App/App.entitlements`.
2. Lag et Apple Distribution-sertifikat og en App Store-provisioning profile.
3. App Store Connect-app med bundle-id `no.fsm.felt`.
4. Arkiver og eksporter:
   ```bash
   xcodebuild -project ios/App/App.xcodeproj -scheme App \
     -configuration Release -destination 'generic/platform=iOS' archive
   xcodebuild -exportArchive -archivePath ... \
     -exportOptionsPlist ios/ExportOptions.plist.template
   ```
   Malen har plassholdere for team-id og profilnavn. CI fyller dem fra
   hemmeligheter. `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` kan overstyres
   med `APP_VERSION`/`IOS_BUILD_NUMBER` i CI.
5. Last opp IPA-en til App Store Connect.

### CI-hemmeligheter

Release-jobbene i `.github/workflows/ci.yml` kjøres bare manuelt
(`workflow_dispatch` med `release=true`) og krever:

| Hemmelighet | Bruk |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Upload-keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore-passord |
| `ANDROID_KEY_ALIAS` | Nøkkelalias |
| `ANDROID_KEY_PASSWORD` | Nøkkelpassord |
| `GOOGLE_SERVICES_JSON_BASE64` | Firebase-konfigurasjon |
| `APPLE_CERTIFICATE_BASE64` | Apple Distribution `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Sertifikatpassord |
| `APPLE_PROVISIONING_PROFILE_BASE64` | `.mobileprovision`, base64 |
| `APPLE_PROVISIONING_PROFILE_SPECIFIER` | Profilnavn |
| `APPLE_TEAM_ID` | Apple Team ID |

Debug- og simulatorbygg krever ingen av disse. `npm run check:push` verifiserer
at native push-oppsett er til stede; `--mode release` feiler hvis
`google-services.json` eller Android-signering mangler.

Signeringsfiler, `google-services.json`, `GoogleService-Info.plist`,
`keystore.properties`, `ExportOptions.plist` og keystore skal aldri i git.

## Ikoner og splash

```bash
npm run assets
```

Genererer Android-mipmaps, adaptive ikoner, iOS-appikon og splash fra
`assets/icon.svg`. Skriptet krever `sharp`.

## Dokumentasjon

- [`docs/NATIVE.md`](docs/NATIVE.md) – arkitektur, servervalg, offline-cache,
  sikkerhet, test-sjekkliste og hva som gjenstår før butikk.

## Forholdet til FSM-plattformen

Dette repoet inneholder bare det native skallet. Selve FSM-appen, API-ene,
databasen og service workeren ligger i plattformrepoet. Mobile repoet må ikke
duplisere forretningslogikk; det skal bare velge server, laste WebView-en og
exponere den lille native serverknappen.
