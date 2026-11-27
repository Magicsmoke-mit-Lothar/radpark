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
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 Tage eingeloggt bleiben

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Schritt 1: Code erzeugen. Gibt den Klartext-Code zurück, damit er verschickt werden kann. */
export async function createLoginCode(rawEmail: string): Promise<string> {
  const email = normalizeEmail(rawEmail);
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

/** Findet den Nutzer zu einem Token (oder null, wenn ungültig/abgelaufen) */
export async function userIdForToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), gt(authTokens.expiresAt, new Date())));
  return row?.userId ?? null;
}

export async function revokeToken(token: string) {
  await db.delete(authTokens).where(eq(authTokens.tokenHash, sha256(token)));
}
