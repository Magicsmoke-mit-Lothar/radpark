/**
 * Testdaten ("Seed") für die Entwicklung.
 * ACHTUNG: löscht vorher ALLE Daten (Stationen, Docks, Nutzer, Logins, Parkvorgänge, Events)!
 * Standorte einfach anpassen – z. B. auf deine Stadt.
 *
 * Admin-Konto:
 *  - SEED_ADMIN_EMAIL gesetzt → diese Adresse wird Admin (so auf dem Server: DEINE echte Adresse)
 *  - Entwicklungsmodus (Login-Code steht in der App) → zusätzlich admin@radpark.dev zum Ausprobieren
 *  - Server-Modus OHNE SEED_ADMIN_EMAIL → KEIN Admin (danach: pnpm admin:grant deine@adresse.de)
 * Warum? Eine erfundene Adresse wie admin@radpark.dev gehört niemandem – wer die Domain kauft,
 * bekäme die Login-Codes und wäre Admin. Auf einem öffentlichen Server also tabu.
 */
import { config } from "../config";
import { normalizeEmail } from "../auth/service";
import { db, pool } from "./client";
import { authTokens, docks, events, loginCodes, parkingSessions, stations, topups, users, walletTransactions } from "./schema";

const demoStations = [
  { code: "BER-001", name: "Hauptbahnhof Nord", address: "Europaplatz 1, Berlin", lng: 13.3694, lat: 52.5256, dockCount: 8 },
  { code: "BER-002", name: "Alexanderplatz", address: "Alexanderplatz, Berlin", lng: 13.4132, lat: 52.5219, dockCount: 6 },
  { code: "BER-003", name: "Warschauer Straße", address: "Warschauer Str., Berlin", lng: 13.4495, lat: 52.5059, dockCount: 10 },
];

const adminEmail = process.env.SEED_ADMIN_EMAIL ? normalizeEmail(process.env.SEED_ADMIN_EMAIL) : null;

await db.transaction(async (tx) => {
  await tx.delete(events);
  await tx.delete(walletTransactions);
  await tx.delete(topups);
  await tx.delete(authTokens);
  await tx.delete(loginCodes);
  await tx.delete(parkingSessions);
  await tx.delete(docks);
  await tx.delete(stations);
  await tx.delete(users);

  for (const s of demoStations) {
    const [station] = await tx
      .insert(stations)
      .values({ code: s.code, name: s.name, address: s.address, lat: s.lat, lng: s.lng })
      .returning({ id: stations.id });

    await tx.insert(docks).values(
      Array.from({ length: s.dockCount }, (_, i) => ({ stationId: station!.id, number: i + 1 })),
    );
  }

  if (config.DEV_LOGIN_CODES) {
    await tx.insert(users).values([
      { email: "test@radpark.dev", displayName: "Testperson" },
      // Betreiber-Konto zum Ausprobieren – NUR im Entwicklungsmodus (siehe Kommentar oben)
      { email: "admin@radpark.dev", displayName: "Betreiber", role: "admin" },
    ]);
  }
  if (adminEmail) {
    await tx
      .insert(users)
      .values({ email: adminEmail, displayName: "Betreiber", role: "admin" })
      .onConflictDoUpdate({ target: users.email, set: { role: "admin" } });
  }
});

const admins = [...(config.DEV_LOGIN_CODES ? ["admin@radpark.dev"] : []), ...(adminEmail ? [adminEmail] : [])];
console.log(`✅ ${demoStations.length} Stationen angelegt. Admin: ${admins.join(", ") || "KEINER – jetzt: pnpm admin:grant deine@adresse.de"}`);
await pool.end();
