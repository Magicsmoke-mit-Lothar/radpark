import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { docks, stations } from "../db/schema";

const NearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** Suchradius in Metern */
  radius: z.coerce.number().positive().max(50_000).default(2_000),
});

const IdParams = z.object({ id: z.uuid() });

/** Gemeinsame Felder, die die App über eine Station sieht */
const stationFields = {
  id: stations.id,
  code: stations.code,
  name: stations.name,
  address: stations.address,
  lat: stations.lat,
  lng: stations.lng,
  pricePerHourCents: stations.pricePerHourCents,
  currency: stations.currency,
  online: stations.online,
};

export async function stationRoutes(app: FastifyInstance) {
  /**
   * GET /stations                      → alle Stationen
   * GET /stations?lat=..&lng=..&radius=  → nur Stationen im Umkreis, nach Entfernung sortiert
   */
  app.get("/stations", async (req, reply) => {
    const parsed = NearbyQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    const { lat, lng, radius } = parsed.data;

    const freeDocks = sql<number>`count(${docks.id}) filter (where ${docks.status} = 'available')`.mapWith(Number);
    const totalDocks = sql<number>`count(${docks.id})`.mapWith(Number);

    if (lat === undefined || lng === undefined) {
      const rows = await db
        .select({ ...stationFields, freeDocks, totalDocks })
        .from(stations)
        .leftJoin(docks, eq(docks.stationId, stations.id))
        .groupBy(stations.id)
        .orderBy(asc(stations.code));
      return rows;
    }

    // PostGIS: "geography" rechnet echte Meter auf der Erdkugel (nutzt den räumlichen Index aus schema.ts)
    const here = sql`ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography`;
    const stationGeo = sql`(${stations.location}::geography)`;
    const rows = await db
      .select({
        ...stationFields,
        freeDocks,
        totalDocks,
        distanceM: sql<number>`round(ST_Distance(${stationGeo}, ${here}))`.mapWith(Number),
      })
      .from(stations)
      .leftJoin(docks, eq(docks.stationId, stations.id))
      .where(sql`ST_DWithin(${stationGeo}, ${here}, ${radius}::double precision)`)
      .groupBy(stations.id)
      .orderBy(sql`ST_Distance(${stationGeo}, ${here})`);
    return rows;
  });

  /** GET /stations/:id → eine Station mit allen Docks */
  app.get("/stations/:id", async (req, reply) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "Ungültige Stations-ID" });

    const [station] = await db
      .select({ ...stationFields, lastSeenAt: stations.lastSeenAt })
      .from(stations)
      .where(eq(stations.id, parsed.data.id));
    if (!station) return reply.code(404).send({ error: "Station nicht gefunden" });

    const stationDocks = await db
      .select({
        number: docks.number,
        status: docks.status,
        lockState: docks.lockState,
        bikePresent: docks.bikePresent,
      })
      .from(docks)
      .where(eq(docks.stationId, station.id))
      .orderBy(asc(docks.number));

    return { ...station, docks: stationDocks };
  });
}
