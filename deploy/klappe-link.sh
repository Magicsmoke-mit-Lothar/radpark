#!/bin/sh
# Gibt den Einrichtungs-Link für die Laptop-Klappe aus (pnpm stage:klappe-link).
# Der Link enthält das Passwort der Klappe HINTER dem "#" – dieser Teil wird nie an einen Server
# geschickt, die Klappen-Seite liest ihn nur im Browser und löscht ihn danach aus der Adresszeile.
set -e
cd "$(dirname "$0")"

wert() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'"; }

STATION=$(wert KLAPPE_STATION)
PASSWORT=$(wert KLAPPE_PASSWORD)
API_HOST=$(wert API_HOST)
HTTP_PORT=$(wert HTTP_PORT)

if [ -z "$STATION" ] || [ -z "$PASSWORT" ]; then
  echo "❌ In deploy/.env fehlen KLAPPE_STATION und/oder KLAPPE_PASSWORD (siehe deploy/.env.example)."
  exit 1
fi

echo ""
echo "Auf dem Klappen-Laptop im Browser öffnen:"
echo ""
if [ -n "$API_HOST" ]; then
  echo "  https://$API_HOST/klappe/#station=$STATION&pw=$PASSWORT"
  echo ""
  echo "Nur auf DIESEM Rechner (ohne Internet):"
fi
echo "  http://localhost:${HTTP_PORT:-8088}/klappe/#station=$STATION&pw=$PASSWORT"
echo ""
echo "⚠️  Der Link enthält das Passwort der Station $STATION – nicht öffentlich teilen."
echo "    Neues Passwort: KLAPPE_PASSWORD in deploy/.env ändern, dann pnpm stage:up"
echo ""
