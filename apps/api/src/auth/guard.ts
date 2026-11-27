import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors";
import { userForToken } from "./service";

// TypeScript beibringen, dass jede Anfrage die Felder `userId` und `userRole` haben kann
declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
    userRole: "user" | "admin" | null;
  }
}

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * "Türsteher": läuft vor jeder geschützten Route.
 * Ohne gültiges Token → 401, sonst stehen danach Nutzer-ID und Rolle in `req`.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const token = bearerToken(req);
  const user = token ? await userForToken(token) : null;
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Bitte einloggen (Header: Authorization: Bearer <token>)");
  req.userId = user.userId;
  req.userRole = user.role;
}

/** Strengerer Türsteher fürs Admin-Dashboard: eingeloggt UND Rolle "admin" */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (req.userRole !== "admin") throw new AppError(403, "FORBIDDEN", "Nur für Betreiber (Admin-Rolle nötig)");
}

/** Für Routen hinter requireAuth: liefert die Nutzer-ID garantiert (kein null) */
export function currentUserId(req: FastifyRequest): string {
  if (!req.userId) throw new AppError(401, "UNAUTHORIZED", "Nicht eingeloggt");
  return req.userId;
}
