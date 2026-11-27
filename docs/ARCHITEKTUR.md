# Architektur

## Das große Bild

```
  ┌────────────┐      HTTPS (REST)       ┌──────────────┐       MQTT        ┌──────────────────┐
  │ Mobile App │ ──────────────────────▶ │              │ ◀───────────────▶ │  Fahrradständer  │
  └────────────┘                         │   Backend    │   (über Broker)   │  (Simulator oder │
  ┌────────────┐      HTTPS (REST)       │   (apps/api) │                   │   echter ESP32)  │
  │ Admin-Web  │ ──────────────────────▶ │              │                   └──────────────────┘
  └────────────┘                         └──────┬───────┘
                                                │ SQL
                                         ┌──────▼───────┐
                                         │ PostgreSQL + │
                                         │   PostGIS    │
                                         └──────────────┘
```

**Warum zwei verschiedene "Sprachen" (REST und MQTT)?**

- **REST/HTTP** ist für Apps gemacht: die App fragt, der Server antwortet.
- **MQTT** ist für Geräte gemacht: braucht wenig Strom und Datenvolumen, funktioniert auch bei
  wackeligem Mobilfunk, und der Server kann dem Ständer jederzeit Befehle schicken
  ("Dock 3 entriegeln"). Ein **Broker** (bei uns Mosquitto) verteilt die Nachrichten wie ein Postamt.

## Wichtige Entscheidungen

| Entscheidung | Warum |
|---|---|
| **TypeScript überall** | Eine Sprache für Backend, App, Admin und Simulator; Typen werden geteilt (`packages/protocol`). |
| **Monorepo mit pnpm** | Alle Teile in einem Repository – Änderungen am Protokoll sieht man sofort in Backend und Simulator. |
| **Fastify** (Backend) | Schnell, schlank, leicht zu verstehen. |
| **Drizzle** (Datenbank) | Tabellen werden in TypeScript beschrieben, Abfragen sind typsicher und nah an SQL. |
| **PostgreSQL + PostGIS** | Bewährte Datenbank; PostGIS beantwortet "welche Ständer sind im Umkreis von 500 m?" mit Index, auch bei sehr vielen Ständern. |
| **Hardware nur über das Protokoll** | Das Backend kennt keine Hardware-Details. Simulator und echter Ständer sind austauschbar. |
| **Geschäftsstatus ≠ Hardwarestatus** | `docks.status` (frei/reserviert/belegt) entscheidet das Backend. `lockState`/`bikePresent` meldet die Hardware. So kann man Widersprüche erkennen (z. B. "frei", aber Sensor sieht ein Rad → Störung). |
| **Event-Log** (`events`-Tabelle) | Jede Aktion wird angehängt, nie geändert. Basis für Fehlersuche, Statistiken und später Gamification. |
| **Geld in Cent als Ganzzahl** | Kommazahlen haben Rundungsfehler – bei Geld tabu. |

## Datenmodell

```
stations 1───n docks 1───n parking_sessions n───1 users
                                                         events (Protokoll über alles)
```

- **stations**: Standort, Koordinaten, Preis, online/offline
- **docks**: einzelner Stellplatz mit Nummer, Status und letztem Hardware-Zustand
- **users**: Nutzer (Login folgt in Schritt 3)
- **parking_sessions**: ein Parkvorgang von Reservierung bis Abholung, inkl. Preis
- **events**: alles, was passiert ist

## Parkvorgang (Zustandsautomat)

```
            Bügel öffnet,         Rad erkannt          „Abholen“ → Bügel öffnet,
 POST /parkings ──▶ reserved ── + Schloss zu ──▶ active ── Sensor: Rad weg ──▶ completed (Preis)
                       │                           │
                       │ Bügel leer zu /           │ Bügel geht mit Rad wieder zu
                       │ Abbruch / Timeout         │ → bleibt active ("pickup_timeout")
                       ▼                           │
                   cancelled                       │ Rad weg OHNE „Abholen“
                                                   └──▶ completed + 🚨 BIKE_REMOVED_UNEXPECTEDLY
```

