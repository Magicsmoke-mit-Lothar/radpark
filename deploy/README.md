# RadPark in Docker („Staging“)

Das komplette System so, wie es auf einem Server laufen würde – erst einmal auf deinem Rechner.
Es läuft **neben** der Entwicklungsumgebung (eigene Datenbank, eigene Ports).

```
Browser/App ─:8088─▶ Caddy ── /      → Admin-Dashboard
                          └─ /api/* → Backend ─▶ PostgreSQL (nicht von außen erreichbar)
                                         └──▶ Mailpit (Test-Postfach) :8025
Ständer/Sim ─:1884─▶ Mosquitto (Passwort + Rechte pro Ständer)
```

## Starten

```bash
cp deploy/.env.example deploy/.env     # einmalig: Passwörter + Stripe-TESTschlüssel eintragen
pnpm stage:up                          # bauen & starten (dauert beim ersten Mal ein paar Minuten)
pnpm stage:seed                        # Teststationen anlegen, ADMIN_EMAIL wird Admin (löscht Staging-Daten!)
```

| Adresse | Was |
|---|---|
| http://localhost:8088 | Admin-Dashboard (Login: deine Adresse aus `ADMIN_EMAIL`) |
| http://localhost:8088/api/health | Backend |
| http://localhost:8025 | **Mailpit** – hier landen alle Login-Codes (es wird nichts wirklich verschickt) |

Weitere Befehle: `pnpm stage:logs` (Protokolle), `pnpm stage:sim` (Simulator bedienen – lösen ohne
Beenden mit **Strg+P, dann Strg+Q**), `pnpm stage:down` (stoppen, Daten bleiben erhalten).

## Die App gegen Staging laufen lassen

```bash
EXPO_PUBLIC_API_URL=http://<IP-deines-Rechners>:8088/api pnpm dev:mobile
```

Der Login-Code steht dann **nicht** mehr in der App, sondern kommt per E-Mail → in Mailpit nachsehen.
Parken klappt mit den 🛠-Knöpfen (der Simulator läuft als eigener Container).

## Was ist anders als in der Entwicklung? (Sicherheit)

| | Entwicklung (`pnpm dev:api`) | Staging / Server |
|---|---|---|
| Login-Code | steht in der App | **nur per E-Mail** |
| `/dev/*` (Befehle ohne Login, Zeitreise) | an | **aus** |
| MQTT-Broker | ohne Passwort | **Passwort + Rechte pro Ständer** (`mosquitto/acl`) |
| Datenbank & Backend | direkt erreichbar | **nur intern**, von außen nur Caddy |
| Bezahlung | Testgutschrift oder Stripe-Test | Stripe-**Test**modus |
| Simulator-Knöpfe | an | an (`SIMULATOR_CONTROL`) – **nur am eigenen Dock** (Admins: alle) |
| Admin | admin@radpark.dev | **nur deine echte Adresse** (`ADMIN_EMAIL`) |
| IP-Bremse | Verbindungs-IP | hinter Cloudflare: `CLIENT_IP_HEADER=cf-connecting-ip` |

**MQTT-Rechte:** Jeder Ständer meldet sich mit seinem Stationscode als Benutzernamen an und darf nur
*seine eigenen* Topics benutzen – BER-001 kann sich nicht als BER-002 ausgeben. Im Testbetrieb haben
alle Ständer dasselbe Passwort; echte Ständer bekommen jeweils ein eigenes.

## Öffentlich erreichbar mit Cloudflare-Tunnel (auf diesem Rechner)

Kein offener Port am Router: `cloudflared` baut die Verbindung **von innen** zu Cloudflare auf.
Cloudflare übernimmt HTTPS. Voraussetzung: Die Domain (hier `botrics.de`) wird bei Cloudflare verwaltet.

```
App  ──https://api.botrics.de───┐
Web  ──https://admin.botrics.de─┴─▶ Cloudflare ══Tunnel══▶ cloudflared ─▶ Caddy (web:80) ─▶ Backend / Dashboard
```

**1. Tunnel anlegen** – https://one.dash.cloudflare.com → *Networks* → *Tunnels* → **Create a tunnel**
→ Typ **Cloudflared** → Name `radpark` → bei „Install and run a connector“ **Docker** wählen und aus dem
angezeigten Befehl den langen Wert nach `--token` kopieren.

**2. Token eintragen** in `deploy/.env` (niemals in Chats oder ins Git):
```
CLOUDFLARE_TUNNEL_TOKEN=eyJh…          # der kopierte Wert
COMPOSE_PROFILES=tunnel                # cloudflared-Container mitstarten
HTTP_BIND=127.0.0.1                    # lokalen Zugang auf diesen Rechner beschränken (empfohlen)
```
(`API_HOST`, `ADMIN_HOST` und `CLIENT_IP_HEADER=cf-connecting-ip` sind schon gesetzt.)

**3. Adressen zuordnen** – im Tunnel unter *Public Hostnames* / *Published application routes* zwei Einträge:

| Subdomain | Domain | Service-Typ | URL |
|---|---|---|---|
| `api` | `botrics.de` | HTTP | `web:80` |
| `admin` | `botrics.de` | HTTP | `web:80` |

**4. Starten:** `pnpm stage:up` → im Dashboard steht der Tunnel nach ein paar Sekunden auf **Healthy**.
Protokoll: `pnpm stage:tunnel-logs`. Test im Browser: https://api.botrics.de/health

