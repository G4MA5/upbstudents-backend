// ---------- Divine : fichier entièrement nouveau (WhatsApp) ----------
// Ce fichier fait le lien entre le backend Next et le service WhatsApp
// (dossier /services/wa-service). À utiliser côté serveur seulement.
//
// Règle importante : si WhatsApp ne marche pas, on écrit l'erreur dans les logs
// mais on ne casse JAMAIS la requête. L'e-mail reste le moyen principal.
import { HttpError } from "./http.js";
import { supabaseAdmin } from "./supabaseClient.js";

// On n'attend pas WhatsApp plus de 4 secondes.
const TIMEOUT_MS = 4000;

// Vrai si les variables WA_SERVICE_URL et WA_API_KEY sont bien dans le .env.
export function isWhatsAppConfigured() {
  return Boolean(process.env.WA_SERVICE_URL && process.env.WA_API_KEY);
}

// Numéro WhatsApp de l'admin (variable ADMIN_WHATSAPP du .env).
export function adminPhone() {
  return process.env.ADMIN_WHATSAPP || "";
}

/**
 * Envoie un message WhatsApp à partir d'un modèle du wa-service.
 *  - type : nom du modèle (ex. "proposal_published")
 *  - phone : numéro du destinataire (ex. "0778304287")
 *  - data : les infos du message (nom, matière, ...)
 *  - idempotencyKey : clé unique (facultative). Avec la même clé, le message
 *    n'est envoyé qu'une seule fois, même si on rappelle la fonction.
 * Retourne true si le message est bien mis en file d'attente, sinon false.
 */
export async function notifyWhatsApp(type, phone, data, idempotencyKey) {
  // Pas de config ou pas de numéro : on ne fait rien.
  if (!isWhatsAppConfigured() || !phone) return false;
  try {
    const res = await fetch(`${process.env.WA_SERVICE_URL.replace(/\/+$/, "")}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WA_API_KEY,
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
      body: JSON.stringify({ type, phone, data }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[whatsapp]", type, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    // Service éteint, timeout, réseau... : on note l'erreur et on continue.
    console.error("[whatsapp]", type, err.message);
    return false;
  }
}

// ---------- Consentement WhatsApp (opt-in) ----------
// Colonne utilisateurs.whatsapp_optin : null = pas encore répondu, true = accepté,
// false = refusé (migration 20261002020000_whatsapp_consent.sql).
// Un étudiant ne reçoit un WhatsApp que s'il a accepté (true).
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);
const isMissingColumn = (error) =>
  Boolean(error) && (MISSING_COLUMN.has(error.code) || /whatsapp_optin/i.test(error.message || ""));

// Récupère prénom, numéro et consentement d'un compte (par user_id ou par e-mail).
// Si la colonne n'existe pas encore (migration pas appliquée), le consentement
// n'est pas géré : on garde l'ancien comportement (whatsapp_optin = true).
async function readProfile(column, value) {
  if (!value) return null;
  let { data, error } = await supabaseAdmin
    .from("utilisateurs")
    .select("prenom, numero, whatsapp_optin")
    .eq(column, value)
    .maybeSingle();
  if (isMissingColumn(error)) {
    ({ data, error } = await supabaseAdmin
      .from("utilisateurs")
      .select("prenom, numero")
      .eq(column, value)
      .maybeSingle());
    if (data) data = { ...data, whatsapp_optin: true };
  }
  if (error) {
    console.error("[whatsapp] profil", error.message);
    return null;
  }
  return data;
}

export const profileById = (userId) => readProfile("user_id", userId);

// Pareil, mais à partir de l'e-mail (utilisé pour "mot de passe oublié").
export const profileByEmail = (email) => readProfile("email", email);

// Envoie un WhatsApp à un utilisateur inscrit, en utilisant le numéro
// enregistré dans son profil (table "utilisateurs") — seulement s'il a accepté.
export async function notifyUser(userId, type, data, idempotencyKey) {
  if (!isWhatsAppConfigured()) return false;
  const profile = await profileById(userId);
  if (profile?.whatsapp_optin !== true) return false;
  return notifyWhatsApp(type, profile?.numero, data, idempotencyKey);
}

// État du consentement d'un compte : { disponible, accepte }.
//  - disponible : false tant que la migration n'est pas appliquée (l'interface masque alors l'option)
//  - accepte    : true / false, ou null si l'étudiant n'a jamais répondu
export async function getWhatsappConsent(userId) {
  const { data, error } = await supabaseAdmin
    .from("utilisateurs")
    .select("whatsapp_optin")
    .eq("user_id", userId)
    .maybeSingle();
  if (isMissingColumn(error)) return { disponible: false, accepte: null };
  if (error) throw error;
  return { disponible: true, accepte: data?.whatsapp_optin ?? null };
}

// Enregistre la réponse (true / false) avec la date.
export async function setWhatsappConsent(userId, accepte) {
  const { error } = await supabaseAdmin
    .from("utilisateurs")
    .update({ whatsapp_optin: Boolean(accepte), whatsapp_optin_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (isMissingColumn(error)) {
    throw new HttpError(503, "Les notifications WhatsApp ne sont pas encore activées sur le serveur.");
  }
  if (error) throw error;
  return { disponible: true, accepte: Boolean(accepte) };
}

// ---------- Diffusion de masse (annonces aux étudiants) ----------
// Contrairement aux notifications ci-dessus, ces fonctions LÈVENT une erreur
// si le service WhatsApp ne répond pas : c'est un admin qui lance l'action,
// il doit savoir si ça n'a pas marché.
async function waRequest(path, { method = "GET", body, idempotencyKey, timeoutMs = 15000 } = {}) {
  if (!isWhatsAppConfigured()) {
    throw new HttpError(503, "Le service WhatsApp n'est pas configuré sur le serveur.");
  }
  let res;
  try {
    res = await fetch(`${process.env.WA_SERVICE_URL.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WA_API_KEY,
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error("[whatsapp]", path, err.message);
    throw new HttpError(502, "Le service WhatsApp ne répond pas. Réessayez dans quelques instants.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[whatsapp]", path, res.status, data);
    throw new HttpError(
      res.status === 404 ? 404 : 502,
      data.error || "Le service WhatsApp a refusé la demande.",
    );
  }
  return data;
}

// Lance une diffusion. recipients : [{ phone, prenom, nom }].
// campaignId identique = même campagne (rejouer l'appel n'envoie pas deux fois).
export function broadcastWhatsApp({ campaignId, message, recipients }) {
  return waRequest("/broadcast", {
    method: "POST",
    body: { campaignId, message, recipients },
    idempotencyKey: campaignId,
  });
}

// Progression d'une campagne (envoyés, échecs, restants).
export function campaignStatus(campaignId) {
  return waRequest(`/campaigns/${encodeURIComponent(campaignId)}`);
}

// Annule les messages d'une campagne qui ne sont pas encore partis.
export function cancelCampaign(campaignId) {
  return waRequest(`/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" });
}
// ---------- Divine : fin ----------
