import {
  loadProfile,
  ok,
  preflight,
  publicProfile,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
// ---------- Divine : consentement WhatsApp ----------
import { getWhatsappConsent } from "../../../../lib/whatsapp.js";
// ---------- Divine : fin ----------

const METHODS = "GET, OPTIONS";

export const GET = route(async (req) => {
  const { user } = await requireUser(req);
  const profile = await loadProfile(user);

  const { count } = await supabaseAdmin
    .from("document")
    .select("id", { count: "exact", head: true })
    .eq("admis", profile.num_id);

  // ---------- Divine : consentement WhatsApp (jamais bloquant pour le profil) ----------
  const whatsapp = await getWhatsappConsent(user.id).catch(() => ({ disponible: false, accepte: null }));
  // ---------- Divine : fin ----------

  return ok(
    req,
    {
      user: { id: user.id, email: user.email, created_at: user.created_at },
      profile: publicProfile(profile),
      contributions: count || 0,
      // Divine : { disponible, accepte } — accepte vaut null tant que l'étudiant n'a pas répondu
      whatsapp,
      // Kept for older clients that read `utilisateur.proprietaire`.
      utilisateur: { proprietaire: Boolean(profile.proprietaire) },
    },
    {},
    METHODS,
  );
}, METHODS);

export const OPTIONS = preflight(METHODS);
