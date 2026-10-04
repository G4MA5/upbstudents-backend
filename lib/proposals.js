// Shared logic for public document proposals (pending review).

import { createHmac, timingSafeEqual } from "node:crypto";

import { PROPOSALS_BUCKET } from "./config.js";
import { HttpError } from "./http.js";
import { supabaseAdmin } from "./supabaseClient.js";

import {
  clean,
  cleanMultiline,
  FILIERES,
  isEmail,
  NIVEAUX,
  normalizeEmail,
  requireFields,
  requireOneOf,
  SESSIONS,
  TYPES,
  validateYear,
} from "./validation.js";

export const PROPOSALS_TABLE = "proposition";

let bucketReady = false;

/**
 * Crée le bucket privé des propositions lors
 * de la première utilisation.
 */
export async function ensureProposalsBucket() {
  if (bucketReady) return;

  const { data } = await supabaseAdmin.storage.getBucket(PROPOSALS_BUCKET);

  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(
      PROPOSALS_BUCKET,
      {
        public: false,
      },
    );

    if (error && !/already exists/i.test(error.message || "")) {
      throw error;
    }
  }

  bucketReady = true;
}

/**
 * Récupère le secret utilisé pour signer les tickets.
 */
function secret() {
  return (
    process.env.PROPOSAL_SECRET ||
    `proposal:${process.env.supabase_service_role_key || ""}`
  );
}

/**
 * Signe le chemin du fichier.
 *
 * Cela empêche de réutiliser un ticket
 * sur un autre fichier.
 */
export function signTicket(path, email, expires) {
  return createHmac("sha256", secret())
    .update(`${path}|${email}|${expires}`)
    .digest("hex");
}

/**
 * Vérifie qu'un ticket est valide.
 */
export function checkTicket({ path, email, expires, ticket }) {
  if (!path || !ticket || !expires || Date.now() > Number(expires)) {
    throw new HttpError(
      400,
      "La session d'envoi a expiré. Veuillez recommencer.",
    );
  }

  const expected = Buffer.from(signTicket(path, email, expires));

  const received = Buffer.from(String(ticket));

  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new HttpError(400, "Requête invalide.");
  }
}

/**
 * Lit et valide les informations d'une proposition.
 *
 * LIVRE :
 *   - nom obligatoire
 *   - email obligatoire
 *   - filière obligatoire
 *   - type obligatoire
 *   - titre/matière obligatoire
 *
 * Pour un livre :
 *   - année facultative
 *   - niveau facultatif
 *   - session ignorée
 *   - auteur facultatif
 *   - mention facultative
 *   - description facultative
 *
 * AUTRES DOCUMENTS :
 *   - filière obligatoire
 *   - type obligatoire
 *   - matière obligatoire
 *   - année obligatoire
 *   - niveau obligatoire
 *
 * MÉMOIRE :
 *   - auteur obligatoire
 */
export function readProposal(body) {
  const p = {
    nom: clean(body.nom, 100),
    email: normalizeEmail(body.email),
    filiere: clean(body.filiere, 30),
    niveau: clean(body.niveau, 30),
    type: clean(body.type, 30),
    matiere: clean(body.matiere, 120),
    annee: clean(body.annee, 4),
    session: clean(body.session, 30),
    auteur: clean(body.auteur, 120),
    mention: clean(body.mention, 50),
    description: cleanMultiline(body.description, 1000),
  };

  // --------------------------------------------------
  // Champs obligatoires communs
  // --------------------------------------------------

  requireFields({
    nom: p.nom,
    email: p.email,
    filiere: p.filiere,
    type: p.type,
    matiere: p.matiere,

    // Pour un Livre, l'année n'est pas obligatoire.
    annee: p.type === "Livre" ? undefined : p.annee,

    // Pour un Livre, le niveau n'est pas obligatoire.
    niveau: p.type === "Livre" ? undefined : p.niveau,
  });

  // --------------------------------------------------
  // Email
  // --------------------------------------------------

  if (!isEmail(p.email)) {
    throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  }

  // --------------------------------------------------
  // Filières
  // --------------------------------------------------

  const filieres = p.filiere.split(/,\s*/).filter(Boolean);

  if (!filieres.length) {
    throw new HttpError(400, "Veuillez choisir au moins une filière.");
  }

  for (const f of filieres) {
    requireOneOf(f, FILIERES, "Filière");
  }

  // --------------------------------------------------
  // Type
  // --------------------------------------------------

  requireOneOf(p.type, TYPES, "Type de document");

  // --------------------------------------------------
  // LIVRE
  // --------------------------------------------------

  if (p.type === "Livre") {
    /*
     * Un livre n'a pas besoin :
     * - d'année
     * - de niveau
     * - de session
     *
     * On les vide volontairement pour
     * garder des données cohérentes en base.
     */

    p.annee = "";
    p.niveau = "";
    p.session = "";

    return p;
  }

  // --------------------------------------------------
  // MÉMOIRE
  // --------------------------------------------------

  if (p.type === "Mémoire") {
    requireFields({
      auteur: p.auteur,
    });
  }

  // --------------------------------------------------
  // NIVEAU
  // --------------------------------------------------

  requireOneOf(p.niveau, NIVEAUX, "Niveau");

  // --------------------------------------------------
  // ANNÉE
  // --------------------------------------------------

  validateYear(p.annee);

  // --------------------------------------------------
  // SESSION
  // --------------------------------------------------

  // Les sessions ne concernent que les examens.
  if (p.type !== "Examen") {
    p.session = "";
  } else if (p.session) {
    requireOneOf(p.session, SESSIONS, "Session");
  }

  return p;
}

/**
 * Vérifie si la table proposition n'existe pas encore.
 */
export function isMissingTable(error) {
  return (
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|could not find the table/i.test(error.message || ""))
  );
}
