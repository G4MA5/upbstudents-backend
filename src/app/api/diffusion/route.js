// ---------- Divine : fichier entièrement nouveau (diffusion WhatsApp) ----------
// Envoi d'une annonce WhatsApp à plusieurs étudiants. Réservé aux admins
// dont l'e-mail est dans la variable BROADCAST_ADMIN_EMAILS (séparés par des virgules).
//
//   GET                              → { autorise } + options du formulaire si admin
//   GET ?historique=1&page=1         → liste des diffusions (qui, quand, type, message, état)
//   GET ?campagne=<id>               → détail + progression d'une diffusion
//   POST { action: "apercu",  cible }                                   → combien de personnes, exemples
//   POST { action: "envoyer", message, cible, confirmer, campagneId? }  → lance la diffusion
//   DELETE ?campagne=<id>            → annule ce qui n'est pas encore parti
//
// "cible" (tout est facultatif, vide = tout le monde) :
//   { filieres: ["MIAGE"], niveaux: ["Licence 1"], contributeurs: true, emails: ["a@b.c"] }
// Dans le message, {prenom} et {nom} sont remplacés pour chaque personne.
//
// L'historique est dans la table "diffusion" (migration 20261002000000_diffusion.sql).
// Sans cette table, aucune diffusion n'est possible : on ne diffuse pas sans trace.
import { randomUUID } from "node:crypto";
import {
  HttpError,
  ok,
  preflight,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { isMissingTable } from "../../../../lib/proposals.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import {
  cleanMultiline,
  FILIERES,
  NIVEAUX,
  normalizeEmail,
  requireOneOf,
} from "../../../../lib/validation.js";
import {
  broadcastWhatsApp,
  campaignStatus,
  cancelCampaign,
} from "../../../../lib/whatsapp.js";

const METHODS = "GET, POST, DELETE, OPTIONS";
const TABLE = "diffusion";
const MAX_RECIPIENTS = 1000; // même limite que wa-service
const MAX_MESSAGE_LENGTH = 1500;
const MAX_ROWS = 5000;
const SECONDS_PER_MESSAGE = 5.5; // moyenne du délai de 3 à 8 s entre deux envois
const PAGE_SIZE = 20;
// Plafond de messages sur 24 h glissantes (protège le numéro WhatsApp d'un blocage).
const DAILY_LIMIT = Number(process.env.BROADCAST_DAILY_LIMIT) || 1000;
const FINAL_STATES = ["terminee", "annulee", "echec", "interrompue"];

const MISSING_TABLE =
  "L'historique des diffusions n'est pas encore activé sur le serveur (migration « diffusion » à appliquer).";

// Une erreur "table absente" devient un message clair ; les autres remontent telles quelles.
function dbError(error) {
  if (isMissingTable(error)) throw new HttpError(503, MISSING_TABLE);
  throw error;
}

// ---------- Qui a le droit ? ----------
function allowedEmails() {
  return (process.env.BROADCAST_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Liste vide dans le .env = personne n'a le droit (sécurité par défaut).
// On exige aussi que l'e-mail du compte soit confirmé.
function isBroadcastAdmin(user) {
  const email = String(user.email || "").toLowerCase();
  const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
  return Boolean(email) && confirmed && allowedEmails().includes(email);
}

async function requireBroadcastAdmin(req) {
  const { user } = await requireUser(req);
  if (!isBroadcastAdmin(user)) {
    throw new HttpError(
      403,
      "Cette fonction est réservée aux administrateurs autorisés.",
    );
  }
  return user;
}

// ---------- Qui va recevoir le message ? ----------
function asList(value, max = 50) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "La cible est invalide.");
  return value.slice(0, max);
}

function readTarget(raw) {
  const cible = raw && typeof raw === "object" ? raw : {};
  const filieres = asList(cible.filieres).map((f) => {
    requireOneOf(f, FILIERES, "Filière");
    return f;
  });
  const niveaux = asList(cible.niveaux).map((n) => {
    requireOneOf(n, NIVEAUX, "Niveau");
    return n;
  });
  const emails = asList(cible.emails, 200).map((e) => normalizeEmail(e)).filter(Boolean);
  return {
    filieres,
    niveaux,
    emails,
    contributeurs: cible.contributeurs === true,
  };
}

