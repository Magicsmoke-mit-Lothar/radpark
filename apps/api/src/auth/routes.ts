import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db/client";
import { users } from "../db/schema";
import { parseInput } from "../errors";
import { bearerToken, currentUserId, requireAuth } from "./guard";
import { createLoginCode, revokeToken, verifyLoginCode } from "./service";

// Leerzeichen & Großbuchstaben entfernen, BEVOR geprüft wird ("Anna@Test.de " → "anna@test.de")
const Email = z.string().trim().toLowerCase().pipe(z.email());
const RequestCodeBody = z.object({ email: Email });
const VerifyBody = z.object({ email: Email, code: z.string().trim().regex(/^\d{6}$/, "6 Ziffern") });

export async function authRoutes(app: FastifyInstance) {
  /** POST /auth/request-code {email} → schickt einen Login-Code */
  app.post("/auth/request-code", async (req) => {
    const { email } = parseInput(RequestCodeBody, req.body);
    const code = await createLoginCode(email);

    // TODO (Schritt 6): echten E-Mail-Versand anbinden (z. B. Postmark, Brevo, Amazon SES)
    if (config.DEV_ROUTES) {
      req.log.info(`📧 Login-Code für ${email}: ${code}`);
      return { sent: true, devCode: code }; // nur in der Entwicklung mitschicken!
    }
    req.log.warn("Kein E-Mail-Versand konfiguriert – Login-Code kann nicht zugestellt werden");
    return { sent: true };
  });

  /** POST /auth/verify {email, code} → {token, user} */
  app.post("/auth/verify", async (req) => {
    const { email, code } = parseInput(VerifyBody, req.body);
    const { token, user } = await verifyLoginCode(email, code);
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName } };
  });

  // Ab hier: nur mit gültigem Token
  app.register(async (authed) => {
    authed.addHook("preHandler", requireAuth);

    /** GET /me → wer bin ich? */
    authed.get("/me", async (req) => {
      const [user] = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, currentUserId(req)));
      return user;
    });

    /** POST /auth/logout → Token ungültig machen */
    authed.post("/auth/logout", async (req) => {
      await revokeToken(bearerToken(req)!);
      return { ok: true };
    });
  });
}
