/**
 * Nimmt einem Nutzer die Admin-Rechte und meldet alle seine Geräte ab.
 *   pnpm admin:revoke admin@radpark.dev
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { authTokens, users } from "../db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email?.includes("@")) {
  console.error("Bitte E-Mail angeben:  pnpm admin:revoke name@example.com");
  process.exit(1);
}
const [u] = await db.update(users).set({ role: "user" }).where(eq(users.email, email)).returning({ id: users.id });
if (!u) {
  console.log(`ℹ️  ${email} gibt es nicht – nichts zu tun`);
} else {
  await db.delete(authTokens).where(eq(authTokens.userId, u.id));
  console.log(`✅ ${email} ist kein Admin mehr (und überall abgemeldet)`);
}
await pool.end();
