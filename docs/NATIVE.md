# Native feltapp (Android og iOS)

Feltappen finnes både som installerbar PWA og som et tynt Capacitor-skal for
Android og iOS. Skallet pakker ikke Next.js-appen som statiske filer: appen er
server-rendret og trenger API, økter, database og offline-endepunkter. WebView-en
laster derfor en FSM-installasjon som brukeren velger ved første oppstart.

## Viktig endring: serveradressen er ikke bygget inn

Tidligere måtte `CAPACITOR_SERVER_URL` settes før `npx cap sync`. Det er ikke
lenger nødvendig, og variabelen brukes ikke av appen.

- Første oppstart viser en lokal oppsettside i `capacitor-shell/index.html`.
- Brukeren skriver inn URL-en til FSM-plattformen, for eksempel
  `https://felt.firma.no`.
- Adressen valideres, lagres i native lagring (Android `SharedPreferences`,
  iOS `UserDefaults`) og brukes ved neste oppstart.
- Adressen kan endres fra **Innstillinger → Server** eller fra innloggingssiden
  med **Bytt server**. Appen går da tilbake til oppsettsiden.
- Samme app kan dermed brukes mot flere installasjoner uten å bygges på nytt.

## Arkitektur

- `capacitor.config.ts` – app-id, appnavn, bakgrunnsfarge og felles
  WebView-innstillinger. `server.url` settes ved kjøring, ikke her.
- `capacitor-shell/index.html` – lokal oppsettside med URL-skjema, validering og
  hjelpetekst.
- `capacitor-shell/fsm-push.js` – push-bootstrap som native-skallet injiserer i
  den eksterne FSM-siden. Den håndterer tillatelse, tokenregistrering,
  utlogging/opprydding og dype lenker uten at plattformappen må bygges på nytt.
- `android/` – ferdig generert Android-prosjekt. `MainActivity` bygger
  Capacitor-konfigurasjonen på nytt ved oppstart og bruker lagret serveradresse.
  `ServerConfigPlugin` leser/lagrer/fjerner adressen. `FsmPushPlugin` og
  `PushStateStore` eksponerer appversjon, ventende dyp lenke og tokenopprydding.
- `ios/` – ferdig generert Xcode-prosjekt. `FSMBridgeViewController` setter
  `server.url` fra `UserDefaults`, og `ServerConfigPlugin` gjør samme jobb som
  på Android. `PushSupport.swift` gjør push-jobben på iOS.
- `scripts/generate-mobile-assets.mjs` – genererer ikoner og splash fra
  `assets/icon.svg`.
- `scripts/check-push-config.mjs` – CI-sjekk av push- og release-oppsett.

Når adressen er satt, lastes FSM-appen i WebView-en. Den arver PWA-ens
service worker, offline-kladder, PIN-lås, kamera, kart og `tel:`/`geo:`-lenker.
Native bro brukes til servervalg, pushvarsler og til å kjenne igjen at appen
kjører native.

## Krav

- Node.js 22 eller nyere.
- Android: JDK 21, Android SDK 36 og Android Studio (eller kommandolinje).
- iOS: macOS med Xcode 16 eller nyere. iOS kan ikke bygges på Linux.
- FSM-installasjonen må være tilgjengelig fra telefonen. Bruk HTTPS i
  produksjon. HTTP er bare ment for lokal testing.

### Serverforutsetninger

- `NEXTAUTH_URL` må peke på den samme offentlige adressen som appen bruker.
- `AUTH_TRUST_HOST=true` når appen kjøres bak proxy eller i container.
- Gyldig TLS-sertifikat for produksjon. Appen tillater HTTP for lokal testing,
  men viser en advarsel i oppsettsiden.
- `NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS` kan økes hvis kladder skal leve
  lenger enn standarden. Side-, API- og filcachen har fast 7 døgn.

## Første gangs oppsett

```bash
npm ci
npx cap sync
```

Android- og iOS-prosjektene er allerede generert og sjekket inn. Hvis de må
genereres på nytt:

