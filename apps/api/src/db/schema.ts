/**
 * Datenmodell
 * ===========
 * Jede `pgTable` hier wird zu einer Tabelle in PostgreSQL.
 * Änderst du etwas, erzeugst du mit `pnpm db:generate` eine Migration
 * und spielst sie mit `pnpm db:migrate` in die Datenbank ein.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  customType,
  index,
  uniqueIndex,
  bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * PostGIS-Punkt im Koordinatensystem 4326 (= WGS84, dasselbe wie GPS).
 * Für Entfernungen in echten Metern wandeln wir ihn in Abfragen nach `::geography` um.
 */
const gpsPoint = customType<{ data: string }>({
  dataType: () => "geometry(point,4326)",
});

// ---------------------------------------------------------------------------
// Aufzählungen (feste Wertelisten)
// ---------------------------------------------------------------------------

/**
 * Geschäftlicher Status eines Docks – also "was darf die App damit tun?".
 * Das ist bewusst getrennt von dem, was die Hardware meldet (lockState, bikePresent).
 */
export const dockStatus = pgEnum("dock_status", [
  "available", // frei, kann gebucht werden
  "reserved", // jemand hat reserviert, Rad ist noch nicht drin
  "occupied", // Rad steht drin, Parkvorgang läuft
  "out_of_service", // defekt / Wartung
]);

/** Was das Schloss zuletzt gemeldet hat (kommt 1:1 aus dem Ständer-Protokoll) */
export const lockState = pgEnum("lock_state", ["locked", "unlocked", "jammed", "unknown"]);

export const sessionStatus = pgEnum("session_status", [
  "reserved", // Platz reserviert, Rad noch nicht eingestellt
  "active", // Rad eingeschlossen, Parkzeit läuft
  "completed", // Rad abgeholt, bezahlt
  "cancelled", // Reservierung abgebrochen / abgelaufen
]);

// ---------------------------------------------------------------------------
// Tabellen
// ---------------------------------------------------------------------------

/** Ein Standort mit einem Steuergerät und mehreren Stellplätzen (Docks) */
export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Kurzer, menschenlesbarer Code – auch die "Adresse" im MQTT-Protokoll, z. B. "BER-001" */
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    /** Breitengrad (Nord/Süd), z. B. 52.52 für Berlin */
    lat: doublePrecision("lat").notNull(),
    /** Längengrad (Ost/West), z. B. 13.40 für Berlin */
    lng: doublePrecision("lng").notNull(),
    /**
     * Geo-Punkt, den die Datenbank AUTOMATISCH aus lat/lng berechnet ("generated column").
     * Wir schreiben ihn nie selbst – er ist nur für schnelle Umkreissuchen da.
     */
    location: gpsPoint("location").generatedAlwaysAs(sql`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`),
    /** Preis pro angefangener Stunde in Cent (Ganzzahlen statt Kommazahlen → keine Rundungsfehler bei Geld) */
    pricePerHourCents: integer("price_per_hour_cents").notNull().default(50),
    currency: text("currency").notNull().default("EUR"),
    /** Ist das Steuergerät gerade per MQTT verbunden? */
    online: boolean("online").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    firmware: text("firmware"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stations_code_idx").on(t.code),
    // Räumlicher Index → "Ständer in meiner Nähe" bleibt auch bei 100.000 Ständern schnell
    index("stations_location_idx").using("gist", sql`(${t.location}::geography)`),
  ],
);

/** Ein einzelner Stellplatz an einer Station */
export const docks = pgTable(
  "docks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    /** Nummer am Ständer (1..n), steht auch physisch drauf */
    number: integer("number").notNull(),
    status: dockStatus("status").notNull().default("available"),
    // --- zuletzt von der Hardware gemeldet ---
    lockState: lockState("lock_state").notNull().default("unknown"),
    bikePresent: boolean("bike_present").notNull().default(false),
    fault: text("fault"),
    stateUpdatedAt: timestamp("state_updated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("docks_station_number_idx").on(t.stationId, t.number)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ein Parkvorgang: von der Reservierung bis zur Abholung */
export const parkingSessions = pgTable(
  "parking_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    dockId: uuid("dock_id")
      .notNull()
      .references(() => docks.id),
    status: sessionStatus("status").notNull().default("reserved"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("EUR"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_dock_idx").on(t.dockId)],
);

/**
 * Ereignis-Protokoll ("Event Log")
 * --------------------------------
 * JEDE wichtige Aktion wird hier als Zeile festgehalten: "Rad eingestellt",
 * "Station offline", "Parkvorgang beendet" … Nie ändern, nur anhängen.
 * Das ist die Grundlage für:
 *  - Fehlersuche ("was ist an Station X um 14:03 passiert?")
 *  - Statistiken für Betreiber / Städte
 *  - Gamification später (Punkte, Streaks, Abzeichen lassen sich rückwirkend berechnen!)
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(), // z. B. "station.online", "session.started"
    stationId: uuid("station_id"),
    dockId: uuid("dock_id"),
    userId: uuid("user_id"),
    sessionId: uuid("session_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_type_idx").on(t.type),
    index("events_user_idx").on(t.userId),
    index("events_created_idx").on(t.createdAt),
  ],
);
