import { HttpError } from "./http.js";

// Best-effort limiter: counters live in the memory of one serverless
// instance, so this slows down abuse without guaranteeing a global quota.
const buckets = new Map();

export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryIn = Math.ceil((windowMs - (now - hits[0])) / 60000);
    throw new HttpError(
      429,
      `Trop de tentatives. Veuillez réessayer dans ${retryIn} minute${retryIn > 1 ? "s" : ""}.`,
    );
  }
  hits.push(now);
  buckets.set(key, hits);

  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
}
