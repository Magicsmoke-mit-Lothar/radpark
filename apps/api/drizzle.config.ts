import { defineConfig } from "drizzle-kit";
import { config } from "./src/config";

// drizzle-kit vergleicht src/db/schema.ts mit den bisherigen Migrationen
// und erzeugt daraus neue SQL-Migrationsdateien im Ordner ./drizzle
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: config.DATABASE_URL },
  // PostGIS bringt eigene Tabellen mit – die soll drizzle-kit ignorieren
  extensionsFilters: ["postgis"],
});
