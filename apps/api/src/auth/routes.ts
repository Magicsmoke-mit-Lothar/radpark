import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db/client";
import { users } from "../db/schema";
import { parseInput } from "../errors";
import { bearerToken, currentUserId, requireAuth } from "./guard";
import { AppError } from "../errors";
import { mailEnabled, sendLoginCode } from "../mailer";
import { createLoginCode, RESEND_COOLDOWN_SECONDS, revokeToken, verifyLoginCode } from "./service";

// Leerzeichen & Großbuchstaben entfernen, BEVOR geprüft wird ("Anna@Test.de " → "anna@test.de")
const Email = z.string().trim().toLowerCase().pipe(z.email());
const RequestCodeBody = z.object({ email: Email });
const VerifyBody = z.object({ email: Email, code: z.string().trim().regex(/^\d{6}$/, "6 Ziffern") });

export async function authRoutes(app: FastifyInstance) {
  /** POST /auth/request-code {email} → schickt einen Login-Code */
  // Pro IP-Adresse begrenzt (zusätzlich zur Bremse pro E-Mail-Adresse in service.ts)
  app.post("/auth/request-code", { config: { rateLimit: { max: config.LOGIN_CODE_REQUESTS_PER_HOUR, timeWindow: "1 hour" } } }, async (req) => {
    const { email } = parseInput(RequestCodeBody, req.body);
    const code = await createLoginCode(email);

    if (mailEnabled) {
      try {
        await sendLoginCode(email, code);
      } catch (err) {
        req.log.error({ err }, "Login-Code konnte nicht per E-Mail verschickt werden");
        throw new AppError(502, "MAIL_FAILED", "E-Mail konnte nicht verschickt werden");
      }
    }
    if (config.DEV_LOGIN_CODES) {
      req.log.info(`📧 Login-Code für ${email}: ${code}`);
      return { sent: true, resendAfterSeconds: RESEND_COOLDOWN_SECONDS, devCode: code }; // devCode nur in der Entwicklung!
    }
    if (!mailEnabled) req.log.warn("Kein E-Mail-Versand konfiguriert – Login-Code kann nicht zugestellt werden");
    return { sent: true, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
  });

  /** POST /auth/verify {email, code} → {token, user} */
  // Pro IP-Adresse begrenzt (gegen massenhaftes Durchprobieren von Codes)
  app.post("/auth/verify", { config: { rateLimit: { max: config.LOGIN_VERIFY_PER_15_MIN, timeWindow: "15 minutes" } } }, async (req) => {
    const { email, code } = parseInput(VerifyBody, req.body);
    const { token, user } = await verifyLoginCode(email, code);
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
  });

  // Ab hier: nur mit gültigem Token
  app.register(async (authed) => {
    authed.addHook("preHandler", requireAuth);

    /** GET /me → wer bin ich? */
    authed.get("/me", async (req) => {
      const [user] = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, createdAt: users.createdAt })
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
