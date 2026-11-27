# RadPark – Software für smarte Fahrradständer

Arbeitstitel. Ziel: ein System wie Bikekeep (Tallinn). Nutzer finden per App einen freien
Stellplatz, schließen ihr Rad im Ständer ein und bezahlen die Parkzeit.

## Projektstruktur

```
apps/
  api/            Backend (Fastify + Drizzle + PostgreSQL/PostGIS)
  simulator/      simulierte Fahrradständer – ersetzen die Hardware, bis es einen Prototyp gibt
  mobile/         (Schritt 4) App für Radfahrer (Expo / React Native)
  admin/          (Schritt 5) Web-Dashboard für Betreiber (Next.js)
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

## Parken über die API (so wird es später die App machen)

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
- [ ] **Schritt 4 – Mobile App:** Karte, Station wählen, parken, Live-Status
- [ ] **Schritt 5 – Bezahlung + Admin-Dashboard:** Stripe (Testmodus), Betreiber-Übersicht, Störungen
- [ ] **Schritt 6 – Betrieb:** Tests, CI, Deployment, Sicherheit (TLS + Zugangsdaten pro Ständer)
- [ ] **Schritt 7 – Hardware-Prototyp:** ESP32-Firmware mit demselben Protokoll wie der Simulator
- [ ] **Schritt 8 – Gamification:** Punkte, Streaks, Abzeichen, CO₂-Bilanz – berechnet aus dem Event-Log

Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) · [docs/PROTOKOLL.md](docs/PROTOKOLL.md)
