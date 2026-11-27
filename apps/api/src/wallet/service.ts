/**
 * Guthaben: aufladen, abbuchen, Kontoauszug.
 *
 * Goldene Regel: Der Kontostand (users.balance_cents) wird NUR in derselben Transaktion
 * geändert, in der auch eine Zeile im Buchungsjournal (wallet_transactions) entsteht.
 * Eindeutige Indizes verhindern, dass eine Aufladung doppelt gutgeschrieben oder ein
 * Parkvorgang doppelt abgebucht wird – selbst wenn eine Bestätigung zweimal eintrifft.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { topups, users, walletTransactions } from "../db/schema";
import { AppError } from "../errors";
import { recordEvent } from "../events";
import type { PaymentProvider } from "./providers";

/** Erlaubte Aufladebeträge (Cent) – feste Stufen statt freier Eingabe */
export const TOPUP_OPTIONS = [500, 1000, 2000] as const;

const sign = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * Bucht einen Betrag auf das Guthaben (positiv = Gutschrift, negativ = Abbuchung)
 * und schreibt die Journal-Zeile. MUSS innerhalb einer Transaktion aufgerufen werden.
 */
export async function postWalletTransaction(
  tx: Executor,
  entry: {
    userId: string;
    type: "topup" | "parking" | "bonus" | "refund" | "adjustment";
    amountCents: number;
    topupId?: string;
    sessionId?: string;
    description: string;
  },
) {
  // "balance = balance + x" direkt in der Datenbank → auch bei gleichzeitigen Buchungen korrekt
  const [u] = await tx
    .update(users)
    .set({ balanceCents: sql`${users.balanceCents} + ${entry.amountCents}` })
    .where(eq(users.id, entry.userId))
    .returning({ balanceCents: users.balanceCents });
  await tx.insert(walletTransactions).values({ ...entry, balanceAfterCents: u!.balanceCents });
  return u!.balanceCents;
}

