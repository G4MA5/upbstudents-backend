import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { randomUUID } from "node:crypto";
import { useAuthState } from "./authState.js";
import * as remote from "./remote.js";

// Bruit connu de Baileys 6.7.x : les messages REÇUS (réponses, échos de nos propres
// envois) ne peuvent pas être déchiffrés depuis le passage de WhatsApp aux
// identifiants @lid. Sans effet sur l'envoi : on masque ces lignes pour garder
// les logs lisibles. Mettre DEBUG_WA=1 pour tout revoir.
const NOISE = [
  "failed to decrypt message",
  "Failed to decrypt message with any known session",
  "Session error:",
  // Synchronisation des conversations juste après le scan : le téléphone envoie ses clés un peu plus tard.
  // Sans effet sur l'envoi de messages.
  "critical_block blocked on missing key",
  "critical_unblock_low blocked on missing key",
];
const isNoise = (value) => typeof value === "string" && NOISE.some((n) => value.startsWith(n));

if (!process.env.DEBUG_WA) {
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (!isNoise(args[0])) original(...args);
    };
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || "warn",
  hooks: {
    logMethod(args, method) {
      if (!process.env.DEBUG_WA && args.some(isNoise)) return;
      method.apply(this, args);
    },
  },
});
const RECONNECT_DELAY_MS = 5000;

let sock = null;
let ready = false;
let reconnectTimer = null;
let auth = null; // { flush, clear } de la session en cours
let lastQr = null; // dernier QR code reçu (affiché par la page /qr)

export const isReady = () => ready;
export const currentQr = () => lastQr;

// État détaillé de la connexion, affiché par /health pour diagnostiquer sans lire les logs.
const status = {
  etat: "démarrage", // démarrage | connexion | connecté | fermé | session_effacée
  dernierCodeFermeture: null,
  dernierMotifFermeture: null,
  derniereFermetureLe: null,
  derniereConnexionLe: null,
  reconnexions: 0,
  derniereErreurDemarrage: null,
  // Restriction « nouvelles conversations » du compte (erreur 463) : { active, jusquau, type } ou null si inconnue.
  restriction: null,
  // Plafond de nouvelles conversations renvoyé par WhatsApp (brut), ou null si inconnu.
  plafondNouvellesConversations: null,
};
const iso = () => new Date().toISOString();
export const getStatus = () => ({
  ...status,
  qrEnAttente: lastQr !== null,
  verrou: !remote.remoteEnabled() ? "non utilisé" : hasLease ? "détenu par cette instance" : "détenu par une autre instance",
  instance: instanceId,
  messages: { ...stats },
});

// Copie des derniers messages envoyés (id → contenu), pour répondre aux demandes de renvoi.
const sentMessages = new Map();
const MAX_SENT_KEPT = 1000;

// Compteurs depuis le démarrage du service (affichés par /health).
const stats = { envoyes: 0, accusesServeur: 0, accusesLivres: 0, accusesLus: 0, erreursMessage: 0 };

