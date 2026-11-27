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
