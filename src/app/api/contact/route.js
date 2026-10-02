import { adminEmail } from "../../../../lib/config.js";
import {
  clientIp,
  HttpError,
  ok,
  preflight,
  readJson,
  route,
} from "../../../../lib/http.js";
import { detailsTable, emailLayout, sendMail } from "../../../../lib/mailer.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
// ---------- Divine : WhatsApp (import) ----------
import { adminPhone, notifyWhatsApp } from "../../../../lib/whatsapp.js";
// ---------- Divine : fin ----------
import {
  clean,
  cleanMultiline,
  escapeHtml,
  isEmail,
  normalizeEmail,
  requireFields,
} from "../../../../lib/validation.js";

export const POST = route(async (req) => {
  const body = await readJson(req);

  // Honeypot field, invisible to humans: bots filling it get a silent success.
  if (body.website) return ok(req, { message: "Message envoyé." });

  const nom = clean(body.nom, 100);
  const email = normalizeEmail(body.email);
  const objet = clean(body.objet, 150);
  const message = cleanMultiline(body.message, 5000);

  requireFields({ nom, email, objet, message });
  if (!isEmail(email))
    throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  if (message.length < 10) {
    throw new HttpError(
      400,
      "Votre message est trop court (10 caractères minimum).",
    );
  }

  rateLimit(`contact:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60_000 });

  const to = adminEmail();
  if (!to) {
    console.error("[contact] ADMIN_EMAIL / EMAIL_RECEIVER non défini");
    throw new HttpError(
      503,
      "Le service de messagerie est momentanément indisponible. Veuillez réessayer plus tard.",
    );
  }

  await sendMail({
    to,
    replyTo: email,
    subject: `[Contact] ${objet}`,
    text: `De : ${nom} <${email}>\nObjet : ${objet}\n\n${message}`,
    html: emailLayout(
      "Nouveau message",
      `${detailsTable([
        ["Nom", nom],
        ["E-mail", email],
        ["Objet", objet],
      ])}<div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:12px;white-space:pre-wrap">${escapeHtml(message)}</div>`,
    ),
  });

  // ---------- Divine : début WhatsApp ----------
  // On envoie le même message à l'admin sur WhatsApp, juste après l'e-mail.
  // Si WhatsApp ne marche pas, rien ne casse : l'erreur est seulement écrite dans les logs.
  await notifyWhatsApp("contact_message", adminPhone(), {
    nom,
    email,
    objet,
    message,
  });
  // ---------- Divine : fin ----------

  return ok(req, {
    message:
      "Votre message a bien été envoyé. Nous vous répondrons dès que possible.",
  });
});

export const OPTIONS = preflight();
