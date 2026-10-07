// Pièce jointe d'une diffusion (sticker ou image), stockée UNE fois par campagne (pas par destinataire).
//  - par défaut : fichier DATA_DIR/media/<campagne>.json
//  - SESSION_STORE=supabase : ligne "media:<campagne>" de wa_state (disque éphémère)
// Elle est gardée en mémoire pendant l'envoi puis supprimée à la fin de la campagne.
import fs from "node:fs";
import path from "node:path";
import * as remote from "./remote.js";

const DIR = path.join(process.env.DATA_DIR || "data", "media");
const cache = new Map(); // id → { type, mimetype, buffer }

const safe = (id) => String(id).replace(/[^\w-]/g, "_");
const fileOf = (id) => path.join(DIR, `${safe(id)}.json`);
const keyOf = (id) => `media:${id}`;

/** media : { type: "sticker" | "image", mimetype, buffer } */
export async function saveMedia(id, media) {
  cache.set(id, media);
  const stored = { type: media.type, mimetype: media.mimetype, b64: media.buffer.toString("base64") };
  if (remote.remoteEnabled()) {
    await remote.upsertMany([{ key: keyOf(id), value: stored }]);
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileOf(id), JSON.stringify(stored));
  }
}

/** Retourne { type, mimetype, buffer }, ou null si la pièce jointe n'existe plus. */
export async function loadMedia(id) {
  if (cache.has(id)) return cache.get(id);
  let stored = null;
  if (remote.remoteEnabled()) {
    stored = await remote.getOne(keyOf(id));
  } else {
    try {
      stored = JSON.parse(fs.readFileSync(fileOf(id), "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  if (!stored) return null;
  const media = { type: stored.type, mimetype: stored.mimetype, buffer: Buffer.from(stored.b64, "base64") };
  cache.set(id, media);
  return media;
}

export async function deleteMedia(id) {
  cache.delete(id);
  try {
    if (remote.remoteEnabled()) await remote.removeKeys([keyOf(id)]);
    else fs.rmSync(fileOf(id), { force: true });
  } catch (err) {
    console.error("[media] suppression impossible :", err.message);
  }
}

/** Reconnaît le format réel du fichier (signature des premiers octets), sans se fier à ce que dit le client. */
export function sniffImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("latin1", 1, 4) === "PNG" && buffer[0] === 0x89) return "image/png";
  return null;
}
