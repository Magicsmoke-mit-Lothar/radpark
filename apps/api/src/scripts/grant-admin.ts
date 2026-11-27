/**
 * Macht einen Nutzer zum Admin (Betreiber).
 *   pnpm admin:grant chef@example.com
 * Gibt es den Nutzer noch nicht, wird er angelegt – er kann sich dann normal per E-Mail-Code einloggen.
 */
import { db, pool } from "../db/client";
import { users } from "../db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Bitte E-Mail angeben:  pnpm admin:grant chef@example.com");
  process.exit(1);
}

await db
  .insert(users)
  .values({ email, role: "admin" })
  .onConflictDoUpdate({ target: users.email, set: { role: "admin" } });

console.log(`✅ ${email} ist jetzt Admin`);
await pool.end();