// Type de diffusion enregistré dans l'historique.
function targetType(t) {
  if (t.emails.length) return "liste";
  const criteria = [t.filieres.length > 0, t.niveaux.length > 0, t.contributeurs].filter(Boolean).length;
  if (criteria === 0) return "tous";
  if (criteria > 1) return "mixte";
  if (t.filieres.length) return "filiere";
  if (t.niveaux.length) return "niveau";
  return "contributeurs";
}

const PHONE = /^\+?\d{8,15}$/;

async function findRecipients(target) {
  let query = supabaseAdmin
    .from("utilisateurs")
    // Divine : whatsapp_optin = consentement (true seulement si l'étudiant a accepté)
    .select("prenom, nom, email, numero, filiere, niveau, whatsapp_optin")
    .range(0, MAX_ROWS - 1);
  if (target.filieres.length) query = query.in("filiere", target.filieres);
  if (target.niveaux.length) query = query.in("niveau", target.niveaux);
  if (target.emails.length) query = query.in("email", target.emails);
  if (target.contributeurs) query = query.eq("proprietaire", true);

  const { data, error } = await query;
  // ---------- Divine : consentement WhatsApp ----------
  // Sans la colonne de consentement, on ne diffuse pas (personne n'a pu accepter).
  if (error && (error.code === "42703" || error.code === "PGRST204" || /whatsapp_optin/i.test(error.message || ""))) {
    throw new HttpError(
      503,
      "Le consentement WhatsApp n'est pas encore activé sur le serveur (migration « whatsapp_consent » à appliquer).",
    );
  }
  // ---------- Divine : fin ----------
  if (error) throw error;

  // On garde les personnes avec un numéro valide ET qui ont accepté WhatsApp,
  // une seule fois par numéro.
  const seen = new Set();
  const recipients = [];
  let sansNumero = 0;
  let sansConsentement = 0;
  for (const row of data) {
    const phone = String(row.numero || "").replace(/[\s.()-]/g, "");
    if (!PHONE.test(phone)) {
      sansNumero += 1;
    } else if (row.whatsapp_optin !== true) {
      // Divine : numéro valide mais l'étudiant n'a pas accepté (ou pas encore répondu).
      sansConsentement += 1;
    } else if (!seen.has(phone)) {
      seen.add(phone);
      recipients.push({
        phone,
        prenom: row.prenom,
        nom: row.nom,
        filiere: row.filiere,
        niveau: row.niveau,
      });
    }
  }
  return { recipients, sansNumero, sansConsentement, tronque: data.length >= MAX_ROWS };
}

// 0778304287 → 07••••4287 (l'aperçu ne montre pas les numéros en entier)
const maskPhone = (p) => `${p.slice(0, 2)}••••${p.slice(-4)}`;

function readMessage(body) {
  const message = cleanMultiline(body.message, MAX_MESSAGE_LENGTH);
  if (message.length < 5) {
    throw new HttpError(400, "Le message est trop court (5 caractères minimum).");
  }
  return message;
}

// ---------- Historique ----------
// Forme renvoyée à l'interface.
function present(row) {
  const restants = Math.max(0, row.total - row.envoyes - row.echecs - row.annules);
  return {
    id: row.id,
    creeLe: row.created_at,
    termineLe: row.termine_le,
    admin: row.admin_email,
    canal: row.canal,
    type: row.type,
    cible: row.cible,
    message: row.message,
    statut: row.statut,
    total: row.total,
    envoyes: row.envoyes,
    echecs: row.echecs,
    annules: row.annules,
    restants,
    erreurs: row.erreurs,
    // Numéros en échec : [{ numero, nom, raison }] (colonne echecs_detail, migration 20261002010000)
    echecsDetail: row.echecs_detail ?? [],
  };
}

async function updateRow(id, patch) {
  const run = (values) =>
    supabaseAdmin
      .from(TABLE)
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

  let { data, error } = await run(patch);
  // Colonne echecs_detail absente (migration 20261002010000 pas encore appliquée) :
  // on enregistre le reste de l'état plutôt que de tout bloquer.
  if (error && "echecs_detail" in patch && (error.code === "42703" || error.code === "PGRST204")) {
    const { echecs_detail: _ignored, ...rest } = patch;
    ({ data, error } = await run(rest));
  }
  if (error) dbError(error);
  return data;
}

