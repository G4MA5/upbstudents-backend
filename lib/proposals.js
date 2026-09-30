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

/** Creates the private proposals bucket on first use (non-destructive). */
export async function ensureProposalsBucket() {
  if (bucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(PROPOSALS_BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(
      PROPOSALS_BUCKET,
      { public: false },
    );
    if (error && !/already exists/i.test(error.message || "")) throw error;
  }
  bucketReady = true;
}

function secret() {
  return (
    process.env.PROPOSAL_SECRET ||
    `proposal:${process.env.supabase_service_role_key || ""}`
  );
}

/** Signs the upload path so step 2 cannot be replayed on another file. */
export function signTicket(path, email, expires) {
  return createHmac("sha256", secret())
    .update(`${path}|${email}|${expires}`)
    .digest("hex");
}

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
    description: cleanMultiline(body.description, 1000),
  };
  requireFields({
    nom: p.nom,
    email: p.email,
    filiere: p.filiere,
    niveau: p.niveau,
    type: p.type,
    matiere: p.matiere,
    annee: p.annee,
  });
  if (!isEmail(p.email)) {
    throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  }
  requireOneOf(p.filiere, FILIERES, "Filière");
  requireOneOf(p.niveau, NIVEAUX, "Niveau");
  requireOneOf(p.type, TYPES, "Type de document");
  validateYear(p.annee);
  if (p.type !== "Examen") p.session = "";
  else if (p.session) requireOneOf(p.session, SESSIONS, "Session");
  return p;
}

/** True when the optional `proposition` table has not been created yet. */
export function isMissingTable(error) {
  return (
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|could not find the table/i.test(error.message || ""))
  );
}
