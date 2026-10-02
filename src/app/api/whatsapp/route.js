// ---------- Divine : fichier entièrement nouveau (consentement WhatsApp) ----------
// L'étudiant connecté accepte ou refuse de recevoir des notifications WhatsApp.
//   POST { accepte: true | false }  → { whatsapp: { disponible, accepte } }
// Un refus n'est pas définitif : il peut changer d'avis depuis son profil.
import {
  HttpError,
  ok,
  preflight,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { setWhatsappConsent } from "../../../../lib/whatsapp.js";

const METHODS = "POST, OPTIONS";

export const POST = route(async (req) => {
  const { user } = await requireUser(req);
  rateLimit(`whatsapp-optin:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });

  const { accepte } = await readJson(req);
  if (typeof accepte !== "boolean") {
    throw new HttpError(400, "Réponse invalide.");
  }
  const whatsapp = await setWhatsappConsent(user.id, accepte);
  return ok(req, { whatsapp }, {}, METHODS);
}, METHODS);

export const OPTIONS = preflight(METHODS);
// ---------- Divine : fin ----------
