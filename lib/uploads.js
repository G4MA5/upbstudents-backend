// Direct-to-storage uploads. Vercel functions reject request bodies above
// 4.5 MB, so files are sent by the browser straight to Supabase Storage via
// a short-lived signed URL; the API only handles metadata and verification.
import { HttpError } from "./http.js";
import { supabaseAdmin } from "./supabaseClient.js";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from "./validation.js";

export async function createUploadUrl(bucket, path, { upsert = false } = {}) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUploadUrl(path, { upsert });
  if (error) {
    console.error("[uploads] URL signée", error);
    throw new HttpError(
      500,
      "Impossible de préparer l'envoi du fichier. Veuillez réessayer.",
    );
  }
  return { uploadUrl: data.signedUrl, path };
}

async function readObjectInfo(bucket, path) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).info(path);
  if (!error && data) {
    return { size: Number(data.size), contentType: data.contentType };
  }

  // Fallback for storage versions without the /object/info endpoint.
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data: list, error: listError } = await supabaseAdmin.storage
    .from(bucket)
    .list(folder, { search: name, limit: 100 });
  if (listError) throw listError;
  const item = list?.find((f) => f.name === name);
  if (!item) return null;
  return {
    size: Number(item.metadata?.size),
    contentType: item.metadata?.mimetype,
  };
}

/**
 * Checks that the file really reached storage and still respects the type
 * and size limits (a signed URL cannot enforce them). Invalid files are
 * removed.
 */
export async function verifyUploadedObject(bucket, path) {
  const info = await readObjectInfo(bucket, path);
  if (!info) {
    throw new HttpError(
      400,
      "Le fichier n'a pas été reçu. Veuillez relancer l'envoi.",
    );
  }
  const typeOk = Boolean(ALLOWED_FILE_TYPES[info.contentType]);
  const sizeOk = info.size > 0 && info.size <= MAX_FILE_SIZE;
  if (!typeOk || !sizeOk) {
    await supabaseAdmin.storage.from(bucket).remove([path]);
    throw new HttpError(
      400,
      sizeOk
        ? "Format non pris en charge. Formats acceptés : PDF, DOC, DOCX, PNG, JPG."
        : "Le fichier dépasse la taille maximale de 20 Mo.",
    );
  }
  return info;
}
