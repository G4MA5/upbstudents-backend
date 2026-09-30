// Direct publication by an authorized contributor (signed-in user who knows
// the upload password). Two JSON steps around a direct upload to storage:
//   1. { action: "prepare", ...metadata, fileType, fileSize } → signed URL
//   2. the browser PUTs the file to that URL
//   3. { action: "finalize", ...metadata, path } → the document is published
// A multipart request (old client) is still accepted for small files.
import { DOCUMENTS_BUCKET } from "../../../../lib/config.js";
import {
  assertNotDuplicate,
  checkUploadPassword,
  publish,
  readMetadata,
  storageName,
} from "../../../../lib/documents.js";
import {
  HttpError,
  loadProfile,
  ok,
  preflight,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import {
  createUploadUrl,
  verifyUploadedObject,
} from "../../../../lib/uploads.js";
import { validateFile } from "../../../../lib/validation.js";

async function handleMultipart(req, profile) {
  const form = await req.formData();
  const fields = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string"),
  );
  checkUploadPassword(fields.password);
  const meta = readMetadata(fields);

  const file = form.get("document");
  if (!file || typeof file === "string") {
    throw new HttpError(400, "Aucun fichier fourni.");
  }
  validateFile({ fileType: file.type, fileSize: file.size });

  const filename = storageName(meta);
  await assertNotDuplicate(filename);

  const { error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filename, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
    });
  if (error) throw error;

  return publish(meta, filename, profile);
}

export const POST = route(async (req) => {
  const { user } = await requireUser(req);
  rateLimit(`document:${user.id}`, { limit: 30, windowMs: 60 * 60_000 });
  const profile = await loadProfile(user);

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const document = await handleMultipart(req, profile);
    return ok(req, { document, message: "Le document a été publié." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Requête invalide.");
  }

  checkUploadPassword(body.password);
  const meta = readMetadata(body);
  const filename = storageName(meta);

  if (body.action === "prepare") {
    validateFile(body);
    await assertNotDuplicate(filename);
    // upsert: an earlier upload interrupted before step 3 left an unlisted
    // file with this name; it can safely be replaced.
    const upload = await createUploadUrl(DOCUMENTS_BUCKET, filename, {
      upsert: true,
    });
    return ok(req, upload);
  }

  if (body.action === "finalize") {
    if (body.path !== filename) {
      throw new HttpError(
        400,
        "Les informations du document ont changé pendant l'envoi. Veuillez recommencer.",
      );
    }
    await assertNotDuplicate(filename);
    await verifyUploadedObject(DOCUMENTS_BUCKET, filename);
    const document = await publish(meta, filename, profile);
    return ok(req, { document, message: "Le document a été publié." });
  }

  throw new HttpError(400, "Requête invalide.");
});

export const OPTIONS = preflight();
