/**
 * Testdaten ("Seed") für die Entwicklung.
 * ACHTUNG: löscht vorher ALLE Daten (Stationen, Docks, Nutzer, Logins, Parkvorgänge, Events)!
 * Standorte einfach anpassen – z. B. auf deine Stadt.
 */
import { db, pool } from "./client";
import { authTokens, docks, events, loginCodes, parkingSessions, stations, users } from "./schema";

const demoStations = [
  { code: "BER-001", name: "Hauptbahnhof Nord", address: "Europaplatz 1, Berlin", lng: 13.3694, lat: 52.5256, dockCount: 8 },
  { code: "BER-002", name: "Alexanderplatz", address: "Alexanderplatz, Berlin", lng: 13.4132, lat: 52.5219, dockCount: 6 },
  { code: "BER-003", name: "Warschauer Straße", address: "Warschauer Str., Berlin", lng: 13.4495, lat: 52.5059, dockCount: 10 },
];

await db.transaction(async (tx) => {
  await tx.delete(events);
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

  await tx.insert(users).values([
    { email: "test@radpark.dev", displayName: "Testperson" },
    // Betreiber-Konto fürs Admin-Dashboard
    { email: "admin@radpark.dev", displayName: "Betreiber", role: "admin" },
  ]);
});

console.log(`✅ ${demoStations.length} Stationen, Testnutzer und Admin (admin@radpark.dev) angelegt`);
await pool.end();