- **Nutzer-Aktionen** (parken, abholen, abbrechen): `apps/api/src/parking/service.ts`
- **Hardware-Reaktionen** (Rad erkannt, Rad weg …): `apps/api/src/parking/lifecycle.ts`
- **Preis**: `apps/api/src/parking/pricing.ts` – 5 Freiminuten, dann je angefangene Stunde,
  Tageshöchstpreis 8 Stunden. Mit automatischen Tests (`pnpm test`).

**Schutz gegen Doppelbuchungen** – dreifach:
1. Eindeutige Teil-Indizes in der Datenbank: pro Dock und pro Nutzer höchstens ein offener Vorgang.
   Selbst bei einem Programmierfehler kann die Datenbank keine Doppelbuchung speichern.
2. `SELECT … FOR UPDATE SKIP LOCKED`: Buchen zehn Leute gleichzeitig, bekommt jeder ein anderes Dock.
3. Hardware-Meldungen und Nutzer-Aktionen sperren dieselbe Dock-Zeile, bevor sie etwas ändern.

**Login ohne Passwort**: E-Mail → 6-stelliger Code (10 Min., max. 5 Versuche) → Token (90 Tage).
Gespeichert werden nur Hashes von Codes und Tokens.

## Guthaben (Wallet)

```
Aufladen:  App → POST /wallet/topups → Stripe-Bezahlseite (Testmodus) → zurück in die App
           → POST /wallet/topups/:id/confirm → Backend fragt Stripe "bezahlt?" → Gutschrift
Parken:    Rad entnommen → Parkvorgang beendet + Preis vom Guthaben abgebucht (EINE Transaktion)
```

- **Buchungsjournal** (`wallet_transactions`): jede Gut-/Lastschrift eine Zeile, nie geändert.
  `users.balance_cents` wird nur in derselben Transaktion geändert → Summe der Buchungen = Kontostand.
- **Nie doppelt:** eindeutige Indizes – eine Aufladung wird höchstens einmal gutgeschrieben, ein
  Parkvorgang höchstens einmal abgebucht (auch wenn Bestätigungen doppelt eintreffen).
- **Gutschrift erst nach Rückfrage beim Zahlungsanbieter** – die Rückleitung von Stripe allein
  zählt nicht (die könnte jeder aufrufen). Ein Hintergrund-Job gleicht offene Aufladungen alle 30 s ab.
- **Zahlungsanbieter austauschbar** (`src/wallet/providers.ts`): `StripeProvider` / `FakeProvider`.
- **Warum Guthaben statt Abbuchung pro Parkvorgang?** Kartenzahlungen kosten eine feste Gebühr pro
  Zahlung – bei 0,50 € Parkgebühr wäre das unwirtschaftlich. Eine Aufladung = eine Gebühr.
- **Nur Testmodus:** `config.ts` lehnt Live-Schlüssel ab.

## Mobile App (`apps/mobile`)

| Baustein | Wofür |
|---|---|
| **Expo SDK 58 + Expo Router** | Eine Codebasis für Android & iOS; jede Datei in `src/app/` ist ein Bildschirm |
| `Stack.Protected` | Ohne Login sind nur Login-Bildschirm erreichbar, mit Login nur die Tabs |
| **TanStack Query** (`src/lib/queries.ts`) | Lädt Daten, hält sie aktuell (Stationen alle 10 s, laufendes Parken alle 2 s) |
| `src/lib/api.ts` | Einzige Stelle, die mit dem Backend spricht – inkl. Datentypen |
| **expo-secure-store** | Login-Token verschlüsselt auf dem Handy speichern |
| **react-native-maps** | Karte (Google Maps auf Android). Läuft in Expo Go ohne API-Schlüssel; für den Play Store braucht es später einen. |
| `*.web.tsx` | Browser-Ersatz für handy-spezifische Teile (Karte → Liste), nur zum Entwickeln |

Fehlercodes vom Backend (`NO_FREE_DOCK` …) übersetzt `src/lib/format.ts` in deutsche Meldungen.

## Admin-Dashboard (`apps/admin`)

