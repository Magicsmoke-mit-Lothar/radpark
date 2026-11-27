# RadPark – Software für smarte Fahrradständer

Arbeitstitel. Ziel: ein System wie Bikekeep (Tallinn). Nutzer finden per App einen freien
Stellplatz, schließen ihr Rad im Ständer ein und bezahlen die Parkzeit.

## Projektstruktur

```
apps/
  api/            Backend (Fastify + Drizzle + PostgreSQL/PostGIS)
  simulator/      (Schritt 2) simulierte Fahrradständer – ersetzt die Hardware, bis es einen Prototyp gibt
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

Nützliche Befehle:

```bash
pnpm typecheck        # TypeScript-Fehler im ganzen Projekt finden
pnpm db:generate      # nach Änderungen an apps/api/src/db/schema.ts: neue Migration erzeugen
pnpm infra:down       # Docker-Container stoppen (Daten bleiben erhalten)
```

## Fahrplan

- [x] **Schritt 1 – Fundament:** Monorepo, Docker, Datenmodell, Ständer-Protokoll, Stations-API
- [ ] **Schritt 2 – Ständer-Simulator + MQTT:** simulierte Ständer melden sich, Backend sieht online/offline und Belegung live
- [ ] **Schritt 3 – Parkvorgang:** Nutzer-Login, reservieren → entriegeln → einstellen → abholen, Preisberechnung, Event-Log
- [ ] **Schritt 4 – Mobile App:** Karte, Station wählen, parken, Live-Status
- [ ] **Schritt 5 – Bezahlung + Admin-Dashboard:** Stripe (Testmodus), Betreiber-Übersicht, Störungen
- [ ] **Schritt 6 – Betrieb:** Tests, CI, Deployment, Sicherheit (TLS + Zugangsdaten pro Ständer)
- [ ] **Schritt 7 – Hardware-Prototyp:** ESP32-Firmware mit demselben Protokoll wie der Simulator
- [ ] **Schritt 8 – Gamification:** Punkte, Streaks, Abzeichen, CO₂-Bilanz – berechnet aus dem Event-Log

Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) · [docs/PROTOKOLL.md](docs/PROTOKOLL.md)
