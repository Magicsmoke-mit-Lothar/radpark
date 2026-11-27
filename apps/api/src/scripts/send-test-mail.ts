/**
 * Prüft die E-Mail-Einstellungen (SMTP_URL, MAIL_FROM) mit einer Test-Mail.
 *   pnpm mail:test deine@adresse.de
 */
import { config } from "../config";
import { mailEnabled, sendLoginCode } from "../mailer";

const to = process.argv[2];
if (!to?.includes("@")) {
  console.error("Bitte Empfänger angeben:  pnpm mail:test deine@adresse.de");
  process.exit(1);
}
if (!mailEnabled) {
  console.error("❌ SMTP_URL ist nicht gesetzt (apps/api/.env)");
  process.exit(1);
}
const host = new URL(config.SMTP_URL!).hostname;
console.log(`Sende Test-Mail über ${host} von "${config.MAIL_FROM}" an ${to} …`);
try {
  await sendLoginCode(to, "123456");
  console.log("✅ Verschickt! Schau in dein Postfach (auch im Spam-Ordner).");
  process.exit(0);
} catch (err) {
  console.error("❌ Fehlgeschlagen:", (err as Error).message);
  process.exit(1);
}
