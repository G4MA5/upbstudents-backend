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
  }

  return ok(req, { message: SENT });
});

export const OPTIONS = preflight();
