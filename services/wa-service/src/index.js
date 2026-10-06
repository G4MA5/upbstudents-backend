import "dotenv/config";
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import QRCode from "qrcode";
import { fingerprint, IdempotencyError, runOnce } from "./idempotency.js";
import {
  campaignSummary,
  cancelCampaign,
  enqueue,
  enqueueCampaign,
  hasCampaign,
  initQueue,
  queueLength,
  saveNow,
} from "./queue.js";
import { listTemplates, templates } from "./templates.js";
import { currentQr, flushAuth, getStatus, isReady, startWhatsApp } from "./whatsapp.js";

// Lit une clé d'environnement sans espaces ni guillemets collés par erreur dans le tableau de bord de l'hébergeur.
const envKey = (name) =>
  String(process.env[name] ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();

// Comparaison de la clé en temps constant (évite de deviner la clé par mesure du temps de réponse).
const sameKey = (given, expected) =>
  timingSafeEqual(
    createHash("sha256").update(String(given ?? "")).digest(),
    createHash("sha256").update(String(expected)).digest(),
  );

const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_COUNTRY_CODE = String(process.env.DEFAULT_COUNTRY_CODE || "225").replace(/\D/g, "");
const MAX_MESSAGE_LENGTH = 4000;
const BROADCAST_MAX_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS) || 1000;
const BROADCAST_MAX_LENGTH = 1500;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// ---------- Routes publiques (avant l'authentification) ----------
// /ping : sans aucune donnée, pour les contrôles de disponibilité (UptimeRobot) qui
// gardent un hébergeur gratuit éveillé (Render met en veille après 15 min sans requête).
app.get("/ping", (_req, res) => res.type("text/plain").send("ok"));

// /qr?key=<QR_KEY> : affiche le QR code dans le navigateur (le QR du terminal est peu
// lisible dans les logs d'un hébergeur). Désactivée tant que QR_KEY n'est pas défini ;
// à retirer (supprimer QR_KEY) une fois le numéro connecté.
app.get("/qr", async (req, res, next) => {
  try {
    const expected = envKey("QR_KEY");
    if (!expected || !sameKey(req.query.key, expected)) return res.status(404).end();

    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const page = (body) => res.type("html").send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10">
<meta name="robots" content="noindex"><title>Connexion WhatsApp</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center;color:#1f2937">${body}</body></html>`);

    if (isReady()) {
      return page(`<h2>✅ WhatsApp est connecté</h2><p>Vous pouvez fermer cette page, puis retirer la variable QR_KEY.</p>`);
    }
    const qr = currentQr();
    if (!qr) {
      return page(`<h2>Connexion en cours…</h2><p>Le QR code arrive dans quelques secondes (la page se rafraîchit seule).</p>`);
    }
    const image = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
    page(`<h2>Scannez avec WhatsApp</h2><p>Paramètres → Appareils connectés → Connecter un appareil</p>
<img src="${image}" width="320" height="320" alt="QR code WhatsApp"><p style="color:#6b7280;font-size:14px">Le code change toutes les 20 secondes environ ; la page se met à jour seule.</p>`);
  } catch (err) {
    next(err);
  }
});

// Empreinte d'une clé pour les logs : longueur + 8 caractères d'un hash. Permet de comparer la clé
// envoyée par le backend et celle du service SANS jamais écrire la clé elle-même.
const fingerprintOf = (value) =>
  value ? `longueur ${value.length}, empreinte ${createHash("sha256").update(value).digest("hex").slice(0, 8)}` : "absente";
let lastAuthLog = 0;
function logRefusedKey(req, given, expected) {
  const now = Date.now();
  if (now - lastAuthLog < 10_000) return; // au plus un log toutes les 10 s
  lastAuthLog = now;
  console.warn(
    `[auth] ${req.method} ${req.path} refusé — clé reçue : ${fingerprintOf(given)} ; clé attendue (API_KEY) : ${expected ? fingerprintOf(expected) : "API_KEY non définie"}`,
  );
}

app.use((req, res, next) => {
  const expected = envKey("API_KEY");
  // La clé reçue est lue sans espaces ni guillemets parasites, comme la clé attendue.
  const given = String(req.header("x-api-key") ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!expected || !sameKey(given, expected)) {
    logRefusedKey(req, given, expected);
    return res.status(401).json({ error: "Clé API invalide ou manquante." });
  }
  next();
});