// ---------- Verrou : une seule instance connectée à WhatsApp ----------
// Voir remote.js. Actif seulement avec SESSION_STORE=supabase (sinon une seule instance par construction).
const LOCK_KEY = "lock";
const instanceId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || "local"}-${randomUUID().slice(0, 8)}`;
const LEASE_TTL_MS = (Number(process.env.LEASE_TTL_SECONDS) || 40) * 1000;
const LEASE_RENEW_MS = Math.max(2000, Math.floor(LEASE_TTL_MS / 4));
let hasLease = false;
let leaseTimer = null;
let leaseValidUntil = 0;
let onLeaseAcquired = async () => {};

/** true si cette instance a le droit de parler à WhatsApp (toujours vrai sans stockage partagé). */
export const holdsLease = () => !remote.remoteEnabled() || hasLease;

/** Appelé à chaque prise du verrou (ex. relire la file, que l'instance précédente a pu faire avancer). */
export const setLeaseHook = (fn) => {
  onLeaseAcquired = fn;
};

function loseLease(reason) {
  console.error(`[verrou] ${reason} : arrêt de la connexion WhatsApp de cette instance.`);
  hasLease = false;
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null;
  ready = false;
  status.etat = "en_attente_de_verrou";
  try {
    sock?.end(undefined);
  } catch {
    // Socket déjà fermée.
  }
  sock = null;
  scheduleReconnect(LEASE_RENEW_MS);
}

function startLeaseRenewal() {
  if (leaseTimer) return;
  leaseTimer = setInterval(async () => {
    try {
      if (await remote.acquireLock(LOCK_KEY, instanceId, LEASE_TTL_MS)) {
        leaseValidUntil = Date.now() + LEASE_TTL_MS;
        return;
      }
      loseLease("une autre instance a pris le verrou");
    } catch (err) {
      // Supabase injoignable : on continue tant que notre bail n'a pas expiré (marge de 5 s),
      // car passé ce délai une autre instance peut légitimement prendre la main.
      console.error("[verrou] renouvellement impossible :", err.message);
      if (Date.now() > leaseValidUntil - 5000) loseLease("bail expiré sans pouvoir le renouveler");
    }
  }, LEASE_RENEW_MS);
}

/**
 * Repart d'une session propre : déconnecte l'appareil côté WhatsApp (il disparaît de « Appareils connectés »),
 * efface la session stockée puis redémarre la connexion, qui affiche un nouveau QR code (page /qr).
 * À utiliser quand les destinataires voient « En attente de ce message » ou après un conflit de session.
 */
export async function resetSession() {
  ready = false;
  try {
    // logout() prévient WhatsApp ; on n'attend pas plus de 8 s si la session est déjà cassée.
    await Promise.race([sock?.logout(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  } catch {
    // Session déjà inutilisable : on efface quand même.
  }
  try {
    sock?.end(undefined);
  } catch {
    // Socket déjà fermée.
  }
  await auth?.clear();
  lastQr = null;
  status.etat = "session_effacée";
  scheduleReconnect(1500);
}

/** Arrêt propre : libère le verrou pour que la prochaine instance prenne la main tout de suite. */
export async function releaseLease() {
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null;
  if (!remote.remoteEnabled() || !hasLease) return;
  hasLease = false;
  try {
    await remote.releaseLock(LOCK_KEY, instanceId);
  } catch (err) {
    console.error("[verrou] libération impossible (le bail expirera seul) :", err.message);
  }
}

// Rejets signalés par WhatsApp APRÈS l'envoi (ex. erreur 463) : sendMessage a réussi, mais le serveur refuse le message.
// La file s'abonne pour corriger l'historique (« refusé par WhatsApp » au lieu de « envoyé »).
let deliveryErrorHandler = () => {};
export const onDeliveryError = (fn) => {
  deliveryErrorHandler = fn;
};

/** Écrit la session en attente (à appeler avant l'arrêt du processus). */
export const flushAuth = () => (auth ? auth.flush() : Promise.resolve());

function scheduleReconnect(delay) {
  // Une seule reconnexion en attente à la fois (évite les sockets parallèles).
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp();
  }, delay);
}

export async function startWhatsApp() {
  // Une seule instance à la fois : sans le verrou, on attend (l'autre instance finira par s'arrêter).
  if (remote.remoteEnabled() && !hasLease) {
    let acquired = false;
    try {
      acquired = await remote.acquireLock(LOCK_KEY, instanceId, LEASE_TTL_MS);
    } catch (err) {
      console.error("[verrou] impossible de contacter Supabase :", err.message);
    }
    if (!acquired) {
      status.etat = "en_attente_de_verrou";
      scheduleReconnect(LEASE_RENEW_MS);
      return;
    }
    hasLease = true;
    leaseValidUntil = Date.now() + LEASE_TTL_MS;
    console.log(`[verrou] verrou obtenu par l'instance ${instanceId}`);
    startLeaseRenewal();
    try {
      await onLeaseAcquired();
    } catch (err) {
      console.error("[verrou] relecture de la file impossible :", err.message);
    }
  }

  let state;
  let saveCreds;
  let version;
  try {
    const handle = await useAuthState();
    ({ state, saveCreds } = handle);
    auth = handle;
    ({ version } = await fetchLatestBaileysVersion());
  } catch (err) {
    // Supabase ou réseau indisponible au démarrage : on réessaie, sans toucher à la session.
    console.error("[whatsapp] démarrage impossible, nouvel essai dans 10 s :", err.message);
    status.derniereErreurDemarrage = `${iso()} — ${err.message}`;
    scheduleReconnect(10_000);
    return;
  }
  status.derniereErreurDemarrage = null;
  status.etat = "connexion";
  status.reconnexions += 1;

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Slow networks: avoid "Timed Out" on init queries.
    defaultQueryTimeoutMs: 60_000,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    // Props/blocklist/privacy queries are useless for sending and were the
    // source of the "Timed Out ... init queries" errors.
    fireInitQueries: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Quand le téléphone du destinataire n'arrive pas à déchiffrer un message (« En attente de
    // ce message »), il demande un renvoi : Baileys a besoin de retrouver le message d'origine.
    // Sans cette fonction, le destinataire reste bloqué sur « En attente ».
    getMessage: async (key) => sentMessages.get(key.id),
  });
  sock.ev.on("creds.update", saveCreds);

  // Accusés de réception : serveur WhatsApp (2), téléphone du destinataire (3), lu (4).
  // Visibles dans /health : si « serveur » monte mais pas « livres », le téléphone du destinataire ne reçoit pas.
  sock.ev.on("messages.update", (updates) => {
    for (const { key, update } of updates) {
      if (!key?.fromMe || typeof update?.status !== "number") continue;
      if (update.status === 2) stats.accusesServeur += 1;
      if (update.status === 3) stats.accusesLivres += 1;
      if (update.status === 4) stats.accusesLus += 1;
      if (update.status === 0) {
        stats.erreursMessage += 1;
        const code = String(update.messageStubParameters?.[0] ?? "inconnu");
        console.error(`[whatsapp] message ${key.id} REFUSÉ par WhatsApp (code ${code})${code === "463" ? " : compte restreint pour écrire à un nouveau contact" : ""}`);
        deliveryErrorHandler(key.id, code);
      }
    }
  });

  // WhatsApp signale (ou nous renvoie sur demande) la restriction « nouvelles conversations ».
  sock.ev.on("message-capping.update", (payload) => {
    status.plafondNouvellesConversations = payload ?? null;
  });
  const saveRestriction = (r) => {
    status.restriction = r
      ? { active: Boolean(r.isActive), jusquau: r.timeEnforcementEnds ? new Date(r.timeEnforcementEnds).toISOString() : null, type: r.enforcementType ?? null }
      : null;
  };

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr, reachoutTimeLock }) => {
    if (reachoutTimeLock) saveRestriction(reachoutTimeLock);
    if (qr) {
      lastQr = qr;
      console.log("Scannez ce QR code (WhatsApp → Appareils connectés), ou ouvrez la page /qr :");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      ready = true;
      lastQr = null;
      status.etat = "connecté";
      status.derniereConnexionLe = iso();
      console.log("WhatsApp connecté.");
      // On demande à WhatsApp si le compte est restreint et quel est son plafond (affiché par /health).
      // En arrière-plan et sans bloquer : ces fonctions n'existent que dans les versions récentes.
      setTimeout(async () => {
        try {
          saveRestriction(await sock?.fetchAccountReachoutTimelock?.());
        } catch (err) {
          console.warn("[whatsapp] restriction du compte : lecture impossible :", err?.message);
        }
        try {
          status.plafondNouvellesConversations = (await sock?.fetchNewChatMessageCap?.()) ?? null;
        } catch (err) {
          console.warn("[whatsapp] plafond de nouvelles conversations : lecture impossible :", err?.message);
        }
        const r = status.restriction;
        if (r?.active) console.warn(`[whatsapp] ⚠ compte RESTREINT pour écrire à de nouveaux contacts${r.jusquau ? ` jusqu'au ${r.jusquau}` : ""}.`);
      }, 5000);
    }
    if (connection === "close") {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      status.etat = "fermé";
      status.dernierCodeFermeture = code ?? null;
      status.dernierMotifFermeture = String(lastDisconnect?.error?.message ?? "").slice(0, 200) || null;
      status.derniereFermetureLe = iso();

      if (code === DisconnectReason.loggedOut) {
        // Déconnecté depuis le téléphone : la session n'est plus valable. On l'efface
        // pour repartir sur un nouveau QR code (page /qr).
        console.error("Déconnexion depuis le téléphone (loggedOut) : session effacée, nouveau QR code à scanner.");
        status.etat = "session_effacée";
        auth
          ?.clear()
          .catch((err) => console.error("[whatsapp] effacement de la session :", err.message))
          .finally(() => scheduleReconnect(3000));
        return;
      }

      if (code === DisconnectReason.connectionReplaced) {
        // Une autre instance utilise la même session (ex. déploiement qui se chevauche).
        // On attend qu'elle s'arrête au lieu de se battre pour la connexion.
        console.warn("Session reprise par une autre instance (code 440) : nouvelle tentative dans 60 s.");
        scheduleReconnect(60_000);
        return;
      }

      console.warn(`Connexion fermée (code ${code ?? "?"}), reconnexion…`);
      scheduleReconnect(RECONNECT_DELAY_MS);
    }
  });
}

