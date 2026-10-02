import fs from "node:fs";
import path from "node:path";
import * as remote from "./remote.js";
import { isReady, sendText } from "./whatsapp.js";

const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;
const NOT_READY_RETRY_MS = 5000;
const MAX_ATTEMPTS = 3;
const MAX_CAMPAIGNS_KEPT = 200;
const MAX_FAILURES_KEPT = 1000;

// Deux files : les messages "urgents" (inscription, mot de passe oublié,
// notifications unitaires) passent TOUJOURS avant les diffusions de masse.
const urgent = [];
const bulk = [];
const campaigns = new Map();
let running = false;

// ---------- Sauvegarde ----------
// La file et les campagnes survivent aux redémarrages (mise à jour, crash, reboot) :
//  - par défaut : fichier DATA_DIR/queue.json (volume Docker / disque persistant) ;
//  - SESSION_STORE=supabase : ligne "queue" de la table wa_state (hébergeur au disque éphémère).
// Un message en cours d'envoi au moment de l'arrêt peut être renvoyé une fois
// (livraison "au moins une fois").
const DATA_FILE = path.join(process.env.DATA_DIR || "data", "queue.json");
const REMOTE_KEY = "queue";
// Distant : on écrit moins souvent (limite le trafic) ; les actions importantes sont écrites tout de suite.
const SAVE_DELAY_MS = remote.remoteEnabled() ? 5000 : 500;
let saveTimer = null;
let saveChain = Promise.resolve();

const snapshot = () => ({ urgent, bulk, campaigns: [...campaigns.values()] });

async function persist() {
  const data = snapshot();
  try {
    if (remote.remoteEnabled()) {
      await remote.upsertMany([{ key: REMOTE_KEY, value: data }]);
    } else {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DATA_FILE); // écriture atomique : jamais de fichier à moitié écrit
    }
  } catch (err) {
    console.error("[queue] sauvegarde impossible :", err.message);
    saveSoon(); // on réessaiera
  }
}

/** Écrit immédiatement (arrêt du service, actions importantes). */
export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveChain = saveChain.then(persist);
  return saveChain;
}

function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

async function load() {
  let data = null;
  if (remote.remoteEnabled()) {
    data = await remote.getOne(REMOTE_KEY); // une erreur ici arrête le démarrage : jamais d'écrasement par une file vide
  } else {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") console.error("[queue] lecture de la sauvegarde impossible :", err.message);
    }
  }
  if (!data) return;
  urgent.push(...(data.urgent || []));
  bulk.push(...(data.bulk || []));
  for (const c of data.campaigns || []) campaigns.set(c.id, c);
  if (urgent.length + bulk.length > 0) {
    console.log(`[queue] reprise après redémarrage : ${urgent.length} urgent(s), ${bulk.length} en diffusion`);
  }
}

/** À appeler au démarrage : recharge la sauvegarde puis reprend l'envoi (la boucle attend WhatsApp). */
export async function initQueue() {
  await load();
  if (queueLength() > 0) loop();
}

const randomDelay = () =>
  MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const queueLength = () => urgent.length + bulk.length;

export function enqueue(phone, message) {
  urgent.push({ phone, message, attempts: 0 });
  saveSoon();
  if (!running) loop();
}

/** {prenom} et {nom} du texte sont remplacés pour chaque personne. */
export function personalize(template, person) {
  return String(template)
    .replace(/\{prenom\}/g, String(person.prenom ?? "").trim())
    .replace(/\{nom\}/g, String(person.nom ?? "").trim())
    .replace(/[ \t]+([,.!?:;])/g, "$1") // "Bonjour ," → "Bonjour,"
    .trim();
}

/**
 * Message d'un élément de la file. Les diffusions ne stockent que le modèle de la
 * campagne + prénom/nom : la sauvegarde reste légère même pour 1000 destinataires.
 */
function messageOf(item) {
  if (item.message !== undefined) return item.message; // messages urgents (ou ancien format)
  const campaign = campaigns.get(item.campaignId);
  return personalize(campaign?.template ?? "", item);
}

/**
 * @param {string} template texte avec {prenom} / {nom}
 * @param entries [{ phone, original, prenom, nom }]
 */