```bash
npx cap add android
# På macOS:
npx cap add ios
npm run sync
```

`npm run sync` kopierer skallfilene og oppdaterer native avhengigheter. Den
trenger ingen serveradresse.

## Pushvarsler – arkitektur og serverkontrakt

Push er implementert i det native skallet, ikke i plattformappen. Årsaken er at
appen laster en ekstern, server-rendret FSM-installasjon. Native-skallet kan
derfor ikke forutsette at plattformappen har Capacitor-kode eller en egen
push-side.

Flyten er:

1. Etter side lasting injiserer `MainActivity` (Android) eller
   `FSMBridgeViewController` (iOS) `public/fsm-push.js`.
2. Skriptet venter på at Capacitor-broen er klar, sjekker
   `GET /api/auth/session` med WebView-ens cookie og gjør ingenting før
   brukeren er innlogget.
3. Etter innlogging: `PushNotifications.checkPermissions()` →
   `requestPermissions()` → `register()`.
4. `registration`-hendelsen gir FCM-token (Android) eller APNs-token (iOS).
   Skriptet sender:
   ```http
   POST /api/mobile/push-tokens
   Content-Type: application/json
   Cookie: <WebView-økt>

   {"token":"...","platform":"android|ios","appVersion":"0.8.11","deviceId":"..."}
   ```
   `appVersion` og `deviceId` er valgfrie. `deviceId` er en tilfeldig UUID som
   lagres i `localStorage` per server. Serveren skal svare 2xx ved suksess og
   skal knytte tokenet til innlogget bruker/enhet.
5. Ved utlogging eller utløpt økt sender skriptet:
   ```http
   DELETE /api/mobile/push-tokens
   Content-Type: application/json

   {"token":"..."}
   ```
6. Ved «Bytt server» gjør native-laget et best-effort `DELETE` mot den gamle
   serveren med lagret token og WebView-cookie, og sletter lokal tokenstate.
   Feil ignoreres; serveren må uansett avvise tokenet når økten er ugyldig.

Tokenet lagres i `localStorage` (`fsm:push:v1`) og native lagring. Ved
tokenfornyelse sender FCM/APNs en ny `registration`-hendelse, og skriptet
registrerer tokenet på nytt. Ved sideopplasting og app-resume kalles
`register()` igjen, slik at et token som ble fornyliget i bakgrunnen blir sendt.

### Dype lenker

Et varseltrykk kan inneholde ett av feltene `url`, `link`, `path`, `deeplink`,
`deep_link`, `route` eller `target`, enten på toppnivå eller i et `data`-objekt.
Eksempel:

```json
{
  "notification": {
    "title": "Nytt oppdrag",
    "body": "Oppdrag 123 er tildelt deg"
  },
  "data": {
    "path": "/oppdrag/123"
  }
}
```

- Android: `MainActivity` leser launch-intent (kaldstart) og `onNewIntent`
  (bakgrunn) og lagrer ventende sti. `fsm-push.js` konsumerer den og gjør
  `location.assign(path)` i WebView-en.
- iOS: `AppDelegate` leser `launchOptions[.remoteNotification]` ved kaldstart;
  Capacitor-pluginens `pushNotificationActionPerformed` (retained) brukes når
  appen allerede kjører. Begge går gjennom samme dedupliserte `openPath`.
- Egne URL-er (`no.fsm.felt://oppdrag/123`) støttes også via Android
  intent-filter og iOS `CFBundleURLTypes`/`appUrlOpen`.

Bare stier på samme opprinnelse som den valgte FSM-serveren åpnes. Eksterne
URL-er ignoreres.

### Android-oppsett

- `android/app/build.gradle` bruker `com.google.gms.google-services` når
  `google-services.json` finnes. Releasebygg feiler hvis filen mangler.
- `AndroidManifest.xml` deklarerer `POST_NOTIFICATIONS`, standardkanal
  `fsm_default`, standardikon `@drawable/ic_stat_fsm` og URL-skjemaet
  `no.fsm.felt`.
