# Ständer-Protokoll v1 (MQTT)

Code: [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts)

Dieses Protokoll ist der **Vertrag** zwischen Backend und Fahrradständer. Der Simulator spricht es
heute, die ESP32-Firmware morgen. Alle Nachrichten sind JSON und enthalten `v` (Protokollversion)
und `ts` (Zeitstempel, ISO-8601).

## Begriffe

- **Station**: ein Standort mit *einem* Steuergerät, adressiert über ihren `code` (z. B. `BER-001`)
- **Dock**: ein Stellplatz an der Station, Nummer `1..n`, jeweils mit eigenem Schloss und Sensor

## Topics

| Topic | Richtung | Retained | Inhalt |
|---|---|---|---|
| `stations/{code}/status` | Ständer → Backend | ja | `{ v, ts, online, firmware?, dockCount? }` |
| `stations/{code}/docks/{n}/state` | Ständer → Backend | ja | `{ v, ts, lock: "locked"\|"unlocked"\|"jammed", bikePresent, fault? }` |
| `stations/{code}/cmd` | Backend → Ständer | nein | `{ v, ts, cmdId, type: "unlock"\|"lock"\|"identify", dock }` |
| `stations/{code}/cmd/ack` | Ständer → Backend | nein | `{ v, ts, cmdId, ok, error? }` |

**Retained** heißt: Der Broker merkt sich die letzte Nachricht. Startet das Backend neu, bekommt es
sofort den aktuellen Zustand aller Ständer – ohne nachfragen zu müssen.

## Online/Offline erkennen ("Last Will")

Beim Verbinden hinterlegt der Ständer beim Broker einen *letzten Willen*:
`stations/{code}/status` → `{ "online": false }` (retained).
Bricht die Verbindung ab (Strom weg, Funkloch), veröffentlicht der **Broker** diese Nachricht
automatisch. Nach dem Verbinden sendet der Ständer selbst `{ "online": true }`.

## Ablauf: Rad parken

```
App            Backend                     Ständer
 │ "parken an    │                            │
 │  Dock 3"      │                            │
 │──────────────▶│ cmd {unlock, dock 3}       │
 │               │───────────────────────────▶│  Bügel öffnet
 │               │◀─────────────────── ack ok │
 │               │◀── state {unlocked,        │
 │               │     bikePresent: false}    │
 │               │                            │  Nutzer stellt Rad ein,
 │               │                            │  Sensor erkennt Rad, Bügel schließt
 │               │◀── state {locked,          │
 │               │     bikePresent: true}     │
 │◀── "Parkzeit  │                            │
 │     läuft"    │                            │
```

Abholen funktioniert umgekehrt: `unlock` → Rad entnommen (`bikePresent: false`) → Parkvorgang
beendet, Preis berechnet.

## Regeln für Firmware und Simulator

1. Jeden Befehl mit einem `ack` beantworten, das die `cmdId` enthält – auch bei Fehlern (`ok: false`).
2. Nach **jeder** Zustandsänderung eines Docks den neuen Zustand senden (retained).
3. Unbekannte Felder ignorieren, unbekannte Befehle mit `ok: false, error: "UNKNOWN_COMMAND"` beantworten.
4. Breaking Changes → neue Protokollversion (`v: 2`), Backend unterstützt eine Übergangszeit beide.
