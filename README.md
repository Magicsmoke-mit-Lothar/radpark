# RadPark – Software für smarte Fahrradständer

Arbeitstitel. Ziel: ein System wie Bikekeep (Tallinn). Nutzer finden per App einen freien
Stellplatz, schließen ihr Rad im Ständer ein und bezahlen die Parkzeit.

## Projektstruktur

```
apps/
  api/            Backend (Fastify + Drizzle + PostgreSQL/PostGIS)
  simulator/      simulierte Fahrradständer – ersetzen die Hardware, bis es einen Prototyp gibt
  mobile/         App für Radfahrer (Expo / React Native) – Android zuerst
  admin/          Web-Dashboard für Betreiber (Vite + React)
packages/
  protocol/       Der "Vertrag" zwischen Backend und Ständer (MQTT-Topics + Nachrichtenformate)
infra/            Konfiguration für Datenbank und MQTT-Broker (Entwicklung)
deploy/           Alles für den Server-Betrieb in Docker (siehe deploy/README.md)
docs/             Architektur und Protokoll – zum Nachlesen
```

## Schnellstart

Voraussetzungen: Node.js ≥ 22, pnpm, Docker.

```bash
pnpm install                      # Abhängigkeiten installieren
cp apps/api/.env.example apps/api/.env
pnpm infra:up                     # Datenbank + MQTT-Broker in Docker starten
pnpm db:migrate                   # Tabellen anlegen
pnpm db:seed                      # Teststationen anlegen (löscht vorhandene Daten!)
pnpm dev:api                      # Backend starten → http://localhost:3000
```

Ausprobieren (im Browser oder mit `curl`):

| Adresse | Was passiert |
|---|---|
| http://localhost:3000/health | Lebt der Server, erreicht er die Datenbank? |
| http://localhost:3000/stations | Alle Stationen mit freien Plätzen |
| http://localhost:3000/stations?lat=52.52&lng=13.405&radius=1500 | Stationen im Umkreis von 1,5 km, nach Entfernung sortiert |
| http://localhost:3000/stations/<id> | Eine Station mit allen Stellplätzen |

## Simulator: Fahrradständer ohne Hardware

Öffne ein **zweites Terminal** (das Backend läuft im ersten weiter):

```bash
pnpm sim
```

Der Simulator holt sich die Stationsliste vom Backend und verbindet für jede Station einen
simulierten Ständer mit dem MQTT-Broker. In der API steht danach `"online": true`.

Ein kompletter Durchlauf zum Ausprobieren:

```bash
# Terminal 3: Backend befiehlt "Dock 3 an BER-001 entriegeln" (später macht das die App)
curl -X POST localhost:3000/dev/stations/BER-001/docks/3/command \
     -H 'content-type: application/json' -d '{"type":"unlock"}'
```

```text
# im Simulator-Terminal:
sim> liste BER-001          → Dock 3 zeigt 🔓
sim> parken BER-001 3       → Rad erkannt, Bügel schließt → 🚲
sim> stoerung BER-002 1     → Dock wird im Backend "out_of_service"
sim> offline BER-003        → Stromausfall: Backend zeigt die Station nach Sekunden als offline
sim> online BER-003
sim> hilfe                  → alle Befehle
```

Was im Backend passiert ist, zeigt das Event-Log: http://localhost:3000/dev/events

> Es darf immer nur **ein** Simulator gleichzeitig laufen – zwei würden sich beim Broker
> gegenseitig die Verbindung wegnehmen.
>
> Die `/dev/*`-Endpunkte funktionieren nur mit `DEV_ROUTES=true` in `apps/api/.env` und sind
> ausschließlich für die Entwicklung gedacht.

## Die App auf deinem Android-Handy

> **Expo Go funktioniert für RadPark nicht mehr.** Die Karte (OpenStreetMap über MapLibre) braucht
> eigenen nativen Code, den Expo Go nicht enthält. Stattdessen gibt es zwei eigene Apps, gebaut in
> der Expo-Cloud (EAS, Projekt `@magic_smoke_mit_lothar/radpark`):

