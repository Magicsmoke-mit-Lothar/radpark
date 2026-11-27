/**
 * E-Mail-Versand (für Login-Codes) über SMTP – funktioniert mit praktisch jedem Anbieter
 * (Brevo, Resend, Mailgun, Postmark, Amazon SES, …). Im Docker-Test fängt "Mailpit" alle
 * Mails ab, sodass nichts wirklich verschickt wird.
 */
import nodemailer from "nodemailer";
import { config } from "./config";

const transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;

export const mailEnabled = transport !== null;

export async function sendLoginCode(to: string, code: string) {
  if (!transport) throw new Error("Kein E-Mail-Versand konfiguriert (SMTP_URL fehlt)");
  await transport.sendMail({
    from: config.MAIL_FROM,
    to,
    subject: `Dein RadPark-Code: ${code}`,
    text: `Hallo!\n\nDein Anmeldecode für RadPark lautet:\n\n    ${code}\n\nEr ist 10 Minuten gültig. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail einfach.\n\nDein RadPark-Team`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px">
      <h2 style="margin:0 0 12px">🚲 RadPark</h2>
      <p>Dein Anmeldecode:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:8px 0">${code}</p>
      <p style="color:#64748b">Gültig für 10 Minuten. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail einfach.</p>
    </div>`,
  });
}