// Met l'historique à jour avec l'état réel du service WhatsApp.
// - service injoignable : on garde l'état connu (on réessaiera à la prochaine lecture)
// - campagne inconnue du service : elle a été perdue → "interrompue"
async function syncRow(row) {
  if (FINAL_STATES.includes(row.statut)) return row;
  let c;
  try {
    c = await campaignStatus(row.id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return updateRow(row.id, { statut: "interrompue", termine_le: new Date().toISOString() });
    }
    return row;
  }
  return updateRow(row.id, {
    statut: c.statut,
    total: c.total,
    envoyes: c.envoyes,
    echecs: c.echecs,
    annules: c.annules,
    erreurs: c.erreurs || {},
    echecs_detail: c.echecsDetail || [],
    termine_le: c.termineLe,
  });
}

async function findRow(id) {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) dbError(error);
  return data;
}

// Une seule diffusion à la fois + plafond sur 24 h.
async function assertCanSend(newTotal, newId) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, statut, total, annules")
    .or(`statut.eq.en_cours,created_at.gte.${since}`);
  if (error) dbError(error);

  for (const row of data) {
    if (row.id === newId) continue;
    if (row.statut === "en_cours") {
      const fresh = await syncRow(await findRow(row.id));
      if (fresh.statut === "en_cours") {
        throw new HttpError(
          409,
          "Une diffusion est déjà en cours. Attendez qu'elle se termine ou annulez-la.",
          { campagneEnCours: row.id },
        );
      }
    }
  }
  const sent24h = data
    .filter((r) => r.statut !== "echec" && r.id !== newId)
    .reduce((sum, r) => sum + Math.max(0, r.total - r.annules), 0);
  if (sent24h + newTotal > DAILY_LIMIT) {
    throw new HttpError(
      429,
      `Limite de ${DAILY_LIMIT} messages par 24 h atteinte (${sent24h} déjà diffusés). Réessayez plus tard ou réduisez la cible.`,
    );
  }
}

// ---------- Routes ----------
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;

  if (params.get("campagne")) {
    await requireBroadcastAdmin(req);
    const row = await findRow(params.get("campagne"));
    if (!row) throw new HttpError(404, "Diffusion introuvable.");
    return ok(req, { campagne: present(await syncRow(row)) }, {}, METHODS);
  }

  if (params.get("historique")) {
    await requireBroadcastAdmin(req);
    const page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count, error } = await supabaseAdmin
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) dbError(error);
    // On rafraîchit seulement les diffusions encore en cours.
    const rows = await Promise.all(data.map(syncRow));
    return ok(
      req,
      { historique: rows.map(present), page, parPage: PAGE_SIZE, total: count ?? rows.length },
      {},
      METHODS,
    );
  }

  // Le front appelle ceci pour savoir s'il doit afficher le menu "Diffusion".
  // Un non-admin reçoit simplement { autorise: false } (pas d'erreur).
  const { user } = await requireUser(req);
  if (!isBroadcastAdmin(user)) return ok(req, { autorise: false }, {}, METHODS);

  return ok(
    req,
    {
      autorise: true,
      filieres: FILIERES,
      niveaux: NIVEAUX,
      maxDestinataires: MAX_RECIPIENTS,
      longueurMax: MAX_MESSAGE_LENGTH,
      limiteJournaliere: DAILY_LIMIT,
    },
    {},
    METHODS,
  );
}, METHODS);

