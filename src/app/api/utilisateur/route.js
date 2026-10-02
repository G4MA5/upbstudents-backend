import {
  HttpError,
  loadProfile,
  ok,
  preflight,
  publicProfile,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import { FILIERES, NIVEAUX } from "../../../../lib/validation.js";

const METHODS = "GET, PATCH, OPTIONS";

export const GET = route(async (req) => {
  const { user } = await requireUser(req);
  const profile = await loadProfile(user);

  const { count } = await supabaseAdmin
    .from("document")
    .select("id", { count: "exact", head: true })
    .eq("admis", profile.num_id);

  return ok(
    req,
    {
      user: { id: user.id, email: user.email, created_at: user.created_at },
      profile: publicProfile(profile),
      contributions: count || 0,
      // Kept for older clients that read `utilisateur.proprietaire`.
      utilisateur: { proprietaire: Boolean(profile.proprietaire) },
    },
    {},
    METHODS,
  );
}, METHODS);

export const PATCH = route(async (req) => {
  const { user } = await requireUser(req);
  const body = await readJson(req);

  const filiere = String(body.filiere || "").trim();
  const niveau = String(body.niveau || "").trim();

  if (!filiere || !FILIERES.includes(filiere)) {
    throw new HttpError(400, "Filière invalide.");
  }
  if (!niveau || !NIVEAUX.includes(niveau)) {
    throw new HttpError(400, "Niveau invalide.");
  }

  const { error } = await supabaseAdmin
    .from("utilisateurs")
    .update({ filiere, niveau })
    .eq("user_id", user.id);

  if (error) throw error;

  const profile = await loadProfile(user);
  return ok(req, { profile: publicProfile(profile) }, {}, METHODS);
}, METHODS);

export const OPTIONS = preflight(METHODS);
