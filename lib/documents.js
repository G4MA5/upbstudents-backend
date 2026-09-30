// Publication helpers shared by direct uploads and proposal review.
import { createHash, timingSafeEqual } from "node:crypto";
import { DOCUMENTS_BUCKET } from "./config.js";
import { HttpError } from "./http.js";
import { supabaseAdmin } from "./supabaseClient.js";
import {
  clean,
  FILIERES,
  NIVEAUX,
  requireFields,
  requireOneOf,
  SESSIONS,
  storageSafe,
  TYPES,
  validateYear,
} from "./validation.js";

export function checkUploadPassword(password) {
  const expected = process.env.DOCUMENT_UPLOAD_PASSWORD;
  if (!expected) {
    console.error("[document] DOCUMENT_UPLOAD_PASSWORD non défini");
    throw new HttpError(
      503,
      "L'ajout direct de documents est momentanément indisponible. Vous pouvez proposer votre document à la place.",
    );
  }
  const a = createHash("sha256").update(String(password || "")).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    throw new HttpError(403, "Le mot de passe contributeur est incorrect.", {
      field: "password",
    });
  }
}

export function readMetadata(source) {
  const get = (k) => clean(source[k], 120);
  const meta = {
    filiere: get("filiere"),
    type: get("type"),
    annee: get("annee"),
    niveau: get("niveau"),
    matiere: get("matiere"),
    session: get("session"),
  };
  requireFields({
    filiere: meta.filiere,
    type: meta.type,
    annee: meta.annee,
    niveau: meta.niveau,
    matiere: meta.matiere,
  });
  requireOneOf(meta.filiere, FILIERES, "Filière");
  requireOneOf(meta.type, TYPES, "Type de document");
  requireOneOf(meta.niveau, NIVEAUX, "Niveau");
  validateYear(meta.annee);
  // Sessions only apply to exams (the form disables it for TD/TP).
  if (meta.type !== "Examen") meta.session = "";
  else if (meta.session) requireOneOf(meta.session, SESSIONS, "Session");
  return meta;
}

/** Same naming scheme as before, made safe for storage keys. */
export function storageName(m) {
  return storageSafe(
    `${m.type}_${m.filiere}_${m.matiere}_${m.annee}_${m.niveau}_${m.session}`,
  );
}

export async function assertNotDuplicate(filename) {
  const { data, error } = await supabaseAdmin
    .from("document")
    .select("id")
    .eq("filename", filename)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    throw new HttpError(
      409,
      "Un document avec ces informations existe déjà. Vérifiez la matière, l'année ou la session.",
    );
  }
}

export async function publish(meta, filename, profile) {
  const { data, error } = await supabaseAdmin
    .from("document")
    .insert([{ admis: profile.num_id, ...meta, filename }])
    .select()
    .single();
  if (error) {
    if (error.code === "23505") await assertNotDuplicate(filename);
    throw error;
  }

  if (!profile.proprietaire) {
    const { error: flagError } = await supabaseAdmin
      .from("utilisateurs")
      .update({ proprietaire: true })
      .eq("num_id", profile.num_id);
    if (flagError) console.error("[document] statut contributeur", flagError);
  }

  const { data: url } = supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .getPublicUrl(filename);

  return {
    id: data.id,
    title: data.matiere,
    filiere: data.filiere,
    annee: data.annee,
    licence: data.niveau,
    niveau: data.niveau,
    session: data.session,
    type: data.type,
    file_url: url.publicUrl,
    filePath: data.filename,
    created_at: data.created_at || null,
  };
}
