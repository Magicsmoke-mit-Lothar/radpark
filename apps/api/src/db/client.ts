import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

// Ein "Pool" hält mehrere offene Verbindungen zur Datenbank bereit,
// damit nicht jede Anfrage neu verbinden muss.
export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });
export type Db = typeof db;

/**
 * "Irgendwas, womit man Abfragen ausführen kann": die normale Datenbank ODER eine laufende
 * Transaktion. So können Hilfsfunktionen (z. B. recordEvent) in beiden Fällen benutzt werden.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
