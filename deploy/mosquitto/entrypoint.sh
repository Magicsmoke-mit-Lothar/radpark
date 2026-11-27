#!/bin/sh
# Erzeugt beim Start die Passwort-Datei aus Umgebungsvariablen (die Passwörter stehen in deploy/.env,
# NICHT im Git). Danach startet ganz normal Mosquitto.
set -e

PW=/mosquitto/data/passwd
rm -f "$PW"
mosquitto_passwd -b -c "$PW" api "$MQTT_API_PASSWORD"

# Ein Zugang pro Station (Benutzername = Stationscode).
# TESTBETRIEB: alle mit demselben Passwort. Für echte Ständer bekommt JEDER ein eigenes!
for code in $(echo "$MQTT_STATIONS" | tr ',' ' '); do
  mosquitto_passwd -b "$PW" "$code" "$MQTT_STATION_PASSWORD"
done

chown mosquitto:mosquitto "$PW"
chmod 0700 "$PW"
echo "MQTT-Zugänge angelegt: api + $(echo "$MQTT_STATIONS" | tr ',' ' ')"

exec /docker-entrypoint.sh mosquitto -c /mosquitto/config/mosquitto.conf
