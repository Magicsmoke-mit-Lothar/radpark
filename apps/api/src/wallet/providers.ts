/**
 * Zahlungsanbieter für Aufladungen – austauschbar hinter einer gemeinsamen Schnittstelle.
 *
 *  - StripeProvider: Stripe Checkout im TESTMODUS (Testkarte 4242 4242 4242 4242, kein Echtgeld)
 *  - FakeProvider:   sofortige Gutschrift ohne Zahlungsanbieter (nur Entwicklung)
 *
 * Der Rest des Systems kennt nur "PaymentProvider" – ein späterer Wechsel (PayPal, SEPA …)
 * betrifft nur diese Datei.
 */
import Stripe from "stripe";

export type ProviderStatus = "succeeded" | "pending" | "failed" | "expired";

export interface StartTopupInput {
  topupId: string;
  amountCents: number;
  currency: string;
  email: string;
  /** Wohin Stripe nach erfolgreicher bzw. abgebrochener Zahlung weiterleitet */
  successUrl: string;
  cancelUrl: string;
}

export interface StartTopupResult {
  /** Bezahlseite, die die App öffnen muss (null = keine nötig) */
  checkoutUrl: string | null;
  providerRef: string;
  /** true = schon bezahlt (nur FakeProvider) */
  paidImmediately: boolean;
}

export interface PaymentProvider {
  readonly name: "stripe" | "fake";
  startTopup(input: StartTopupInput): Promise<StartTopupResult>;
  /** Beim Anbieter nachfragen: Ist die Zahlung wirklich eingegangen? */
  checkTopup(providerRef: string): Promise<ProviderStatus>;
}

export class FakeProvider implements PaymentProvider {
  readonly name = "fake" as const;

  async startTopup(input: StartTopupInput): Promise<StartTopupResult> {
    return { checkoutUrl: null, providerRef: `fake_${input.topupId}`, paidImmediately: true };
  }

  async checkTopup(): Promise<ProviderStatus> {
    return "succeeded";
  }
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private stripe: Stripe;

  constructor(secretKey: string) {
    // Doppelte Absicherung zusätzlich zur Prüfung in config.ts: niemals Live-Schlüssel
    if (!/^(sk|rk)_test_/.test(secretKey)) throw new Error("Nur Stripe-Testschlüssel erlaubt");
    this.stripe = new Stripe(secretKey);
  }

  async startTopup(input: StartTopupInput): Promise<StartTopupResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name: "RadPark Guthaben", description: "Guthaben für smarte Fahrradständer" },
          },
        },
      ],
      customer_email: input.email,
      client_reference_id: input.topupId,
      metadata: { topupId: input.topupId },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: "de",
    });
    if (!session.url) throw new Error("Stripe hat keine Bezahlseite geliefert");
    return { checkoutUrl: session.url, providerRef: session.id, paidImmediately: false };
  }

  async checkTopup(providerRef: string): Promise<ProviderStatus> {
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    if (session.payment_status === "paid") return "succeeded";
    if (session.status === "expired") return "expired";
    return "pending";
  }
}
