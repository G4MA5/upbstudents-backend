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

/**
 * Vérifie le mot de passe nécessaire pour un ajout direct.
 */
export function checkUploadPassword(password) {
  const expected = process.env.DOCUMENT_UPLOAD_PASSWORD;

  if (!expected) {
    console.error("[document] DOCUMENT_UPLOAD_PASSWORD non défini");

    throw new HttpError(
      503,
      "L'ajout direct de documents est momentanément indisponible. Vous pouvez proposer votre document à la place.",
    );
  }

  const a = createHash("sha256")
    .update(String(password || ""))
    .digest();

  const b = createHash("sha256").update(expected).digest();

  if (!timingSafeEqual(a, b)) {
    throw new HttpError(403, "Le mot de passe contributeur est incorrect.", {
      field: "password",
    });
  }
}

/**
 * Lit et valide les métadonnées d'un document.
 *
 * Règle particulière :
 *
 * LIVRE :
 *   - filière obligatoire
 *   - type obligatoire
 *   - titre/matière obligatoire
 *
 * Les champs suivants sont ignorés pour un livre :
 *   - année
 *   - niveau
 *   - session
 *
 * AUTRES DOCUMENTS :
 *   - filière
 *   - type
 *   - année
 *   - niveau
 *   - matière
 *
 * MÉMOIRE :
 *   - auteur obligatoire en plus
 */
export function readMetadata(source) {
  const get = (k) => clean(source[k], 120);

  const meta = {
    filiere: get("filiere"),
    type: get("type"),
    annee: get("annee"),
    niveau: get("niveau"),
    matiere: get("matiere"),
    session: get("session"),
    auteur: get("auteur"),
    mention: get("mention"),
  };

  // --------------------------------------------------
  // Champs obligatoires communs
  // --------------------------------------------------

  requireFields({
    filiere: meta.filiere,
    type: meta.type,
    matiere: meta.matiere,
  });

  // --------------------------------------------------
  // Filière
  // --------------------------------------------------

  const filieres = meta.filiere.split(/,\s*/).filter(Boolean);

  if (!filieres.length) {
    throw new HttpError(400, "Veuillez choisir au moins une filière.");
  }

  for (const f of filieres) {
    requireOneOf(f, FILIERES, "Filière");
  }

  // --------------------------------------------------
  // Type
  // --------------------------------------------------

  requireOneOf(meta.type, TYPES, "Type de document");

  // --------------------------------------------------
  // LIVRE
  // --------------------------------------------------

  if (meta.type === "Livre") {
    /*
     * Pour un livre :
     *
     * filière  => obligatoire
     * type     => obligatoire
     * matière  => obligatoire = titre du livre
     *
     * Tout le reste est facultatif.
     */

    meta.annee = "";
    meta.niveau = "";
    meta.session = "";

    return meta;
  }

  // --------------------------------------------------
  // AUTRES DOCUMENTS
  // --------------------------------------------------

  requireFields({
    annee: meta.annee,
    niveau: meta.niveau,
  });

  // --------------------------------------------------
  // MÉMOIRE
  // --------------------------------------------------

  if (meta.type === "Mémoire") {
    requireFields({
      auteur: meta.auteur,
    });
  }

  // --------------------------------------------------
  // Niveau
  // --------------------------------------------------

  requireOneOf(meta.niveau, NIVEAUX, "Niveau");

  // --------------------------------------------------
  // Année
  // --------------------------------------------------

  validateYear(meta.annee);

  // --------------------------------------------------
  // Session
  // --------------------------------------------------

  // Les sessions concernent uniquement les examens.
  if (meta.type !== "Examen") {
    meta.session = "";
  } else if (meta.session) {
    requireOneOf(meta.session, SESSIONS, "Session");
  }

  return meta;
}

/**
 * Génère le nom de stockage du document.
 *
 * Pour un livre :
 * Livre_Filiere_Titre
 *
 * Pour les autres documents :
 * Type_Filiere_Matiere_Annee_Niveau_Session
 */
export function storageName(m) {
  if (m.type === "Livre") {
    return storageSafe(`${m.type}_${m.filiere}_${m.matiere}`);
  }

  return storageSafe(
    `${m.type}_${m.filiere}_${m.matiere}_${m.annee}_${m.niveau}_${m.session}`,
  );
}

/**
 * Vérifie qu'un document portant le même filename
 * n'existe pas déjà.
 */
export async function assertNotDuplicate(filename) {
  const { data, error } = await supabaseAdmin
    .from("document")
    .select("id")
    .eq("filename", filename)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    throw new HttpError(
      409,
      "Un document avec ces informations existe déjà. Vérifiez la matière, l'année ou la session.",
    );
  }
}

/**
 * Publie un document dans la table document.
 */
export async function publish(meta, filename, profile) {
  const { data, error } = await supabaseAdmin
    .from("document")
    .insert([
      {
        admis: profile.num_id,
        ...meta,
        filename,
      },
    ])
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      await assertNotDuplicate(filename);
    }

    throw error;
  }

  // Marque l'utilisateur comme contributeur.
  if (!profile.proprietaire) {
    const { error: flagError } = await supabaseAdmin
      .from("utilisateurs")
      .update({
        proprietaire: true,
      })
      .eq("num_id", profile.num_id);

    if (flagError) {
      console.error("[document] statut contributeur", flagError);
    }
  }

  // Génère l'URL publique du fichier.
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
    auteur: data.auteur || null,
    mention: data.mention || null,
    file_url: url.publicUrl,
    filePath: data.filename,
    created_at: data.created_at || null,
  };
}