- `MainActivity` oppretter kanalen tidlig i `onCreate`, slik at FCM kan bruke
  den allerede ved første varsel. Kanal-id kan overstyres av serveren med
  `channelId`, men `fsm_default` er standard.
- Ta aldri `google-services.json` i git. I CI legges den inn fra
  `GOOGLE_SERVICES_JSON_BASE64`.

### iOS-oppsett

- `ios/App/App/App.entitlements` har `aps-environment` satt fra
  `APS_ENVIRONMENT` (`development` i Debug, `production` i Release).
- `AppDelegate` videresender APNs-registrering og -feil til
  `@capacitor/push-notifications`, og lagrer kaldstart-dyp lenke.
- `Info.plist` har `UIBackgroundModes = remote-notification`,
  kamera-/posisjonstekster og URL-skjemaet `no.fsm.felt`.
- `GoogleService-Info.plist` er bare nødvendig hvis serveren sender FCM til iOS
  i stedet for direkte APNs. Filen er ignorert av git og skal ikke committes.
- APNs-nøkkelen (`.p8`) ligger på serveren/Apple Developer, ikke i appen.

## Android – bygge og teste

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

APK-en ligger i `android/app/build/outputs/apk/debug/app-debug.apk`. Installer
den på en emulator eller telefon:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Lokal server på Android-emulator

Service workers krever en sikker kontekst. `10.0.2.2` regnes ikke som
`localhost`, så bruk `adb reverse` og `http://localhost:3000`:

```bash
adb reverse tcp:3000 tcp:3000
npm run build
npm run start   # eller npm run dev for rask testing uten service worker
```

Skriv `http://localhost:3000` i oppsettsiden. For test på fysisk telefon kan du
bruke maskinens LAN-adresse, for eksempel `http://192.168.1.20:3000`; appen
tillater HTTP for private adresser, men service worker virker bare i sikker
kontekst. Bruk HTTPS eller `adb reverse` for å teste offline-cachen.

### Release-bygg

1. Lag en egen upload-keystore og legg `keystore.properties` utenfor git:
   ```bash
   keytool -genkeypair -v -keystore upload-keystore.jks \
     -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   ```properties
   storeFile=/absolutt/sti/upload-keystore.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
2. Alternativt kan CI sette `ANDROID_KEYSTORE_PATH`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` og
   `ANDROID_KEY_PASSWORD`. `android/app/build.gradle` leser begge kilder.
3. Legg `android/app/google-services.json` på plass (ignoreres av git).
4. Bygg AAB med `./gradlew bundleRelease`. Release-bygg uten keystore eller
   `google-services.json` stopper med en tydelig feilmelding; debug-bygg gjør
   ikke det.
5. Last opp AAB-en til Google Play Console.

Versjonering:

- `versionName` hentes fra `package.json` med mindre `ANDROID_VERSION_NAME` er
  satt.
- `versionCode` settes med `ANDROID_VERSION_CODE` (eller Gradle-property
  `versionCode`). Den må øke for hver opplasting til Play. CI-jobben
  `android-release` tar `version_code` som input.
- Bruk samme `version` i `package.json` som markedsføringsversjon, og la
  `versionCode`/iOS build-nummer være monotone heltall per utgivelse.

## iOS – bygge og teste

På macOS:

```bash
npx cap sync ios
npx cap open ios
```

Velg simulator eller enhet i Xcode og kjør. For lokal server på simulatoren:

```bash
npm run build
npm run start   # eller npm run dev
```

Skriv `http://localhost:3000` i oppsettsiden. iOS tillater lokal HTTP i
WebView gjennom `NSAllowsLocalNetworking` og
`NSAllowsArbitraryLoadsInWebContent`. Produksjon skal bruke HTTPS.

### Release-bygg

1. Apple Distribution-sertifikat og App Store-provisioning profile med push.
2. App Store Connect-app med bundle-id `no.fsm.felt`.
3. Sett `APPLE_TEAM_ID` og `APPLE_PROVISIONING_PROFILE_SPECIFIER` i CI, eller
   signer i Xcode.
