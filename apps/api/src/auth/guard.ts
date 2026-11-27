import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors";
import { userIdForToken } from "./service";

// TypeScript beibringen, dass jede Anfrage ein Feld `userId` haben kann
declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * "Türsteher": läuft vor jeder geschützten Route.
 * Ohne gültiges Token → 401, sonst steht danach die Nutzer-ID in `req.userId`.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const token = bearerToken(req);
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) throw new AppError(401, "UNAUTHORIZED", "Bitte einloggen (Header: Authorization: Bearer <token>)");
  req.userId = userId;
}

/** Für Routen hinter requireAuth: liefert die Nutzer-ID garantiert (kein null) */
export function currentUserId(req: FastifyRequest): string {
  if (!req.userId) throw new AppError(401, "UNAUTHORIZED", "Nicht eingeloggt");
  return req.userId;
}
