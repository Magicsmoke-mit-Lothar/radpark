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
infra/            Konfiguration für Datenbank und MQTT-Broker
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

1. Installiere **Expo Go** aus dem Google Play Store.
2. Handy und Rechner müssen im **selben WLAN** sein.
3. Starte in drei Terminals:

   ```bash
   pnpm dev:api        # Terminal 1: Backend
   pnpm sim            # Terminal 2: Simulator
   pnpm dev:mobile     # Terminal 3: App-Server → zeigt einen QR-Code
   ```

4. Öffne Expo Go und scanne den QR-Code. Die App lädt (beim ersten Mal ca. 30 Sekunden).
5. Melde dich mit einer beliebigen E-Mail an – der Code erscheint in der App
   („Entwicklungsmodus: Dein Code ist …“, antippen zum Einsetzen).
6. Tippe auf der Karte auf eine Station → **Hier parken** → der (simulierte) Bügel öffnet sich.
   Jetzt das Rad „einstellen“ – entweder per Knopf **🛠 Simulator: Rad einstellen** direkt in der
   App (nur im Entwicklungsmodus sichtbar) oder im Simulator-Terminal `parken BER-001 1`.
   → Parkzeit läuft. **Rad abholen** → **🛠 Simulator: Rad entnehmen** (oder `abholen BER-001 1`) → fertig.
   Ohne „Rad einstellen“ schließt der Bügel nach ca. 1 Minute wieder und die Reservierung endet.

Änderst du Code in `apps/mobile/src`, aktualisiert sich die App auf dem Handy sofort von selbst.

**Klappt die Verbindung nicht?**
- „Keine Verbindung zum Server“ in der App → läuft `pnpm dev:api`? Unter *Profil* steht ganz unten,
  welche Server-Adresse die App benutzt – öffne sie im Handy-Browser, z. B. `http://192.168.1.20:3000/health`.
- Expo Go findet den Rechner nicht → evtl. blockiert die Linux-Firewall. Ports freigeben:
  `sudo ufw allow 8081/tcp && sudo ufw allow 3000/tcp`
- Im Gäste-/Uni-WLAN sind Geräte oft voneinander abgeschirmt → Handy-Hotspot benutzen.

Ohne Handy geht es auch im Browser: im App-Terminal `w` drücken (statt der Karte gibt es dort eine Liste).

## Admin-Dashboard für Betreiber

```bash
pnpm dev:admin        # → http://localhost:5173 (Backend muss laufen)
```

Anmelden mit **admin@radpark.dev** (wird von `pnpm db:seed` angelegt), Code wie gewohnt.
Weitere Admins freischalten: `pnpm admin:grant name@example.com`

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
- [ ] **Schritt 6 – Betrieb:** Tests, CI, Deployment, Sicherheit (TLS + Zugangsdaten pro Ständer)
- [ ] **Schritt 7 – Hardware-Prototyp:** ESP32-Firmware mit demselben Protokoll wie der Simulator
- [ ] **Schritt 8 – Gamification:** Punkte, Streaks, Abzeichen, CO₂-Bilanz – berechnet aus dem Event-Log

Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) · [docs/PROTOKOLL.md](docs/PROTOKOLL.md)
