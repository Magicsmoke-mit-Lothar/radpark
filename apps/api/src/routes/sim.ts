/**
 * Simulator-Steuerung für eingeloggte Nutzer (nur wenn SIMULATOR_CONTROL=true).
 * Damit funktionieren die 🛠-Knöpfe der App auch auf einem Testserver bzw. in einer Test-APK.
 * Harmlos für echte Ständer: Die hören nie auf "sim/…" (und die MQTT-Rechte verbieten es ihnen).
 *
 * Regel: Man darf nur das Dock steuern, an dem man SELBST gerade parkt (oder reserviert hat) –
 * sonst könnte ein Tester im Simulator das Rad eines anderen "herausnehmen".
 * Admins dürfen jedes Dock steuern (zum Testen).
 */
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { SimAction } from "@radpark/protocol";
import { currentUserId, requireAuth } from "../auth/guard";
import { db } from "../db/client";
import { docks, parkingSessions, stations } from "../db/schema";
import { AppError, parseInput } from "../errors";
import type { MqttGateway } from "../mqtt/connection";

const Params = z.object({ code: z.string().regex(/^[A-Z0-9-]{2,20}$/), number: z.coerce.number().int().positive().max(200) });
const Body = z.object({ action: SimAction });

export async function simRoutes(app: FastifyInstance, opts: { mqtt: MqttGateway }) {
  app.addHook("preHandler", requireAuth);

  /** POST /sim/stations/BER-001/docks/3/action {"action":"park"|"take"} */
  app.post("/sim/stations/:code/docks/:number/action", async (req) => {
    const { code, number } = parseInput(Params, req.params);
    const { action } = parseInput(Body, req.body);

    if (req.userRole !== "admin") {
      const [own] = await db
        .select({ id: parkingSessions.id })
        .from(parkingSessions)
        .innerJoin(docks, eq(docks.id, parkingSessions.dockId))
        .innerJoin(stations, eq(stations.id, docks.stationId))
        .where(
          and(
            eq(parkingSessions.userId, currentUserId(req)),
            inArray(parkingSessions.status, ["reserved", "active"]),
            eq(stations.code, code),
            eq(docks.number, number),
          ),
        );
      if (!own) throw new AppError(403, "NOT_YOUR_DOCK", "Du kannst nur das Dock steuern, an dem du selbst parkst");
    }

    await opts.mqtt.simulate(code, number, action);
    return { ok: true };
  });
}