export const POST = route(async (req) => {
  const user = await requireBroadcastAdmin(req);
  const body = await readJson(req);
  const target = readTarget(body.cible);
  const { recipients, sansNumero, sansConsentement, tronque } = await findRecipients(target);

  if (body.action === "apercu") {
    return ok(
      req,
      {
        total: recipients.length,
        sansNumero,
        sansConsentement, // Divine : numéro valide mais WhatsApp non accepté
        tronque,
        depasseLimite: recipients.length > MAX_RECIPIENTS,
        dureeEstimeeMinutes: Math.ceil((recipients.length * SECONDS_PER_MESSAGE) / 60),
        exemples: recipients.slice(0, 5).map((r) => ({
          prenom: r.prenom,
          filiere: r.filiere,
          niveau: r.niveau,
          numero: maskPhone(r.phone),
        })),
      },
      {},
      METHODS,
    );
  }

  if (body.action === "envoyer") {
    const message = readMessage(body);
    rateLimit(`diffusion:${user.id}`, { limit: 5, windowMs: 60 * 60_000 });

    if (recipients.length === 0) {
      throw new HttpError(400, "Aucune personne avec un numéro valide ne correspond à cette cible.");
    }
    if (recipients.length > MAX_RECIPIENTS) {
      throw new HttpError(
        400,
        `Trop de destinataires (${recipients.length}). Maximum ${MAX_RECIPIENTS} : affinez la cible.`,
      );
    }
    // Garde-fou : l'admin confirme le nombre qu'il a vu dans l'aperçu.
    if (Number(body.confirmer) !== recipients.length) {
      throw new HttpError(
        409,
        `Le nombre de destinataires a changé (${recipients.length}). Refaites un aperçu avant d'envoyer.`,
        { total: recipients.length },
      );
    }

    // L'identifiant peut venir du front (évite un double envoi si on clique deux fois).
    const given = String(body.campagneId || "");
    const campaignId = /^[\w-]{8,100}$/.test(given) ? given : randomUUID();

    // Même identifiant déjà enregistré : c'est un double clic ou un rejeu → on ne relance rien.
    const existing = await findRow(campaignId);
    if (existing) {
      return ok(req, { campagneId: campaignId, campagne: present(await syncRow(existing)), doublon: true }, {}, METHODS);
    }

    await assertCanSend(recipients.length, campaignId);

    // 1) On écrit d'abord dans l'historique (aucune diffusion sans trace)...
    const { error: insertError } = await supabaseAdmin.from(TABLE).insert([
      {
        id: campaignId,
        admin_user_id: user.id,
        admin_email: user.email,
        type: targetType(target),
        cible: target,
        message,
        total: recipients.length,
        statut: "en_cours",
      },
    ]);
    if (insertError) {
      if (insertError.code === "23505") {
        // Deux clics simultanés : l'autre requête a déjà créé la ligne.
        return ok(req, { campagneId: campaignId, campagne: present(await findRow(campaignId)), doublon: true }, {}, METHODS);
      }
      dbError(insertError);
    }

    // 2) ...puis on lance l'envoi. S'il échoue, l'historique garde la trace de l'échec.
    let result;
    try {
      result = await broadcastWhatsApp({
        campaignId,
        message,
        recipients: recipients.map(({ phone, prenom, nom }) => ({ phone, prenom, nom })),
      });
    } catch (err) {
      await updateRow(campaignId, {
        statut: "echec",
        erreurs: { raison: err.message },
        termine_le: new Date().toISOString(),
      }).catch((e) => console.error("[diffusion] historique", e));
      throw err;
    }

    const row = await updateRow(campaignId, {
      total: result.total,
      statut: result.statut,
      envoyes: result.envoyes,
      echecs: result.echecs,
      annules: result.annules,
      erreurs: result.erreurs || {},
    });
    console.log(
      `[diffusion] ${user.email} lance la campagne ${campaignId} (${row.type}) vers ${row.total} personne(s)`,
    );
    return ok(
      req,
      {
        campagneId: campaignId,
        campagne: present(row),
        message: "La diffusion est lancée : les messages partent progressivement.",
      },
      {},
      METHODS,
    );
  }

  throw new HttpError(400, "Requête invalide.");
}, METHODS);

export const DELETE = route(async (req) => {
  const user = await requireBroadcastAdmin(req);
  const id = new URL(req.url).searchParams.get("campagne");
  if (!id) throw new HttpError(400, "Identifiant de campagne manquant.");

  const row = await findRow(id);
  if (!row) throw new HttpError(404, "Diffusion introuvable.");
  if (FINAL_STATES.includes(row.statut)) {
    throw new HttpError(409, "Cette diffusion est déjà terminée.");
  }

  const c = await cancelCampaign(id);
  const updated = await updateRow(id, {
    statut: c.statut,
    envoyes: c.envoyes,
    echecs: c.echecs,
    annules: c.annules,
    erreurs: c.erreurs || {},
    echecs_detail: c.echecsDetail || [],
    termine_le: c.termineLe,
  });
  console.log(`[diffusion] ${user.email} annule la campagne ${id} (${c.annules} message(s) retirés)`);
  return ok(req, { campagne: present(updated) }, {}, METHODS);
}, METHODS);

export const OPTIONS = preflight(METHODS);
// ---------- Divine : fin ----------
