#!/bin/sh
# Sichert die Datenbank einmal sofort und dann jede Nacht um ca. 03:00 Uhr.
# Sicherungen älter als BACKUP_KEEP_DAYS Tage werden gelöscht.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"

sichern() {
  ts=$(date +%Y-%m-%d_%H%M)
  tmp="/backups/.radpark-$ts.sql.gz.tmp"
  # --clean --if-exists: beim Zurückspielen werden vorhandene Tabellen ersetzt
  pg_dump --clean --if-exists --no-owner -h postgres -U radpark radpark | gzip > "$tmp"
  mv "$tmp" "/backups/radpark-$ts.sql.gz"
  chmod 600 "/backups/radpark-$ts.sql.gz"
  find /backups -name 'radpark-*.sql.gz' -mtime +"$KEEP" -delete
  echo "$(date '+%F %T') Sicherung erstellt: radpark-$ts.sql.gz ($(du -h "/backups/radpark-$ts.sql.gz" | cut -f1))"
}

if [ "${1:-}" = "jetzt" ]; then sichern; exit 0; fi

sichern
while true; do
  # bis 03:00 Uhr nächtlich schlafen
  jetzt=$(date +%s); ziel=$(date -d "tomorrow 03:00" +%s 2>/dev/null || echo $((jetzt + 86400)))
  sleep $((ziel - jetzt))
  sichern || echo "$(date '+%F %T') ⚠️ Sicherung FEHLGESCHLAGEN"
done
