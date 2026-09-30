import { DOCUMENTS_BUCKET } from "../../../../lib/config.js";
import {
  HttpError,
  loadProfile,
  ok,
  preflight,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";

const METHODS = "DELETE, OPTIONS";

export const DELETE = route(async (req) => {
  // Deletion used to be open to anyone: it now requires a signed-in
  // authorized contributor (same `proprietaire` flag the UI already used).
  const { user } = await requireUser(req);
  const profile = await loadProfile(user);
  if (!profile.proprietaire) {
    throw new HttpError(
      403,
      "Vous n'avez pas l'autorisation de supprimer des documents.",
    );
  }

  const { id } = await readJson(req);
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw new HttpError(400, "Document invalide.");
  }

  // The storage path is read from the database, never trusted from the
  // client, so no other file of the bucket can be targeted.
  const { data: doc, error: findError } = await supabaseAdmin
    .from("document")
    .select("id, filename")
    .eq("id", docId)
    .maybeSingle();
  if (findError) throw findError;
  if (!doc) throw new HttpError(404, "Ce document n'existe plus.");

  const { error: dbError } = await supabaseAdmin
    .from("document")
    .delete()
    .eq("id", docId);
  if (dbError) throw dbError;

  const { error: storageError } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .remove([doc.filename]);
  if (storageError) {
    // The record is gone, so the document is no longer listed; an orphan
    // file is harmless and only logged.
    console.error("[supprimer] fichier non supprimé", storageError);
  }

  return ok(req, { message: "Le document a été supprimé." }, {}, METHODS);
}, METHODS);

export const OPTIONS = preflight(METHODS);
