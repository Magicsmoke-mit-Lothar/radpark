/**
 * Simulator-Steuerung für eingeloggte Nutzer (nur wenn SIMULATOR_CONTROL=true).
 * Damit funktionieren die 🛠-Knöpfe der App auch auf einem Testserver bzw. in einer Test-APK.
 * Harmlos für echte Ständer: Die hören nie auf "sim/…" (und die MQTT-Rechte verbieten es ihnen).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SimAction } from "@radpark/protocol";
import { requireAuth } from "../auth/guard";
import { parseInput } from "../errors";
import type { MqttGateway } from "../mqtt/connection";

const Params = z.object({ code: z.string().regex(/^[A-Z0-9-]{2,20}$/), number: z.coerce.number().int().positive().max(200) });
const Body = z.object({ action: SimAction });

export async function simRoutes(app: FastifyInstance, opts: { mqtt: MqttGateway }) {
  app.addHook("preHandler", requireAuth);

  /** POST /sim/stations/BER-001/docks/3/action {"action":"park"|"take"} */
  app.post("/sim/stations/:code/docks/:number/action", async (req) => {
    const { code, number } = parseInput(Params, req.params);
    const { action } = parseInput(Body, req.body);
    await opts.mqtt.simulate(code, number, action);
    return { ok: true };
  });
}