4. Arkiver og eksporter:
   ```bash
   xcodebuild -project ios/App/App.xcodeproj -scheme App \
     -configuration Release -destination 'generic/platform=iOS' \
     -archivePath build/App.xcarchive archive
   xcodebuild -exportArchive -archivePath build/App.xcarchive \
     -exportPath build/export \
     -exportOptionsPlist ios/ExportOptions.plist.template
   ```
   CI erstatter plassholderne i malen og lager en midlertidig
   `ExportOptions.plist`. Den ekte filen skal ikke i git.
5. Last opp IPA-en til App Store Connect.

Versjonering: `MARKETING_VERSION` (markedsføringsversjon) og
`CURRENT_PROJECT_VERSION` (build-nummer) er satt i Xcode-prosjektet. CI kan
overstyre dem med `APP_VERSION` og `IOS_BUILD_NUMBER`; build-nummeret må øke for
hver opplasting. Hold `MARKETING_VERSION` lik `package.json`-versjonen.

### CI og release-jobber

`.github/workflows/ci.yml` kjører alltid:

- `npm ci`, push-konfigurasjonssjekk og Android debug-APK;
- `npm ci`, push-konfigurasjonssjekk og iOS simulatorbygg uten signering.

Signerte artifact-jobber kjøres bare manuelt via `workflow_dispatch` med
`release=true`. De krever hemmelighetene under. Debug- og simulatorbygg skal
aldri kreve disse.

| Hemmelighet | Plattform |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Android |
| `ANDROID_KEYSTORE_PASSWORD` | Android |
| `ANDROID_KEY_ALIAS` | Android |
| `ANDROID_KEY_PASSWORD` | Android |
| `GOOGLE_SERVICES_JSON_BASE64` | Android |
| `APPLE_CERTIFICATE_BASE64` | iOS |
| `APPLE_CERTIFICATE_PASSWORD` | iOS |
| `APPLE_PROVISIONING_PROFILE_BASE64` | iOS |
| `APPLE_PROVISIONING_PROFILE_SPECIFIER` | iOS |
| `APPLE_TEAM_ID` | iOS |

## Offline-cache i 7 døgn

Service workeren i `public/sw.js` cacher:

- alle samme-opprinnelse GET-sider, både HTML og RSC-payload;
- API-GET som ikke er auth, eksport, cron, webhooks, SCIM, helse eller metrics;
- filer under `/uploads/` (bilder, dokumenter, PDF-er);
- statiske filer og offline-siden cache-first.

Hver oppføring har et tidsstempel og serveres i **7 døgn**. Etter det slettes
den og hentes på nytt fra serveren. Cacheene er brukerscopede
(`fsm-pages-v1:<userId>`, `fsm-api-v1:<userId>`, `fsm-files-v1:<userId>`) og
slettes ved utlogging, utløpt økt og «Bytt server». Appen ber også om
`navigator.storage.persist()` slik at nettleseren beholder dataene under
lagringspress.

Forhåndslasting skjer for `/`, `/oppdrag`, `/kalender`, `/kunder`,
`/mine-oppdrag`, `/rapporter` og `/dokumenter` etter innlogging. Andre sider
caches når de besøkes.

### Sikkerhetsforbehold

- Cachede HTML-/API-svar er ikke kryptert av service workeren. De er beskyttet
  av enhetens lås, appens PIN-lås og sletting ved utlogging/utløpt økt. På en
  delt enhet bør brukeren logge ut eller bruke «Bytt server» før enheten
  overlates.
- Bare GET caches. Innlogging, skjemainnsending og offline-synk går alltid mot
  serveren.
- Store filer kan fylles av enhetens lagringskvote. Service workeren begrenser
  antall oppføringer per cache og sletter de eldste først.

## Hva som gjenstår før butikk

