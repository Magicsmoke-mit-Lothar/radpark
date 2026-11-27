/**
 * Login ohne Passwort:
 *  1. Nutzer gibt E-Mail ein → wir erzeugen einen 6-stelligen Code (10 Min. gültig) und schicken ihn per Mail
 *  2. Nutzer gibt den Code ein → wir legen (falls neu) das Konto an und geben ein Token heraus
 *  3. Die App schickt das Token bei jeder Anfrage mit: "Authorization: Bearer <token>"
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { authTokens, loginCodes, users } from "../db/schema";
import { AppError } from "../errors";
import { recordEvent } from "../events";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 Minuten
const MAX_ATTEMPTS = 5; // danach ist der Code verbrannt (Schutz gegen Durchprobieren)
export const RESEND_COOLDOWN_SECONDS = 60; // frühestens nach 60 s ein neuer Code für dieselbe Adresse
const MAX_CODES_PER_HOUR = 5; // pro E-Mail-Adresse
export const CODE_TTL_MINUTES = CODE_TTL_MS / 60_000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 Tage eingeloggt bleiben

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Schritt 1: Code erzeugen. Gibt den Klartext-Code zurück, damit er verschickt werden kann. */
export async function createLoginCode(rawEmail: string): Promise<string> {
  const email = normalizeEmail(rawEmail);

  // Bremse pro Adresse: niemand soll fremde Postfächer mit Codes fluten können
  const recent = await db
    .select({ createdAt: loginCodes.createdAt })
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, new Date(Date.now() - 3600_000))))
    .orderBy(desc(loginCodes.createdAt));
  const last = recent[0];
  if (last) {
    const wait = RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - last.createdAt.getTime()) / 1000);
    if (wait > 0) {
      throw new AppError(429, "TOO_MANY_REQUESTS", `Bitte warte ${wait} s, bevor du einen neuen Code anforderst`, { retryAfterSeconds: wait });
    }
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    const oldest = recent[recent.length - 1]!.createdAt.getTime();
    const wait = Math.ceil((oldest + 3600_000 - Date.now()) / 1000);
    throw new AppError(429, "TOO_MANY_REQUESTS", "Zu viele Codes angefordert – bitte später erneut versuchen", { retryAfterSeconds: wait });
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  await db.transaction(async (tx) => {
    // Ältere, noch offene Codes für diese E-Mail ungültig machen
    await tx
      .update(loginCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)));
    await tx.insert(loginCodes).values({
      email,
      codeHash: sha256(`${email}:${code}`),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  });

  return code;
}

/** Schritt 2: Code prüfen → Token ausgeben */
export async function verifyLoginCode(rawEmail: string, code: string) {
  const email = normalizeEmail(rawEmail);

  const [entry] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);

  const invalid = new AppError(401, "INVALID_CODE", "Code falsch oder abgelaufen");
  if (!entry) throw invalid;

  if (entry.codeHash !== sha256(`${email}:${code}`)) {
    const attempts = entry.attempts + 1;
    await db
      .update(loginCodes)
      .set({ attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) })
      .where(eq(loginCodes.id, entry.id));
    throw invalid;
  }

  return db.transaction(async (tx) => {
    await tx.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, entry.id));

    // Konto anlegen, falls es noch keins gibt
    let [user] = await tx.select().from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await tx.insert(users).values({ email }).returning();
      await recordEvent({ type: "user.registered", userId: user!.id }, tx);
    }
    await recordEvent({ type: "user.login", userId: user!.id }, tx);

    const token = randomBytes(32).toString("base64url");
    await tx.insert(authTokens).values({
      userId: user!.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    return { token, user: user! };
  });
}

/** Findet den Nutzer (ID + Rolle) zu einem Token – oder null, wenn ungültig/abgelaufen */
export async function userForToken(token: string): Promise<{ userId: string; role: "user" | "admin" } | null> {
  const [row] = await db
    .select({ userId: authTokens.userId, role: users.role })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(and(eq(authTokens.tokenHash, sha256(token)), gt(authTokens.expiresAt, new Date())));
  return row ?? null;
}

export async function revokeToken(token: string) {
  await db.delete(authTokens).where(eq(authTokens.tokenHash, sha256(token)));
}