export class WalletService {
  constructor(
    private provider: PaymentProvider,
    private log: FastifyBaseLogger,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  async overview(userId: string) {
    const [u] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
    const transactions = await db
      .select({
        id: walletTransactions.id,
        type: walletTransactions.type,
        amountCents: walletTransactions.amountCents,
        balanceAfterCents: walletTransactions.balanceAfterCents,
        description: walletTransactions.description,
        createdAt: walletTransactions.createdAt,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(30);
    return { balanceCents: u?.balanceCents ?? 0, currency: "EUR", transactions };
  }

  /**
   * Aufladung starten. Liefert ggf. die Stripe-Bezahlseite, die die App öffnen soll.
   * @param returnBase Basis-URL dieses Backends (für Stripes Rückleitung)
   * @param appReturnUrl Adresse, unter der die App wieder geöffnet wird
   */
  async startTopup(userId: string, amountCents: number, returnBase: string, appReturnUrl: string) {
    if (!(TOPUP_OPTIONS as readonly number[]).includes(amountCents)) {
      throw new AppError(400, "INVALID_AMOUNT", `Erlaubt: ${TOPUP_OPTIONS.map((c) => sign(c) + " €").join(", ")}`);
    }
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const [topup] = await db
      .insert(topups)
      .values({ userId, amountCents, provider: this.provider.name })
      .returning({ id: topups.id });
    const topupId = topup!.id;

    const back = (result: string) =>
      `${returnBase}/wallet/return?topup=${topupId}&result=${result}&to=${encodeURIComponent(appReturnUrl)}`;

    let started;
    try {
      started = await this.provider.startTopup({
        topupId,
        amountCents,
        currency: "EUR",
        email: user!.email,
        successUrl: back("success"),
        cancelUrl: back("cancel"),
      });
    } catch (err) {
      this.log.error({ err }, "Zahlungsanbieter: Aufladung konnte nicht gestartet werden");
      await db.update(topups).set({ status: "failed", completedAt: new Date() }).where(eq(topups.id, topupId));
      throw new AppError(502, "PAYMENT_PROVIDER_ERROR", "Der Zahlungsanbieter ist gerade nicht erreichbar");
    }

    await db.update(topups).set({ providerRef: started.providerRef }).where(eq(topups.id, topupId));
    await recordEvent({ type: "wallet.topup_started", userId, payload: { topupId, amountCents, provider: this.provider.name } });

    if (started.paidImmediately) await this.creditTopup(topupId);
    const status = started.paidImmediately ? "succeeded" : "pending";
    return { topupId, status, checkoutUrl: started.checkoutUrl };
  }

  /** Nach der Rückkehr von der Bezahlseite: beim Anbieter nachfragen und ggf. gutschreiben */
  async confirmTopup(userId: string, topupId: string) {
    const [t] = await db
      .select()
      .from(topups)
      .where(and(eq(topups.id, topupId), eq(topups.userId, userId)));
    if (!t) throw new AppError(404, "TOPUP_NOT_FOUND", "Aufladung nicht gefunden");
    if (t.status === "pending" && t.providerRef) await this.syncTopup(t.id, t.providerRef);

    const [after] = await db.select({ status: topups.status }).from(topups).where(eq(topups.id, topupId));
    const [u] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
    return { status: after!.status, balanceCents: u!.balanceCents };
  }

  /**
   * Hintergrund-Job: offene Aufladungen beim Anbieter prüfen. Fängt Fälle ab, in denen
   * die App nach dem Bezahlen nicht zurückkam (Akku leer, App geschlossen …).
   * Später zusätzlich: Stripe-Webhooks (brauchen eine öffentliche Adresse → Schritt 6).
   */
  async reconcilePending() {
    const open = await db
      .select({ id: topups.id, providerRef: topups.providerRef, createdAt: topups.createdAt })
      .from(topups)
      .where(and(eq(topups.status, "pending"), lt(topups.createdAt, new Date(Date.now() - 15_000)), gt(topups.createdAt, new Date(Date.now() - 2 * 24 * 3600_000))));
    for (const t of open) {
      if (t.providerRef) await this.syncTopup(t.id, t.providerRef).catch((err) => this.log.warn({ err, topupId: t.id }, "Abgleich fehlgeschlagen"));
    }
  }

  private async syncTopup(topupId: string, providerRef: string) {
    const status = await this.provider.checkTopup(providerRef);
    if (status === "succeeded") return this.creditTopup(topupId);
    if (status === "failed" || status === "expired") {
      const [t] = await db
        .update(topups)
        .set({ status, completedAt: new Date() })
        .where(and(eq(topups.id, topupId), eq(topups.status, "pending")))
        .returning({ userId: topups.userId });
      if (t) await recordEvent({ type: "wallet.topup_failed", userId: t.userId, payload: { topupId, status } });
    }
  }

  /** Gutschrift – idempotent: egal wie oft aufgerufen, es wird genau EINMAL gutgeschrieben */
  private async creditTopup(topupId: string) {
    await db.transaction(async (tx) => {
      // Nur wer den Status von "pending" auf "succeeded" umstellt, darf gutschreiben
      const [t] = await tx
        .update(topups)
        .set({ status: "succeeded", completedAt: new Date() })
        .where(and(eq(topups.id, topupId), eq(topups.status, "pending")))
        .returning();
      if (!t) return; // schon erledigt
      const balance = await postWalletTransaction(tx, {
        userId: t.userId,
        type: "topup",
        amountCents: t.amountCents,
        topupId: t.id,
        description: `Aufladung ${sign(t.amountCents)} €${t.provider === "fake" ? " (Testgutschrift)" : " (Stripe-Testmodus)"}`,
      });
      await recordEvent({ type: "wallet.topup_succeeded", userId: t.userId, payload: { topupId, amountCents: t.amountCents, balanceCents: balance } }, tx);
      this.log.info({ topupId, amountCents: t.amountCents }, "💶 Guthaben aufgeladen");
    });
  }
}
