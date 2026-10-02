// In-memory idempotency guard.
//  - Explicit key: header "Idempotency-Key" (kept 24 h). Replaying the same
//    key with the same payload returns the first result without redoing the
//    work; the same key with a different payload is rejected (422).
//  - No key: an identical payload received again within 60 s is treated as a
//    duplicate (double click, client retry).
// Concurrent duplicates share the same in-flight promise. Failures are not
// remembered, so a failed request can be retried. State is per process and
// lost on restart.
import { createHash } from "node:crypto";

const EXPLICIT_TTL_MS = 24 * 60 * 60_000;
const AUTO_TTL_MS = 60_000;
const MAX_ENTRIES = 5000;
const MAX_KEY_LENGTH = 200;

const store = new Map();

export class IdempotencyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fingerprint = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(typeof part === "string" || Buffer.isBuffer(part) ? part : JSON.stringify(part)).update("\0");
  return hash.digest("hex");
};

function sweep() {
  const now = Date.now();
  for (const [id, entry] of store) if (entry.expires <= now) store.delete(id);
  // Map keeps insertion order: drop the oldest entries if still too large.
  for (const id of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(id);
  }
}

/**
 * @param {import("express").Request} req
 * @param {string} scope  route name
 * @param {string} fp     fingerprint of the payload
 * @param {() => Promise<any>} work
 * @returns {Promise<{ value: any, duplicate: boolean }>}
 */
export async function runOnce(req, scope, fp, work) {
  const header = req.header("idempotency-key");
  if (header && header.length > MAX_KEY_LENGTH) {
    throw new IdempotencyError(400, "Idempotency-Key trop long (200 caractères maximum).");
  }
  const id = header ? `k:${scope}:${header}` : `f:${scope}:${fp}`;
  const ttl = header ? EXPLICIT_TTL_MS : AUTO_TTL_MS;

  sweep();
  const hit = store.get(id);
  if (hit) {
    if (hit.fp !== fp) {
      throw new IdempotencyError(422, "Cette Idempotency-Key a déjà été utilisée avec un contenu différent.");
    }
    return { value: await hit.promise, duplicate: true };
  }

  const promise = Promise.resolve().then(work);
  store.set(id, { fp, promise, expires: Date.now() + ttl });
  try {
    return { value: await promise, duplicate: false };
  } catch (err) {
    if (store.get(id)?.promise === promise) store.delete(id);
    throw err;
  }
}
