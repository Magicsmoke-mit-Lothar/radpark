/**
 * Legt eine Station an – oder ändert Name, Ort und Anzahl Docks einer vorhandenen.
 * Löscht NICHTS (anders als der Seed): Nutzer, Guthaben und Parkvorgänge bleiben erhalten.
 *
 *   pnpm station:add CODE "Name" DOCKS BREITENGRAD LÄNGENGRAD ["Adresse"]
 *   pnpm station:add LAB-001 "Klappe (Laptop)" 1 52.5163 13.3777 "Pariser Platz, Berlin"
 *
 * Docks werden nur hinzugefügt, nie entfernt (an entfernten Docks könnten noch Räder stehen).
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { docks, stations } from "../db/schema";

const [code, name, dockArg, latArg, lngArg, address] = process.argv.slice(2);
const dockCount = Number(dockArg);
const lat = Number(latArg);
const lng = Number(lngArg);

if (
  !code ||
  !/^[A-Z0-9-]{2,20}$/.test(code) ||
  !name ||
  !Number.isInteger(dockCount) ||
  dockCount < 1 ||
  dockCount > 50 ||
  !(lat >= -90 && lat <= 90) ||
  !(lng >= -180 && lng <= 180)
) {
  console.error('Aufruf:  pnpm station:add CODE "Name" DOCKS BREITENGRAD LÄNGENGRAD ["Adresse"]');
  console.error('Beispiel: pnpm station:add LAB-001 "Klappe (Laptop)" 1 52.5163 13.3777 "Pariser Platz, Berlin"');
  console.error("CODE: Großbuchstaben, Ziffern und '-', z. B. LAB-001");
  process.exit(1);
}

const result = await db.transaction(async (tx) => {
  const [station] = await tx
    .insert(stations)
    .values({ code, name, lat, lng, address: address ?? null })
    .onConflictDoUpdate({ target: stations.code, set: { name, lat, lng, ...(address ? { address } : {}) } })
    .returning({ id: stations.id });

  const added = await tx
    .insert(docks)
    .values(Array.from({ length: dockCount }, (_, i) => ({ stationId: station!.id, number: i + 1 })))
    .onConflictDoNothing()
    .returning({ number: docks.number });

  const total = await tx.select({ number: docks.number }).from(docks).where(eq(docks.stationId, station!.id));
  return { added: added.length, total: total.length };
});

console.log(`✅ Station ${code} „${name}“ (${lat}, ${lng}): ${result.total} Dock(s), davon ${result.added} neu`);
if (result.total > dockCount) {
  console.log(`ℹ️  Es gibt mehr Docks (${result.total}) als angegeben – vorhandene Docks werden nie automatisch gelöscht.`);
}
await pool.end();
