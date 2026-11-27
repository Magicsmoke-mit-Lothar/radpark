// Spielt alle noch nicht angewendeten Migrationen aus ./drizzle in die Datenbank ein.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✅ Migrationen angewendet");
await pool.end();
