/**
 * E-Mail-Versand (für Login-Codes) über SMTP – funktioniert mit praktisch jedem Anbieter
 * (Brevo, Gmail, Resend, Mailgun, Postmark, Amazon SES, …). Im Docker-Test fängt "Mailpit" alle
 * Mails ab, sodass nichts wirklich verschickt wird.
 *
 * SMTP_URL-Beispiele:
 *   smtp://benutzer:passwort@smtp-relay.brevo.com:587      (Port 587: verschlüsselt per STARTTLS)
 *   smtps://adresse%40gmail.com:app-passwort@smtp.gmail.com:465   (Port 465: direkt verschlüsselt;
 *                                                          @ im Benutzernamen als %40 schreiben!)
 */
import type { FastifyBaseLogger } from "fastify";
import nodemailer from "nodemailer";
import { CODE_TTL_MINUTES } from "./auth/service";
import { config } from "./config";

const transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;

export const mailEnabled = transport !== null;

/** Beim Start: Kommen wir beim E-Mail-Server an und stimmen Benutzername/Passwort? */
export function verifyMailTransport(log: FastifyBaseLogger) {
  if (!transport) return;
  const host = new URL(config.SMTP_URL!).hostname;
  transport
    .verify()
    .then(() => log.info({ host }, "📧 E-Mail-Versand bereit"))
    .catch((err: Error) => log.error({ host, err: err.message }, "📧 E-Mail-Server nicht erreichbar oder Zugangsdaten falsch – Login-Codes können nicht verschickt werden!"));
}

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!transport) throw new Error("Kein E-Mail-Versand konfiguriert (SMTP_URL fehlt)");
  await transport.sendMail({ from: config.MAIL_FROM, to, subject, text, html });
}

export async function sendLoginCode(to: string, code: string) {
  await sendMail(
    to,
    `${code} ist dein RadPark-Code`,
    [
      "Hallo!",
      "",
      "Dein Anmeldecode für RadPark lautet:",
      "",
      `    ${code}`,
      "",
      `Er ist ${CODE_TTL_MINUTES} Minuten gültig.`,
      "Wenn du dich nicht anmelden wolltest, kannst du diese E-Mail einfach ignorieren.",
      "",
      "Dein RadPark-Team",
    ].join("\n"),
    `<!doctype html><html lang="de"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e3e8ee">
    <div style="font-size:20px;font-weight:800;margin-bottom:16px">🚲 RadPark</div>
    <p style="margin:0 0 8px">Dein Anmeldecode:</p>
    <div style="font-size:36px;font-weight:800;letter-spacing:10px;padding:14px 0;color:#0f9d58">${code}</div>
    <p style="margin:12px 0 0;color:#64748b;font-size:14px">Gültig für ${CODE_TTL_MINUTES} Minuten. Wenn du dich nicht anmelden wolltest, kannst du diese E-Mail einfach ignorieren.</p>
  </div>
</body></html>`,
  );
}