/** phone: digits only, international format without "+". */
/**
 * @param {string} phone numéros au format international sans « + »
 * @param {string} message texte (peut être vide si une pièce jointe est fournie)
 * @param {{ type: "sticker" | "image", mimetype: string, buffer: Buffer } | null} [media]
 * @returns {Promise<string[]>} identifiants WhatsApp des messages envoyés
 */
export async function sendText(phone, message, media = null) {
  if (!ready || !sock) throw new Error("WhatsApp non connecté");

  // Ask WhatsApp for the real JID: sendMessage "succeeds" even for numbers
  // that are not registered or written in another format.
  // Côte d'Ivoire: numbers moved from 8 to 10 digits (the two-digit prefix
  // 01/05/07/… was added) but WhatsApp may still know the old 8-digit form.
  // Both forms are tried and the one registered on WhatsApp is used.
  const candidates = [phone];
  const national = phone.startsWith("225") ? phone.slice(3) : "";
  if (national.length === 10) candidates.push(`225${national.slice(2)}`);

  const results = (await sock.onWhatsApp(...candidates)) || [];
  const found = results.find((r) => r.exists);
  if (!found) {
    const err = new Error(`le numéro ${phone} n'existe pas sur WhatsApp (vérifiez l'indicatif et le format)`);
    err.permanent = true;
    throw err;
  }
  if (found.jid !== `${phone}@s.whatsapp.net`) {
    console.log(`[whatsapp] numéro ${phone} résolu en ${found.jid}`);
  }

  const ids = [];
  const send = async (content) => {
    const sent = await sock.sendMessage(found.jid, content);
    // On garde une copie du message pour pouvoir le renvoyer si le destinataire le demande.
    if (sent?.key?.id && sent.message) {
      sentMessages.set(sent.key.id, sent.message);
      if (sentMessages.size > MAX_SENT_KEPT) sentMessages.delete(sentMessages.keys().next().value);
    }
    stats.envoyes += 1;
    console.log(`[whatsapp] accepté par le serveur : ${found.jid} (id ${sent?.key?.id})`);
    if (sent?.key?.id) ids.push(sent.key.id);
  };

  if (media?.type === "image") {
    // Image : le texte devient sa légende (un seul message).
    await send({ image: media.buffer, mimetype: media.mimetype, caption: message || undefined });
  } else {
    if (message) await send({ text: message });
    if (media?.type === "sticker") {
      // Un sticker n'a pas de légende : il part dans un second message, juste après le texte.
      if (message) await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await send({ sticker: media.buffer, mimetype: "image/webp" });
      } catch (err) {
        // Le texte est déjà parti : on ne relance pas tout (il serait envoyé deux fois).
        if (!message) throw err;
        console.error("[whatsapp] sticker non envoyé (le texte est parti) :", err.message);
      }
    }
  }
  return ids;
}
