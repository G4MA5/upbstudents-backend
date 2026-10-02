import { FRONTEND_URL } from "../../../../lib/config.js";
import {
  clientIp,
  HttpError,
  ok,
  preflight,
  readJson,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
// ---------- Divine : WhatsApp (imports) ----------
import { after } from "next/server";
import { notifyWhatsApp, profileByEmail } from "../../../../lib/whatsapp.js";
// ---------- Divine : fin ----------
import { createAnonClient } from "../../../../lib/supabaseClient.js";
import { isEmail, normalizeEmail } from "../../../../lib/validation.js";

const SENT =
  "Si un compte est associé à cette adresse, un lien de réinitialisation vient de vous être envoyé. Pensez à vérifier vos spams.";

export const POST = route(async (req) => {
  const { email: raw } = await readJson(req);
  const email = normalizeEmail(raw);

  if (!email) throw new HttpError(400, "Veuillez saisir votre adresse e-mail.");
  if (!isEmail(email)) throw new HttpError(400, "L'adresse e-mail n'est pas valide.");

  rateLimit(`forgot:${clientIp(req)}`, { limit: 5, windowMs: 15 * 60_000 });
  rateLimit(`forgot:${email}`, { limit: 3, windowMs: 15 * 60_000 });

  const client = createAnonClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${FRONTEND_URL}/mot-de-passe-oublie`,
  });

  if (error) {
    if (error.status === 429 || /rate limit/i.test(error.message || "")) {
      throw new HttpError(
        429,
        "Un e-mail vient déjà d'être envoyé. Veuillez patienter quelques minutes avant de réessayer.",
      );
    }
    // Unknown address and other errors get the same answer, so the endpoint
    // cannot be used to find out who has an account.
    console.error("[forgot]", error.message);
  } else {
    // ---------- Divine : début WhatsApp ----------
    // On envoie le message APRÈS avoir répondu au client (after).
    // Ainsi, le temps de réponse ne permet pas de deviner si le compte existe.
    after(async () => {
      // On cherche le numéro de téléphone du compte avec son e-mail.
      const profile = await profileByEmail(email);
      // Pas de compte, pas de numéro, ou WhatsApp non accepté : on n'envoie rien.
      if (!profile?.numero || profile.whatsapp_optin !== true) return;
      // La clé change toutes les 15 minutes : un seul message par fenêtre de 15 min.
      await notifyWhatsApp(
        "password_reset_requested",
        profile.numero,
        { prenom: profile.prenom, email },
        `reset:${email}:${Math.floor(Date.now() / (15 * 60_000))}`,
      );
    });
    // ---------- Divine : fin ----------
  }

  return ok(req, { message: SENT });
});

export const OPTIONS = preflight();
