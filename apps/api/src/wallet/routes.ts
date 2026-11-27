import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUserId, requireAuth } from "../auth/guard";
import { config } from "../config";
import { AppError, parseInput } from "../errors";
import { TOPUP_OPTIONS, type WalletService } from "./service";

const TopupBody = z.object({
  amountCents: z.number().int(),
  /** Adresse, unter der die App nach dem Bezahlen wieder geöffnet wird (z. B. exp://… oder radpark://…) */
  returnUrl: z.string().max(500),
});
const IdParams = z.object({ id: z.uuid() });
const ReturnQuery = z.object({ topup: z.uuid(), result: z.enum(["success", "cancel"]), to: z.string().max(500).optional() });

/**
 * Nur in diese Ziele darf nach dem Bezahlen weitergeleitet werden – sonst könnte jemand unsere
 * Adresse missbrauchen, um Leute auf fremde Seiten umzuleiten ("Open Redirect").
 */
function isAllowedAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (["radpark:", "exp:", "exps:"].includes(u.protocol)) return true;
    // Browser-Vorschau während der Entwicklung
    return config.DEV_ROUTES && ["http:", "https:"].includes(u.protocol) && /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
  } catch {
    return false;
  }
}

export async function walletRoutes(app: FastifyInstance, opts: { wallet: WalletService }) {
  const { wallet } = opts;

  /**
   * GET /wallet/return – hierhin schickt Stripe den Browser nach dem Bezahlen.
   * Wir leiten weiter zurück in die App (ohne Login – Stripe kennt kein Token).
   * Gutgeschrieben wird hier NICHTS – das passiert erst nach Rückfrage bei Stripe.
   */
  app.get("/wallet/return", async (req, reply) => {
    const q = ReturnQuery.safeParse(req.query);
    if (q.success && q.data.to && isAllowedAppUrl(q.data.to)) {
      const target = new URL(q.data.to);
      target.searchParams.set("topup", q.data.topup);
      target.searchParams.set("result", q.data.result);
      return reply.redirect(target.toString());
    }
    return reply
      .type("text/html; charset=utf-8")
      .send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:2rem;text-align:center">
        <h1>${q.success && q.data.result === "success" ? "Zahlung abgeschlossen ✅" : "Zahlung abgebrochen"}</h1>
        <p>Du kannst jetzt zur RadPark-App zurückkehren.</p></body>`);
  });

  /**
   * POST /webhooks/stripe – Stripe meldet sich, sobald eine Zahlung eingegangen ist
   * (auch wenn die App nie zurückkommt). Braucht den UNVERÄNDERTEN Rohtext für die Signaturprüfung.
   */
  if (config.STRIPE_WEBHOOK_SECRET) {
    const secret = config.STRIPE_WEBHOOK_SECRET;
    app.register(async (hook) => {
      hook.removeContentTypeParser("application/json");
      hook.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
      hook.post("/webhooks/stripe", async (req) => {
        const signature = req.headers["stripe-signature"];
        if (typeof signature !== "string") throw new AppError(400, "MISSING_SIGNATURE", "Stripe-Signatur fehlt");
        await wallet.handleStripeWebhook(req.body as Buffer, signature, secret);
        return { received: true };
      });
    });
  }

  app.register(async (authed) => {
    authed.addHook("preHandler", requireAuth);

    /** GET /wallet → Guthaben, Kontoauszug und Aufladeoptionen */
    authed.get("/wallet", async (req) => ({
      ...(await wallet.overview(currentUserId(req))),
      topupOptions: TOPUP_OPTIONS,
      minStartBalanceCents: config.MIN_START_BALANCE_CENTS,
      provider: wallet.providerName,
      testMode: true, // Es gibt (bewusst) noch keinen Echtgeld-Modus
    }));

    /** POST /wallet/topups {amountCents, returnUrl} → {topupId, status, checkoutUrl} */
    authed.post("/wallet/topups", async (req, reply) => {
      const { amountCents, returnUrl } = parseInput(TopupBody, req.body);
      // Adresse dieses Backends so, wie der Client sie sieht (z. B. http://192.168.1.20:3000)
      // Hinter Caddy ist das Backend unter /api erreichbar – Caddy sagt uns das per X-Forwarded-Prefix
      const prefix = config.TRUST_PROXY ? String(req.headers["x-forwarded-prefix"] ?? "") : "";
      const returnBase = `${req.protocol}://${req.host}${prefix}`;
      const result = await wallet.startTopup(currentUserId(req), amountCents, returnBase, isAllowedAppUrl(returnUrl) ? returnUrl : "radpark://wallet");
      return reply.code(201).send(result);
    });

    /** POST /wallet/topups/:id/confirm → nach Rückkehr von Stripe: Status prüfen & gutschreiben */
    authed.post("/wallet/topups/:id/confirm", async (req) => {
      const { id } = parseInput(IdParams, req.params);
      return wallet.confirmTopup(currentUserId(req), id);
    });
  });
}
