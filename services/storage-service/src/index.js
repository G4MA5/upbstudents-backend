import "dotenv/config";
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import multer from "multer";
import * as cloud from "./cloudinary.js";
import { fingerprint, IdempotencyError, runOnce } from "./idempotency.js";
import * as supa from "./supabase.js";

// Comparaison de la clé en temps constant (évite de deviner la clé par mesure du temps de réponse).
const sameKey = (given, expected) =>
  timingSafeEqual(
    createHash("sha256").update(String(given ?? "")).digest(),
    createHash("sha256").update(String(expected)).digest(),
  );

const PORT = Number(process.env.PORT) || 3002;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const LIMIT_GB = Number(process.env.SUPABASE_LIMIT_GB) || 4.5;
const LIMIT_BYTES = LIMIT_GB * 1024 ** 3;
const PROVIDERS = ["supabase", "cloudinary"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

// Every route requires the shared secret.
app.use((req, res, next) => {
  const expected = process.env.API_KEY;
  if (!expected || !sameKey(req.header("x-api-key"), expected)) {
    return res.status(401).json({ error: "Clé API invalide ou manquante." });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** timestamp-nomfichier, safe for storage keys. */
function storageKey(originalName) {
  const safe = String(originalName || "fichier")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-120);
  return `${Date.now()}-${safe || "fichier"}`;
}

function requireProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new HttpError(400, "provider doit valoir « supabase » ou « cloudinary ».");
  }
}

const toGB = (bytes) =>
  bytes === null ? null : Number((bytes / 1024 ** 3).toFixed(3));

app.get(
  "/health",
  wrap(async (_req, res) => {
    let usage = null;
    try {
      usage = await supa.getUsageBytes();
    } catch {
      // Reported as null below.
    }
    res.json({ ok: true, supabaseUsageGB: toGB(usage), limitGB: LIMIT_GB });
  }),
);

/** Stores the file once; returns the body sent to the client. */
async function storeFile(file) {
  const key = storageKey(file.originalname);
  const contentType = file.mimetype || "application/octet-stream";

  // 1. Supabase first, unless the quota would be exceeded.
  const usage = await supa.getUsageBytes();
  const hasRoom = usage === null || usage + file.size <= LIMIT_BYTES;
  let fallback = false;

  if (hasRoom) {
    try {
      await supa.upload(key, file.buffer, contentType);
      return { provider: "supabase", key, fallback: false };
    } catch (err) {
      console.error("[upload] échec Supabase, bascule Cloudinary :", err.message);
      fallback = true;
    }
  }

  // 2. Cloudinary (quota reached or Supabase failure).
  try {
    const publicId = await cloud.upload(key, file.buffer);
    return { provider: "cloudinary", key: publicId, fallback };
  } catch (err) {
    console.error("[upload] échec Cloudinary :", err.message);
    throw new HttpError(502, "Aucun fournisseur de stockage disponible.");
  }
}

app.post(
  "/upload",
  upload.single("file"),
  wrap(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "Champ « file » manquant (multipart).");

    // Same Idempotency-Key (or same file within 60 s) → same stored file.
    const { value, duplicate } = await runOnce(
      req,
      "upload",
      fingerprint(file.buffer, file.originalname, file.mimetype),
      () => storeFile(file),
    );
    res.status(duplicate ? 200 : 201).json({ ...value, duplicate });
  }),
);


app.get(
  "/url",
  wrap(async (req, res) => {
    const { provider, key } = req.query;
    requireProvider(provider);
    if (!key || typeof key !== "string") throw new HttpError(400, "key manquant.");
    try {
      const url =
        provider === "supabase" ? await supa.signedUrl(key, 3600) : cloud.url(key, 3600);
      res.json({ url, expiresIn: 3600 });
    } catch (err) {
      console.error("[url]", err.message);
      throw new HttpError(502, "Impossible de générer le lien.");
    }
  }),
);

app.delete(
  "/file",
  wrap(async (req, res) => {
    const { provider, key } = req.body || {};
    requireProvider(provider);
    if (!key || typeof key !== "string") throw new HttpError(400, "key manquant.");
    try {
      if (provider === "supabase") await supa.remove(key);
      else await cloud.remove(key);
      res.json({ deleted: true }); // idempotent: deleting a missing file also succeeds
    } catch (err) {
      console.error("[delete]", err.message);
      throw new HttpError(502, "Suppression impossible.");
    }
  }),
);

app.use((_req, res) => res.status(404).json({ error: "Route introuvable." }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? "Fichier trop volumineux (10 Mo maximum)." : err.message,
    });
  }
  if (err instanceof IdempotencyError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON invalide." });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[storage-service]", err);
  res.status(500).json({ error: "Erreur interne." });
});

if (!process.env.API_KEY) {
  console.error("API_KEY non défini : toutes les requêtes seront refusées (401).");
}
const server = app.listen(PORT, () => console.log(`storage-service sur le port ${PORT}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
