import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUserId, requireAuth } from "../auth/guard";
import { parseInput } from "../errors";
import type { ParkingService } from "./service";

const StartBody = z.object({
  stationId: z.uuid(),
  /** optional: bestimmtes Dock wählen, sonst nehmen wir das erste freie */
  dockNumber: z.number().int().positive().optional(),
});
const IdParams = z.object({ id: z.uuid() });

export async function parkingRoutes(app: FastifyInstance, opts: { parking: ParkingService }) {
  const { parking } = opts;
  app.addHook("preHandler", requireAuth); // alle Routen hier brauchen Login

  /** POST /parkings {stationId, dockNumber?} → Parken starten (Bügel öffnet) */
  app.post("/parkings", async (req, reply) => {
    const { stationId, dockNumber } = parseInput(StartBody, req.body);
    const session = await parking.start(currentUserId(req), stationId, dockNumber);
    return reply.code(201).send(session);
  });

  /** GET /parkings/current → laufender Parkvorgang (oder null) */
  app.get("/parkings/current", async (req) => {
    return { parking: await parking.current(currentUserId(req)) };
  });

  /** GET /parkings → Verlauf */
  app.get("/parkings", async (req) => parking.history(currentUserId(req)));

  /** POST /parkings/:id/pickup → Rad abholen (Bügel öffnet) */
  app.post("/parkings/:id/pickup", async (req) => {
    const { id } = parseInput(IdParams, req.params);
    return parking.requestPickup(currentUserId(req), id);
  });

  /** POST /parkings/:id/cancel → Reservierung abbrechen */
  app.post("/parkings/:id/cancel", async (req) => {
    const { id } = parseInput(IdParams, req.params);
    return parking.cancel(currentUserId(req), id);
  });
}