Vite + React + TanStack Query – eine reine Browser-App (kein eigener Server nötig), spricht mit
denselben Backend-Endpunkten unter `/admin/*`. Zugriff nur mit Rolle `admin` (`users.role`).
Rechteprüfung passiert **im Backend** (`requireAdmin`), nicht im Browser – das Dashboard selbst
ist nur eine Oberfläche. Jede Admin-Aktion wird mit der Admin-ID im Event-Log gespeichert.

## Skalierung – wie das später wächst

Das MVP läuft auf einem Server. Die Architektur ist so gewählt, dass man später ohne Umbau ausbauen kann:

1. **Backend mehrfach starten** hinter einem Load Balancer. Das Backend speichert nichts im
   Arbeitsspeicher, was die anderen Instanzen nicht auch wüssten (alles liegt in der Datenbank) –
   deshalb geht das. Für MQTT nutzen wir dann *Shared Subscriptions*, damit jede Ständer-Nachricht
   nur von einer Instanz verarbeitet wird.
2. **Verwaltete Dienste** statt eigener Container: z. B. eine gemanagte PostgreSQL-Datenbank und ein
   gemanagter MQTT-Broker (EMQX, HiveMQ, AWS IoT Core).
3. **Redis** für Live-Updates an Apps (WebSockets über mehrere Instanzen) und für Caching – erst wenn nötig.
4. **Event-Log auslagern** in ein Data Warehouse, wenn es sehr groß wird (Statistiken für Städte).

## Sicherheit

Umgesetzt im Server-Betrieb (`deploy/`, Schritt 6a):
- Login-Codes nur per E-Mail (`DEV_LOGIN_CODES=false`), `/dev/*` aus (`DEV_ROUTES=false`)
- Bremsen gegen Missbrauch: pro E-Mail 1 Code / 60 s und 5 / Stunde (in der Datenbank → gilt auch
  bei mehreren Backend-Instanzen), pro IP Grenzen für Anfordern/Eingeben (`@fastify/rate-limit`,
  im Arbeitsspeicher → bei mehreren Instanzen auf Redis umstellen)
- MQTT: kein anonymer Zugriff, Benutzername = Stationscode, ACL erlaubt nur eigene Topics
- Datenbank und Backend nicht von außen erreichbar – nur über Caddy (später mit HTTPS)
- Stripe-Webhooks nur mit gültiger Signatur; Gutschrift trotzdem erst nach Rückfrage bei Stripe
- Container laufen nicht als root
- Admin nur mit echter Adresse (`ADMIN_EMAIL`); Warnung beim Start bei Platzhalter-Admins
- Simulator-Steuerung nur am eigenen Dock (sonst könnten Tester fremde Parkvorgänge beenden)
- Echte Besucher-IP hinter Cloudflare über `CF-Connecting-IP` (`CLIENT_IP_HEADER`) – sonst zählte
  die IP-Bremse alle Nutzer als einen
- Kontosperre nach 10 falschen Codes in 24 h (Rate-Chance ohne Sperre ~20 %/Jahr, mit < 0,4 %/Jahr);
  während der Sperre werden auch keine Codes mehr verschickt
- Admin-/Dev-Pfade auf der App-Adresse gesperrt (nur über die Access-geschützte Admin-Adresse)
- Content-Security-Policy (Dashboard: nur eigene Skripte), HSTS
- Alle Docker-Ports nur auf 127.0.0.1 (Docker umgeht ufw!); Entwicklungs-Backend standardmäßig nur
  lokal (`HOST`), fürs Handy bewusst `pnpm dev:api:lan`
- Nächtliche Datensicherung mit getesteter Wiederherstellung

Noch offen vor dem ersten echten Ständer:

- MQTT-Broker: kein anonymer Zugriff mehr; **jeder Ständer bekommt eigene Zugangsdaten oder ein
  Zertifikat** und darf nur seine eigenen Topics lesen/schreiben (ACL).
- Verbindungen nur verschlüsselt (TLS, Port 8883).
- Befehle wie "entriegeln" nur vom Backend – nie direkt aus der App an den Ständer.
- Rate-Limiting für `/auth/request-code` (sonst kann jemand fremde Postfächer mit Codes fluten).
- E-Mail-Versand für Login-Codes anbinden; `DEV_ROUTES` in Produktion immer `false`.
