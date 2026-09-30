// Favourite documents of the signed-in user, stored in Supabase so they
// follow the student from one device to another.
//   GET                          → { ids: number[] }
//   POST   { document_id }       → added
//   DELETE { document_id }       → removed
import {
  HttpError,
  ok,
  preflight,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { isMissingTable } from "../../../../lib/proposals.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";

const METHODS = "GET, POST, DELETE, OPTIONS";
const TABLE = "favori";

function unavailable(error) {
  if (isMissingTable(error)) {
    throw new HttpError(
      503,
      "Les favoris ne sont pas encore activés sur le serveur.",
      { code: "FAVORIS_INDISPONIBLES" },
    );
  }
  throw error;
}

async function documentId(req) {
  const { document_id } = await readJson(req);
  const id = Number(document_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Document invalide.");
  }
  return id;
}

export const GET = route(async (req) => {
  const { user } = await requireUser(req);
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("document_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) unavailable(error);
  return ok(req, { ids: data.map((r) => r.document_id) }, {}, METHODS);
}, METHODS);

export const POST = route(async (req) => {
  const { user } = await requireUser(req);
  const id = await documentId(req);
  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert([{ user_id: user.id, document_id: id }], {
      onConflict: "user_id,document_id",
      ignoreDuplicates: true,
    });
  if (error) {
    if (error.code === "23503") throw new HttpError(404, "Ce document n'existe plus.");
    unavailable(error);
  }
  return ok(req, { message: "Ajouté aux favoris." }, {}, METHODS);
}, METHODS);

export const DELETE = route(async (req) => {
  const { user } = await requireUser(req);
  const id = await documentId(req);
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("document_id", id);
  if (error) unavailable(error);
  return ok(req, { message: "Retiré des favoris." }, {}, METHODS);
}, METHODS);

export const OPTIONS = preflight(METHODS);