**5. Admin-Dashboard zusätzlich schützen (dringend empfohlen, bevor du den Tunnel dauerhaft laufen lässt):** *Access* → *Applications* → **Add an
application** → *Self-hosted* → Domain `admin.botrics.de` → Policy **Allow**, *Include* → *Emails* →
deine Adresse. Dann sieht nur noch du überhaupt die Login-Seite. **`api.botrics.de` NICHT schützen** –
sonst kommt die App nicht mehr durch.

**6. Stripe-Webhook (optional, Testmodus):** Stripe-Dashboard → *Entwickler* → *Webhooks* →
Endpunkt `https://api.botrics.de/webhooks/stripe`, Ereignisse `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired` → das *Signing secret* (`whsec_…`)
in `STRIPE_WEBHOOK_SECRET` eintragen → `pnpm stage:up`.

**7. App gegen die öffentliche Adresse** – funktioniert jetzt auch über mobile Daten:
```bash
EXPO_PUBLIC_API_URL=https://api.botrics.de pnpm dev:mobile
```

> Dieser Rechner muss dafür laufen (kein Standby). Wird er ausgeschaltet, ist RadPark nicht erreichbar.
> Lokal sind Caddy (8088), MQTT (1884) und Mailpit (8025) **nur von diesem Rechner** aus erreichbar
> (`HTTP_BIND`/`MQTT_BIND=127.0.0.1`). Wichtig: Docker-Ports umgehen die Firewall (ufw) – deshalb
> diese Einschränkung direkt in der Konfiguration.

## Laptop-Klappe (zweites Gerät als Ständer)

Die Seite `…/klappe/` lässt einen Laptop im Browser einen Ständer spielen (Anleitung im
[Haupt-README](../README.md#laptop-als-klappe-ein-zweites-gerät-spielt-den-ständer)). Technisch:

- Caddy leitet `/mqtt` an den **WebSocket-Eingang** von Mosquitto weiter (Port 9001, nur im
  Docker-Netz). Von außen also nur verschlüsselt über Cloudflare: `wss://API_HOST/mqtt`.
- Die Klappe hat einen **eigenen MQTT-Zugang** (`KLAPPE_STATION` / `KLAPPE_PASSWORD` in `.env`) und
  darf wie jeder Ständer nur die eigenen Topics benutzen (ACL). Der Simulator lässt diese Station aus.
- Der Einrichtungs-Link (`pnpm stage:klappe-link`) trägt das Passwort hinter dem `#` – dieser Teil wird
  nie an einen Server geschickt; die Seite löscht ihn sofort aus der Adresszeile.
- Passwort wechseln: `KLAPPE_PASSWORD` ändern → `pnpm stage:up` → neuen Link auf dem Laptop öffnen.

## Datensicherung

Der Dienst `backup` sichert die Datenbank beim Start und jede Nacht um ca. 03:00 Uhr nach
`deploy/backups/` (14 Tage aufbewahrt, Dateien gehören dir, enthalten persönliche Daten → nie ins Git).

```bash
pnpm stage:backup                                   # sofort sichern
pnpm stage:restore radpark-2026-11-28_0300.sql.gz   # zurückspielen (ERSETZT die aktuellen Daten!)
```

Die Sicherungen liegen auf derselben Festplatte – gegen einen Festplattenausfall hilft nur,
sie regelmäßig woandershin zu kopieren (USB-Stick, Cloud-Speicher).

## Sicherheits-Übersicht

| Maßnahme | Wo |
|---|---|
| Login nur per E-Mail-Code; pro Adresse 1 Code/60 s, 5/Stunde; **Sperre nach 10 falschen Codes in 24 h** | Backend |
| IP-Bremsen für Code-Anforderung/-Eingabe (hinter Cloudflare mit echter Besucher-IP) | Backend |
| Admin nur echte Adresse (`ADMIN_EMAIL`); Admin-Funktionen **nur** über `admin.botrics.de` | Backend, Caddy |
| Cloudflare Access vor `admin.botrics.de` | Cloudflare (selbst einrichten) |
| Content-Security-Policy, HSTS, X-Frame-Options, nosniff | Caddy |
| MQTT mit Passwort + Rechten pro Ständer; Laptop-Klappe mit eigenem Passwort, nur über `wss://…/mqtt` | Mosquitto, Caddy |
| Datenbank/Backend/MQTT/Mailpit nicht von außen erreichbar | docker-compose |
| Nur Stripe-Testmodus; Webhooks nur mit Signatur | Backend |
| Nächtliche Datensicherung | `backup`-Dienst |

## Auf einen echten Server (Schritt 6b)

1. Server mieten (z. B. Hetzner, ~5 €/Monat), Docker installieren, Projekt hinkopieren.
2. Domain auf den Server zeigen lassen, in `deploy/.env`: `SITE_ADDRESS=radpark.deine-domain.de`,
   `HTTP_PORT=80` und in `docker-compose.yml` beim Dienst `web` zusätzlich `443:443` freigeben →
   Caddy holt sich **automatisch** ein HTTPS-Zertifikat.
3. Echten SMTP-Anbieter in `SMTP_URL` eintragen (Anleitung: „Login-E-Mails einrichten“ in der
   Haupt-README), testen mit `pnpm stage:mail-test deine@adresse.de`.
4. Im Stripe-Dashboard (Testmodus) einen Webhook auf `https://radpark.deine-domain.de/api/webhooks/stripe`
   anlegen (Ereignis `checkout.session.completed`) und das `whsec_…` in `STRIPE_WEBHOOK_SECRET` eintragen.
5. Firewall: nur 80, 443 und 1884 (MQTT für Ständer) öffnen.

> Noch offen für echten Betrieb: MQTT über TLS (verschlüsselt, Port 8883), eigene Passwörter pro
> Ständer, Backups der Datenbank. (Rate-Limiting für Login-Codes ist eingebaut.)