Kildekoden, native prosjektene, servervalg, push-integrasjon, ikoner,
offline-cache, signeringsoppsett og CI er på plass. Før butikkpublisering
gjenstår bare det som krever ekte kontoer og hemmeligheter:

1. **Ekte FCM/APNs:** Firebase-prosjekt med `google-services.json`, APNs-nøkkel
   i Apple Developer, og serverens utsending av varsler. Uten dette kan
   tokenflyten bare verifiseres som «ingen token/ingen varsel».
2. **Ekte signering:** Android upload-keystore og Apple Distribution-sertifikat
   med provisioning profile. Legg dem i CI-hemmelighetene; aldri i git.
3. **Butikkinnhold:** ikoner, skjermbilder, personvernerklæring,
   databehandleravtale, aldersgrense og beskrivelse.
4. **Enhets-test:** push i forgrunn/bakgrunn/kaldstart, varseltrykk mot
   `/oppdrag/<id>`, kamera/QR, filopplasting, geolokasjon, dyp lenke og
   offline-gjenoppretting på fysiske enheter.
5. **Eventuell MDM/enterprise-distribusjon:** Android Managed Google Play eller
   Apple Business Manager.

Push kan ikke fullt ut verifiseres i dette repoet uten Firebase-prosjekt,
Apple-utviklerkonto og en fysisk enhet. CI verifiserer at native filer og
konfigurasjon er til stede, og at Android/iOS fortsatt bygger.

## Test-sjekkliste

- [ ] Første oppstart viser oppsettsiden, ikke en hardkodet server.
- [ ] Ugyldig URL og HTTP mot offentlig vert avvises med tydelig feil.
- [ ] Gyldig HTTPS-URL lagres og FSM-appen lastes.
- [ ] Appen starter direkte mot lagret server etter omstart.
- [ ] «Bytt server» på innloggingssiden og i innstillinger gir oppsettsiden.
- [ ] Innlogging, SSO og kundeportal fungerer i WebView.
- [ ] Kamera/QR og bildepålegg ber om tillatelse og virker.
- [ ] Varseltillatelse spørres om først etter innlogging, ikke på oppsettsiden.
- [ ] Enheten registreres i `POST /api/mobile/push-tokens` med riktig
      `platform` og `appVersion`.
- [ ] Varsel i forgrunn, bakgrunn og ved kaldstart vises.
- [ ] Trykk på varsel med `path: "/oppdrag/<id>"` åpner riktig side i WebView.
- [ ] Ugyldig/ekstern dyp lenke ignoreres.
- [ ] Utlogging og «Bytt server» fjerner tokenet (sjekk serverlogg/API).
- [ ] Tokenfornyelse (FCM/APNs) registreres på nytt uten app-restart.
- [ ] Geokoding, kart og `geo:`/`tel:`-lenker virker.
- [ ] Flymodus: tidligere besøkte sider, API-data og filer vises.
- [ ] Data eldre enn 7 døgn serveres ikke fra cache.
- [ ] Utlogging og «Bytt server» sletter cachede data.
- [ ] Android back-knapp og iOS-swipe navigerer riktig.

## Sikkerhet

- Bruk alltid HTTPS i produksjon. `cleartext` er bare for lokal testing.
- Ikke legg signeringsfiler, `keystore.properties`, `google-services.json`,
  `GoogleService-Info.plist`, `ExportOptions.plist` eller APNs-nøkler i git.
- Push-tokenet er ikke en hemmelighet i seg selv, men det identifiserer en
  enhet. Serveren må knytte det til innlogget bruker, avvise tokenet etter
  utlogging/utløpt økt og aldri sende varsler til et token som tilhører en
  annen bruker.
- Den injiserte bootstrapen åpner bare stier på samme opprinnelse som den
  valgte FSM-serveren. Eksterne URL-er fra varseldata ignoreres.
- Native skallet omgår ikke autorisasjon. Alle sider og API-kall krever fortsatt
  innlogging, og skannede koder slås opp på serveren med brukerens rettigheter.
