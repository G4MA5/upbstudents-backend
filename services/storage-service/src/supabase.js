import { createClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_BUCKET || "documents";
const USAGE_TTL_MS = 5 * 60_000;
const PAGE_SIZE = 1000;

let client = null;
let usage = { bytes: 0, fetchedAt: 0, known: false };

function getClient() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY non définis");
    }
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

/** Sums metadata.size of every file in the bucket (recursive listing). */
async function sumFolder(prefix) {
  const storage = getClient().storage.from(BUCKET);
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await storage.list(prefix, {
      limit: PAGE_SIZE,
      offset,
    });
    if (error) throw error;
    for (const item of data) {
      if (item.id === null || !item.metadata) {
        // Folders have no id/metadata: descend into them.
        total += await sumFolder(prefix ? `${prefix}/${item.name}` : item.name);
      } else {
        total += Number(item.metadata.size) || 0;
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return total;
}

/** Usage in bytes, cached for 5 minutes and bumped locally after uploads. */
export async function getUsageBytes() {
  if (usage.known && Date.now() - usage.fetchedAt < USAGE_TTL_MS) {
    return usage.bytes;
  }
  try {
    usage = { bytes: await sumFolder(""), fetchedAt: Date.now(), known: true };
  } catch (err) {
    // Keep serving the last known value; never block uploads on a listing error.
    console.error("[supabase] calcul de l'usage impossible :", err.message);
    if (!usage.known) return null;
  }
  return usage.bytes;
}

function bumpUsage(delta) {
  if (usage.known) usage.bytes = Math.max(0, usage.bytes + delta);
}

export async function upload(key, buffer, contentType) {
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(key, buffer, { contentType, upsert: false });
  if (error) throw error;
  bumpUsage(buffer.length);
}

export async function signedUrl(key, expiresInSeconds = 3600) {
  const { data, error } = await getClient()
    .storage.from(BUCKET)
    .createSignedUrl(key, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function remove(key) {
  const { error } = await getClient().storage.from(BUCKET).remove([key]);
  if (error) throw error;
  // The size of the deleted file is unknown here: refresh on next read.
  usage.fetchedAt = 0;
}
