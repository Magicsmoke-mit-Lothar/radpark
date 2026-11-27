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

## Sicherheit (vor dem ersten echten Ständer!)

- MQTT-Broker: kein anonymer Zugriff mehr; **jeder Ständer bekommt eigene Zugangsdaten oder ein
  Zertifikat** und darf nur seine eigenen Topics lesen/schreiben (ACL).
- Verbindungen nur verschlüsselt (TLS, Port 8883).
- Befehle wie "entriegeln" nur vom Backend – nie direkt aus der App an den Ständer.
