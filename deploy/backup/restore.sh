#!/bin/sh
# Spielt eine Sicherung zurück. ACHTUNG: ersetzt den aktuellen Datenbank-Inhalt!
#   pnpm stage:restore radpark-2026-11-28_0300.sql.gz
set -eu
f="/backups/${1:?Dateiname der Sicherung angeben, z. B. radpark-2026-11-28_0300.sql.gz}"
[ -f "$f" ] || { echo "❌ $f nicht gefunden. Vorhanden:"; ls -1 /backups; exit 1; }
gunzip -c "$f" | psql -q -v ON_ERROR_STOP=1 -h postgres -U radpark -d "${RESTORE_DB:-radpark}" >/dev/null
echo "✅ $1 zurückgespielt in Datenbank ${RESTORE_DB:-radpark}"