/** Digits only, international format without "+"; 10 digits get the default country code. */
function normalizePhone(input) {
  let digits = String(input ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

app.get("/health", (_req, res) => {
  res.json({
    ready: isReady(),
    queueLength: queueLength(),
    // Détails pour diagnostiquer : état de la connexion WhatsApp, dernière fermeture, stockage de la session.
    whatsapp: getStatus(),
    stockageSession: process.env.SESSION_STORE === "supabase" ? "supabase" : "fichiers",
    enMarcheDepuisSecondes: Math.round(process.uptime()),
  });
});

app.get("/templates", (_req, res) => {
  res.json({ templates: listTemplates() });
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Queues once per Idempotency-Key (or identical payload within 60 s). */
async function queueOnce(req, res, scope, phone, message) {
  const { value, duplicate } = await runOnce(
    req,
    scope,
    fingerprint(scope, phone, message),
    async () => {
      enqueue(phone, message);
      return { queued: true, queueLength: queueLength() };
    },
  );
  res.status(202).json({ ...value, duplicate });
}

app.post("/notify", wrap(async (req, res) => {
  const { type, phone, data } = req.body || {};
  const template = Object.hasOwn(templates, type) ? templates[type] : null;
  if (!template) {
    return res.status(400).json({
      error: `Type inconnu : « ${type ?? ""} ».`,
      types: Object.keys(templates),
    });
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: "Numéro de téléphone invalide." });

  const values = data && typeof data === "object" ? data : {};
  const missing = template.required.filter((f) => !values[f]);
  if (missing.length) {
    return res.status(400).json({ error: "Champs manquants dans data.", missing });
  }

  await queueOnce(req, res, "notify", normalized, template.build(values).slice(0, MAX_MESSAGE_LENGTH));
}));

app.post("/send", wrap(async (req, res) => {
  const { phone, message } = req.body || {};
  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: "Numéro de téléphone invalide." });
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message manquant." });
  }
  await queueOnce(req, res, "send", normalized, message.slice(0, MAX_MESSAGE_LENGTH));
}));

// ---------- Diffusion de masse (annonces à plusieurs personnes) ----------
// Les messages partent dans une file séparée, derrière les messages urgents.
// {prenom} et {nom} dans le texte sont remplacés pour chaque personne.
app.post("/broadcast", wrap(async (req, res) => {
  const { campaignId, message, recipients } = req.body || {};

  if (typeof campaignId !== "string" || !/^[\w:-]{8,100}$/.test(campaignId)) {
    return res.status(400).json({ error: "campaignId invalide (8 à 100 caractères : lettres, chiffres, - _ :)." });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message manquant." });
  }
  if (message.length > BROADCAST_MAX_LENGTH) {
    return res.status(400).json({ error: `message trop long (${BROADCAST_MAX_LENGTH} caractères maximum).` });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "recipients doit être une liste non vide." });
  }
  if (recipients.length > BROADCAST_MAX_RECIPIENTS) {
    return res.status(400).json({ error: `Trop de destinataires (${BROADCAST_MAX_RECIPIENTS} maximum).` });
  }

  // Même campagne rejouée (retry) : on renvoie son état, sans rien remettre en file.
  if (hasCampaign(campaignId)) {
    return res.status(202).json({ ...campaignSummary(campaignId), duplicate: true });
  }

  // Numéros normalisés, invalides et doublons écartés.
  const seen = new Set();
  const entries = [];
  let invalid = 0;
  let duplicates = 0;
  for (const person of recipients) {
    const phone = normalizePhone(person?.phone);
    if (!phone) {
      invalid += 1;
    } else if (seen.has(phone)) {
      duplicates += 1;
    } else {
      seen.add(phone);
      entries.push({
        phone,
        original: String(person.phone ?? ""), // numéro tel que fourni (pour le détail des échecs)
        prenom: String(person.prenom ?? ""),
        nom: String(person.nom ?? ""),
      });
    }
  }
  if (entries.length === 0) {
    return res.status(400).json({ error: "Aucun numéro valide parmi les destinataires.", invalid });
  }

  const { value, duplicate } = await runOnce(
    req,
    "broadcast",
    fingerprint(campaignId, message, entries.map((e) => e.phone)),
    async () => ({ ...enqueueCampaign(campaignId, entries, message), invalid, duplicates }),
  );
  console.log(`[broadcast] campagne ${campaignId} : ${entries.length} message(s) en file`);
  res.status(202).json({ ...value, duplicate });
}));

app.get("/campaigns/:id", (req, res) => {
  const summary = campaignSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: "Campagne introuvable (ou service redémarré)." });
  res.json(summary);
});

// Annule ce qui n'est pas encore parti (les messages déjà envoyés restent envoyés).
app.delete("/campaigns/:id", (req, res) => {
  const summary = cancelCampaign(req.params.id);
  if (!summary) return res.status(404).json({ error: "Campagne introuvable (ou service redémarré)." });
  res.json(summary);
});

app.use((_req, res) => res.status(404).json({ error: "Route introuvable." }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof IdempotencyError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON invalide." });
  }
  console.error("[wa-service]", err);
  res.status(500).json({ error: "Erreur interne." });
});

if (!envKey("API_KEY")) {
  console.error("API_KEY non défini : toutes les requêtes seront refusées (401).");
}

// On recharge la file sauvegardée AVANT d'accepter des requêtes. Si le stockage est
// injoignable, on s'arrête : l'hébergeur relance le service (jamais d'écrasement par une file vide).
try {
  await initQueue();
} catch (err) {
  console.error("Impossible de recharger la file d'attente :", err.message);
  process.exit(1);
}

const server = app.listen(PORT, () => console.log(`wa-service sur le port ${PORT}`));
startWhatsApp().catch((err) => console.error("Démarrage WhatsApp :", err));

// Arrêt propre (docker stop, redémarrage) : on sauvegarde la file avant de quitter.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} reçu : sauvegarde de la file et de la session, puis arrêt.`);
    Promise.allSettled([saveNow(), flushAuth()]).finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
