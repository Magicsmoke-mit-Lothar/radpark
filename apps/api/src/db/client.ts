import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

// Ein "Pool" hält mehrere offene Verbindungen zur Datenbank bereit,
// damit nicht jede Anfrage neu verbinden muss.
export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });
export type Db = typeof db;