| | **Test-APK** (`preview`) | **Entwickler-APK** (`development`) |
|---|---|---|
| Wofür | Ausprobieren – überall, auch für andere Tester | Weiterentwickeln (ersetzt Expo Go) |
| App-Code | fest eingebaut | kommt live von deinem Rechner (Änderungen sofort sichtbar) |
| Server | `https://api.botrics.de` | je nach `EXPO_PUBLIC_API_URL` beim Start von Expo |
| Rechner muss laufen | nein (nur der Server) | ja (Expo-Server, im selben WLAN) |

**Bauen** (in `apps/mobile`, dauert inkl. Warteschlange 15 – 90 Min., kostenloser Plan: 15 Android-Builds):
```bash
cd apps/mobile
npx eas-cli@latest build -p android --profile preview       # Test-APK
npx eas-cli@latest build -p android --profile development   # Entwickler-APK
```
Am Ende gibt es einen Link (auch unter https://expo.dev → Projekt *radpark* → *Builds*). Den Link auf
dem Handy öffnen → APK herunterladen → installieren (Android fragt einmal, ob Apps aus dieser Quelle
erlaubt sind). **Neu bauen nötig** nur bei neuen nativen Bibliotheken, Änderungen an `app.json` oder
einem SDK-Update – reine Code-Änderungen landen bei der Entwickler-APK sofort auf dem Handy.

**Mit der Entwickler-APK entwickeln:**
```bash
pnpm dev:api:lan    # Terminal 1: Backend (oder Staging: siehe unten)
pnpm sim            # Terminal 2: Simulator
pnpm dev:mobile     # Terminal 3: Expo-Server → in der Entwickler-APK den Rechner auswählen
```
> ⚠️ `dev:api:lan` macht den **Entwicklungsmodus** (Login-Code steht in der Antwort!) für ALLE
> Geräte im WLAN erreichbar – nur im eigenen Heimnetz benutzen. In Uni-/Firmen-/Café-WLANs
> stattdessen gegen den Server testen: `EXPO_PUBLIC_API_URL=https://api.botrics.de pnpm dev:mobile`.

**Parken ausprobieren:** Station antippen → **Hier parken** → der (simulierte) Bügel öffnet sich →
**🛠 Simulator: Rad einstellen** (oder im Simulator-Terminal `parken BER-001 1`) → Parkzeit läuft →
**Rad abholen** → **🛠 Simulator: Rad entnehmen** → fertig. Ohne „Rad einstellen“ schließt der Bügel
nach ca. 1 Minute wieder und die Reservierung endet. Die 🛠-Knöpfe gibt es nur am eigenen Dock und
nur, solange der Server Simulator-Steuerung erlaubt.

**Karte:** OpenStreetMap-Daten, Kartenbilder von [OpenFreeMap](https://openfreemap.org) (kostenlos,
ohne API-Schlüssel). Quellenangabe über ⓘ oben rechts auf der Karte.

Ohne Handy geht es auch im Browser: im Expo-Terminal `w` drücken (statt der Karte gibt es dort eine Liste).

## Admin-Dashboard für Betreiber

```bash
pnpm dev:admin        # → http://localhost:5173 (Backend muss laufen)
```

Anmelden in der **Entwicklung** mit **admin@radpark.dev** (legt `pnpm db:seed` nur im
Entwicklungsmodus an – der Code steht dort ja ohnehin in der Antwort). Auf einem **Server** wird
stattdessen deine echte Adresse Admin (`ADMIN_EMAIL` in `deploy/.env`).
Admins verwalten: `pnpm admin:grant name@example.com` · `pnpm admin:revoke name@example.com`
(Docker: `pnpm stage:admin-grant …` / `pnpm stage:admin-revoke …`)

> ⚠️ Niemals eine erfundene Adresse (z. B. `…@radpark.dev`) auf einem Server zum Admin machen:
> Wer die Domain kauft, bekommt die Login-Codes. Das Backend warnt beim Start, falls doch.

| Seite | Was man sieht / tun kann |
|---|---|
| **Übersicht** | Kennzahlen (online, frei, belegt, gesperrt, Umsatz heute …) und „Braucht Aufmerksamkeit“ |
| **Stationen** | Jedes Dock live als farbige Kachel. Klick → Details + **Freigeben**, **Sperren**, **Entriegeln (Service)**, **LED blinken** |
| **Parkvorgänge** | Wer parkt gerade wo, wie lange, bisherige Kosten |
| **Ereignisse** | Das komplette Event-Log mit Filtern – auch jede Admin-Aktion mit Name |

Regeln: Ein gestörtes Dock lässt sich erst freigeben, wenn die Hardware keine Störung mehr meldet.
Ein gebuchtes Dock lässt sich nicht sperren. Entriegeln eines belegten Docks fragt vorher nach.

## Guthaben & Bezahlung (nur TESTMODUS – kein Echtgeld)

Parken wird vom **Guthaben** bezahlt. Aufladen geht im **Profil** (5 €, 10 €, 20 €); zum Starten
eines Parkvorgangs braucht man mindestens 1 € (`MIN_START_BALANCE_CENTS`). Abholen geht immer –
notfalls rutscht das Guthaben ins Minus und muss vor dem nächsten Parken ausgeglichen werden.

Zwei Test-Varianten, beide **ohne echtes Geld**:

| `STRIPE_SECRET_KEY` in `apps/api/.env` | Was passiert beim Aufladen |
|---|---|
| leer | **Testgutschrift** – Guthaben sofort da, keine Bezahlseite |
| `sk_test_…` | **Stripe-Testmodus** – echte Stripe-Bezahlseite, bezahlt wird mit der Testkarte `4242 4242 4242 4242` (Datum in der Zukunft, beliebige Prüfziffer) |

Ein Live-Schlüssel (`sk_live_…`) wird **abgelehnt** – das Backend startet dann gar nicht.

**Stripe-Testmodus einrichten:** kostenloses Konto auf stripe.com → Dashboard im **Testmodus** →
*Entwickler → API-Schlüssel* → „Geheimer Schlüssel“ (`sk_test_…`) kopieren → in `apps/api/.env`
bei `STRIPE_SECRET_KEY=` eintragen → Backend neu starten. (Den Schlüssel nie ins Git oder in Chats!)

**Gebühren testen ohne zu warten:** `POST /dev/sessions/<id>/backdate {"minutes": 130}` verlegt den
Start eines laufenden Parkvorgangs in die Vergangenheit („Zeitreise“, nur mit `DEV_ROUTES=true`).

## Parken über die API (so macht es die App im Hintergrund)

Backend und Simulator müssen laufen. Dann in einem dritten Terminal:

```bash
# 1. Login-Code anfordern (in der Entwicklung steht er direkt in der Antwort: "devCode")
curl -X POST localhost:3000/auth/request-code -H 'content-type: application/json' \
     -d '{"email":"ich@test.de"}'

# 2. Code eingeben → Token kommt zurück
curl -X POST localhost:3000/auth/verify -H 'content-type: application/json' \
     -d '{"email":"ich@test.de","code":"123456"}'
TOKEN="…hier das Token einfügen…"

# 3. Station-ID heraussuchen und Parken starten → Bügel öffnet sich
curl localhost:3000/stations
curl -X POST localhost:3000/parkings -H "authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"stationId":"…"}'
```

Im **Simulator** jetzt das Rad einstellen, z. B. `parken BER-001 1`. Danach:

```bash
curl localhost:3000/parkings/current -H "authorization: Bearer $TOKEN"        # läuft, mit Kosten bisher
curl -X POST localhost:3000/parkings/<id>/pickup -H "authorization: Bearer $TOKEN"  # Abholen → Bügel öffnet
```

Im Simulator `abholen BER-001 1` → Vorgang beendet, Preis berechnet: `curl localhost:3000/parkings -H "authorization: Bearer $TOKEN"`

### Alle Endpunkte

| Methode & Pfad | Login? | Zweck |
|---|---|---|
| `GET /health` | – | Läuft alles? |
| `GET /stations[?lat&lng&radius]` | – | Stationen (im Umkreis) mit freien Plätzen |
| `GET /stations/:id` | – | Station mit allen Docks |
| `POST /auth/request-code` | – | Login-Code per E-Mail anfordern |
| `POST /auth/verify` | – | Code eingeben → Token |
| `GET /me` · `POST /auth/logout` | ✔ | Eigenes Konto · Abmelden |
| `POST /parkings` | ✔ | Parken starten (`stationId`, optional `dockNumber`) |
| `GET /parkings/current` | ✔ | Laufender Parkvorgang inkl. bisheriger Kosten |
| `GET /parkings` | ✔ | Verlauf |
| `POST /parkings/:id/pickup` | ✔ | Rad abholen (Bügel öffnet) |
| `POST /parkings/:id/cancel` | ✔ | Reservierung abbrechen |
| `GET /wallet` | ✔ | Guthaben, Kontoauszug, Aufladeoptionen |
| `POST /wallet/topups` · `/wallet/topups/:id/confirm` | ✔ | Aufladung starten · nach Bezahlung bestätigen |
| `GET /admin/overview`, `/admin/stations`, `/admin/sessions/open`, `/admin/events` | Admin | Dashboard-Daten |
| `POST /admin/docks/:id/release` · `/disable` · `/command` | Admin | Dock freigeben · sperren · Service-Befehl |
| `POST /dev/stations/:code/docks/:n/simulate` | – | Nur Entwicklung: Simulator „Rad einstellen/entnehmen“ lassen |
| `POST /dev/...`, `GET /dev/events` | – | Nur Entwicklung (`DEV_ROUTES=true`) |

Fehler kommen immer als `{ "error": "CODE", "message": "…" }`, z. B. `NO_FREE_DOCK`, `ALREADY_PARKING`,
`STATION_OFFLINE`. Die App übersetzt den Code in eine verständliche Meldung.

## Login-E-Mails einrichten

Login-Codes werden per **SMTP** verschickt – das kann jeder E-Mail-Anbieter. Eintragen in
`apps/api/.env` (Entwicklung) bzw. `deploy/.env` (Docker/Server):

**Variante 1 – Gmail (am schnellsten, ohne eigene Domain, gut für Tests):**
1. Im Google-Konto die **Bestätigung in zwei Schritten** aktivieren.
2. Unter https://myaccount.google.com/apppasswords ein **App-Passwort** erstellen (16 Zeichen, Leerzeichen weglassen).
3. Eintragen (das `@` im Benutzernamen als `%40` schreiben):
   ```
   SMTP_URL=smtps://deine.adresse%40gmail.com:APPPASSWORT@smtp.gmail.com:465
   MAIL_FROM=RadPark <deine.adresse@gmail.com>
   ```
   Grenze: ca. 500 E-Mails pro Tag. Empfänger sehen deine Gmail-Adresse als Absender.

**Variante 2 – Brevo (empfohlen, sobald du eine eigene Domain hast):** kostenlos bis 300 E-Mails/Tag.
1. Konto auf brevo.com → *Senders, Domains & Dedicated IPs* → **Domain authentifizieren**
   (Brevo zeigt DNS-Einträge – bei Cloudflare in 2 Minuten eingetragen). Ohne eigene Domain
   landen Mails von Freemail-Absendern oft im Spam.
2. *SMTP & API* → SMTP-Schlüssel erzeugen. Eintragen:
   ```
   SMTP_URL=smtp://DEIN-SMTP-LOGIN:DEIN-SMTP-SCHLÜSSEL@smtp-relay.brevo.com:587
   MAIL_FROM=RadPark <login@deine-domain.de>
   ```

Sonderzeichen im Passwort (z. B. `@ : / #`) müssen URL-kodiert werden (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).

**Testen:** `pnpm mail:test deine@adresse.de` (Entwicklung) bzw. `pnpm stage:mail-test deine@adresse.de` (Docker).
Beim Start schreibt das Backend außerdem „📧 E-Mail-Versand bereit“ – oder einen Fehler, wenn
Server oder Zugangsdaten nicht stimmen.

**Schutz gegen Missbrauch** (eingebaut): pro E-Mail-Adresse höchstens alle 60 s ein Code und
5 pro Stunde; pro IP-Adresse 20 Anforderungen pro Stunde und 60 Code-Eingaben pro 15 Minuten
(`LOGIN_CODE_REQUESTS_PER_HOUR`, `LOGIN_VERIFY_PER_15_MIN`).

## Server-Betrieb / Docker

Siehe **[deploy/README.md](deploy/README.md)** – kurz: `pnpm stage:up`, `pnpm stage:seed`,
dann http://localhost:8088 (Admin) und http://localhost:8025 (Test-Postfach für Login-Codes).

## Nützliche Befehle

```bash
pnpm typecheck        # TypeScript-Fehler im ganzen Projekt finden
pnpm test             # automatische Tests ausführen
pnpm dev:reset        # alles auf Anfang: Testdaten neu, Broker & Simulator-Zustand geleert
pnpm db:generate      # nach Änderungen an apps/api/src/db/schema.ts: neue Migration erzeugen
pnpm infra:down       # Docker-Container stoppen (Daten bleiben erhalten)
```

## Fahrplan

- [x] **Schritt 1 – Fundament:** Monorepo, Docker, Datenmodell, Ständer-Protokoll, Stations-API
- [x] **Schritt 2 – Ständer-Simulator + MQTT:** simulierte Ständer melden sich, Backend sieht online/offline und Belegung live
- [x] **Schritt 3 – Parkvorgang:** Nutzer-Login, reservieren → entriegeln → einstellen → abholen, Preisberechnung, Event-Log
- [x] **Schritt 4 – Mobile App (Android):** Login, Karte, parken, Live-Status, Abholen, Verlauf
  - [ ] später: iOS testen, Live-Updates per WebSocket statt Nachfragen, „Navigation zur Station“
- [x] **Schritt 5a – Admin-Dashboard:** Kennzahlen, Stationen live, Störungen beheben, Event-Log, Admin-Rolle
- [x] **Schritt 5b – Guthaben:** aufladen (Testgutschrift / Stripe-Testmodus), Abbuchung nach dem Parken, Kontoauszug
  - [ ] Stripe-Testmodus mit echten Testschlüsseln durchspielen · Stripe-Webhooks (brauchen öffentliche Adresse → Schritt 6)
- [x] **Schritt 6a – Docker/Staging:** komplettes System in Docker, Caddy (HTTPS-fähig), Login-Codes per E-Mail,
  MQTT mit Passwort + Rechten pro Ständer, Stripe-Webhook, abgeschaltete Dev-Funktionen → [deploy/README.md](deploy/README.md)
- [x] **Schritt 6b (Teil 1) – Cloudflare-Tunnel:** öffentlich unter https://api.botrics.de / https://admin.botrics.de
  ohne offene Ports (Anleitung: [deploy/README.md](deploy/README.md))
- [x] **Schritt 6b (Teil 2) – Test-APK:** Karte auf OpenStreetMap (MapLibre) umgestellt, APK per EAS Build
- [ ] **Schritt 7 – Hardware-Prototyp:** ESP32-Firmware mit demselben Protokoll wie der Simulator
- [ ] **Schritt 8 – Gamification:** Punkte, Streaks, Abzeichen, CO₂-Bilanz – berechnet aus dem Event-Log

Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) · [docs/PROTOKOLL.md](docs/PROTOKOLL.md)
