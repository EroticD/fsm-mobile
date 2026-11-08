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
- Service workeren cacher sider, API-GET og filer under `/uploads/` i
  **7 døgn**, per bruker. Cacheene slettes ved utlogging, utløpt økt og
  «Bytt server».

## Krav

- Node.js 22 eller nyere.
- Android: JDK 21 og Android SDK 36.
- iOS: macOS med Xcode 16 eller nyere. iOS kan ikke bygges på Linux.
- En kjørende FSM-installasjon. HTTPS i produksjon; HTTP er bare for lokal
  testing.

## Kom i gang

```bash
npm ci
npm run sync
```

`sync` kopierer `capacitor-shell` inn i Android- og iOS-prosjektene og
oppdaterer native avhengigheter. Kjøres etter endringer i skallet eller
Capacitor-konfigurasjonen.

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

## Bygg for butikk

- Android: egen upload-keystore, `signingConfigs` og
  `./gradlew bundleRelease` (AAB).
- iOS: Apple-sertifikat, provisioning profile og App Store Connect.
- Fyll ut personvernerklæring, databehandleravtale, aldersgrense, ikoner og
  skjermbilder.

Signeringsfiler, `google-services.json`, `GoogleService-Info.plist` og
keystore skal aldri i git.

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