export function enqueueCampaign(id, entries, template) {
  campaigns.set(id, {
    id,
    template,
    total: entries.length,
    sent: 0,
    failed: 0,
    cancelled: 0,
    errors: {},
    // Détail des échecs : { numero, nom, raison } (numéro tel que saisi dans le profil).
    failures: [],
    createdAt: Date.now(),
    finishedAt: null,
  });
  for (const entry of entries) bulk.push({ ...entry, attempts: 0, campaignId: id });

  // On ne garde que les dernières campagnes en mémoire.
  while (campaigns.size > MAX_CAMPAIGNS_KEPT) {
    campaigns.delete(campaigns.keys().next().value);
  }
  saveNow(); // action importante : écrite tout de suite
  if (!running) loop();
  return campaignSummary(id);
}

export function hasCampaign(id) {
  return campaigns.has(id);
}

export function campaignSummary(id) {
  const c = campaigns.get(id);
  if (!c) return null;
  const pending = c.total - c.sent - c.failed - c.cancelled;
  let statut = "en_cours";
  if (pending <= 0) statut = c.cancelled > 0 ? "annulee" : "terminee";
  return {
    campaignId: c.id,
    statut,
    total: c.total,
    envoyes: c.sent,
    echecs: c.failed,
    annules: c.cancelled,
    restants: Math.max(0, pending),
    erreurs: c.errors,
    echecsDetail: c.failures ?? [],
    creeLe: new Date(c.createdAt).toISOString(),
    termineLe: c.finishedAt ? new Date(c.finishedAt).toISOString() : null,
  };
}

/** Retire de la file tous les messages restants d'une campagne. */
export function cancelCampaign(id) {
  const c = campaigns.get(id);
  if (!c) return null;
  for (let i = bulk.length - 1; i >= 0; i--) {
    if (bulk[i].campaignId === id) {
      bulk.splice(i, 1);
      c.cancelled += 1;
    }
  }
  markFinished(c);
  saveNow(); // action importante : écrite tout de suite
  return campaignSummary(id);
}

function markFinished(c) {
  if (c.total - c.sent - c.failed - c.cancelled <= 0 && !c.finishedAt) {
    c.finishedAt = Date.now();
  }
}

function recordResult(item, error) {
  if (!item.campaignId) return;
  const c = campaigns.get(item.campaignId);
  if (!c) return;
  if (error) {
    c.failed += 1;
    c.errors[error] = (c.errors[error] || 0) + 1;
    c.failures ??= [];
    if (c.failures.length < MAX_FAILURES_KEPT) {
      const name = item.name || [item.prenom, item.nom].filter(Boolean).join(" ");
      c.failures.push({ numero: item.original || item.phone, nom: name, raison: error });
    }
  } else {
    c.sent += 1;
  }
  markFinished(c);
}

function removeItem(queue, item) {
  const index = queue.indexOf(item);
  if (index >= 0) queue.splice(index, 1);
  saveSoon();
}

async function loop() {
  running = true;
  while (queueLength() > 0) {
    // Messages stay queued while WhatsApp is disconnected.
    if (!isReady()) {
      await sleep(NOT_READY_RETRY_MS);
      continue;
    }
    const queue = urgent.length > 0 ? urgent : bulk;
    const item = queue[0];
    try {
      await sendText(item.phone, messageOf(item));
      removeItem(queue, item);
      recordResult(item, null);
      console.log(`[queue] message envoyé à ${item.phone}`);
    } catch (err) {
      item.attempts += 1;
      const reason = err?.message || err?.output?.payload?.message || String(err);
      console.error(
        `[queue] échec envoi vers ${item.phone} (essai ${item.attempts}/${MAX_ATTEMPTS}) :`,
        reason,
      );
      // Permanent errors (unknown number) are not retried.
      if (err?.permanent || item.attempts >= MAX_ATTEMPTS) {
        removeItem(queue, item);
        recordResult(item, err?.permanent ? "numero_absent_de_whatsapp" : "echec_envoi");
      }
    }
    if (queueLength() > 0) await sleep(randomDelay());
  }
  running = false;
}
