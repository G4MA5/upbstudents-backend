import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { useAuthState } from "./authState.js";

// Bruit connu de Baileys 6.7.x : les messages REÇUS (réponses, échos de nos propres
// envois) ne peuvent pas être déchiffrés depuis le passage de WhatsApp aux
// identifiants @lid. Sans effet sur l'envoi : on masque ces lignes pour garder
// les logs lisibles. Mettre DEBUG_WA=1 pour tout revoir.
const NOISE = [
  "failed to decrypt message",
  "Failed to decrypt message with any known session",
  "Session error:",
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
    scheduleReconnect(10_000);
    return;
  }

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
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      lastQr = qr;
      console.log("Scannez ce QR code (WhatsApp → Appareils connectés), ou ouvrez la page /qr :");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      ready = true;
      lastQr = null;
      console.log("WhatsApp connecté.");
    }
    if (connection === "close") {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        // Déconnecté depuis le téléphone : la session n'est plus valable. On l'efface
        // pour repartir sur un nouveau QR code (page /qr).
        console.error("Déconnexion depuis le téléphone (loggedOut) : session effacée, nouveau QR code à scanner.");
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
export async function sendText(phone, message) {
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

  const sent = await sock.sendMessage(found.jid, { text: message });
  console.log(`[whatsapp] accepté par le serveur : ${found.jid} (id ${sent?.key?.id})`);
}
