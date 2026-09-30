// Review of proposed documents, reserved to authorized contributors.
//   GET                                   → pending proposals
//   POST { action: "publier", id, password, ...metadata } → published
//   POST { action: "refuser", id, motif? }                → refused
import { DOCUMENTS_BUCKET, PROPOSALS_BUCKET } from "../../../../lib/config.js";
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
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import {
  emailLayout,
  isMailConfigured,
  sendMail,
} from "../../../../lib/mailer.js";
import { isMissingTable, PROPOSALS_TABLE } from "../../../../lib/proposals.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import { clean, escapeHtml } from "../../../../lib/validation.js";

const MIGRATION_MISSING =
  "La file de validation n'est pas encore activée sur le serveur. Les propositions sont transmises par e-mail en attendant.";

async function requireReviewer(req) {
  const { user } = await requireUser(req);
  const profile = await loadProfile(user);
  if (!profile.proprietaire) {
    throw new HttpError(
      403,
      "Cet espace est réservé aux contributeurs autorisés.",
    );
  }
  return profile;
}

async function findPending(id) {
  const { data, error } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new HttpError(503, MIGRATION_MISSING);
    throw error;
  }
  if (!data) throw new HttpError(404, "Cette proposition n'existe plus.");
  if (data.statut !== "en_attente") {
    throw new HttpError(409, "Cette proposition a déjà été traitée.");
  }
  return data;
}

async function tellContributor(proposal, subject, message) {
  if (!isMailConfigured() || !proposal.email) return;
  try {
    await sendMail({
      to: proposal.email,
      subject,
      text: `Bonjour ${proposal.nom},\n\n${message}\n\nL'équipe UpB Student's`,
      html: emailLayout(
        subject,
        `<p>Bonjour ${escapeHtml(proposal.nom)},</p><p>${escapeHtml(message)}</p><p>L'équipe UpB Student's</p>`,
      ),
    });
  } catch {
    // Courtesy e-mail only.
  }
}

export const GET = route(async (req) => {
  await requireReviewer(req);

  const { data, error } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select("*")
    .eq("statut", "en_attente")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    if (isMissingTable(error)) {
      return ok(req, { propositions: [], disponible: false, message: MIGRATION_MISSING });
    }
    throw error;
  }

  const paths = data.map((p) => p.fichier_path);
  const { data: signed } = paths.length
    ? await supabaseAdmin.storage
        .from(PROPOSALS_BUCKET)
        .createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((signed || []).map((s) => [s.path, s.signedUrl]));

  return ok(req, {
    disponible: true,
    propositions: data.map((p) => ({
      id: p.id,
      created_at: p.created_at,
      nom: p.nom,
      email: p.email,
      filiere: p.filiere,
      niveau: p.niveau,
      type: p.type,
      matiere: p.matiere,
      annee: p.annee,
      session: p.session,
      description: p.description,
      fichier_nom: p.fichier_nom,
      fichier_type: p.fichier_type,
      fichier_taille: p.fichier_taille,
      file_url: urls.get(p.fichier_path) || null,
    })),
  });
});

export const POST = route(async (req) => {
  const reviewer = await requireReviewer(req);
  const body = await readJson(req);
  const proposal = await findPending(body.id);

  if (body.action === "refuser") {
    const motif = clean(body.motif, 300);
    const { error } = await supabaseAdmin
      .from(PROPOSALS_TABLE)
      .update({ statut: "refusee", motif: motif || null, traite_le: new Date().toISOString() })
      .eq("id", proposal.id);
    if (error) throw error;
    await supabaseAdmin.storage.from(PROPOSALS_BUCKET).remove([proposal.fichier_path]);
    await tellContributor(
      proposal,
      "Votre proposition de document",
      `Merci pour votre proposition « ${proposal.matiere} ». Après examen, elle n'a pas pu être publiée.${motif ? ` Motif : ${motif}` : ""}`,
    );
    return ok(req, { message: "La proposition a été refusée." });
  }

  if (body.action === "publier") {
    checkUploadPassword(body.password);
    // The reviewer may correct the metadata before publishing.
    const meta = readMetadata({ ...proposal, ...body });
    const filename = storageName(meta);
    await assertNotDuplicate(filename);

    const { error: copyError } = await supabaseAdmin.storage
      .from(PROPOSALS_BUCKET)
      .copy(proposal.fichier_path, filename, {
        destinationBucket: DOCUMENTS_BUCKET,
      });
    if (copyError) {
      console.error("[propositions] copie", copyError);
      throw new HttpError(500, "Le fichier n'a pas pu être publié. Veuillez réessayer.");
    }

    const document = await publish(meta, filename, reviewer);

    const { error: updateError } = await supabaseAdmin
      .from(PROPOSALS_TABLE)
      .update({
        statut: "publiee",
        document_id: document.id,
        traite_le: new Date().toISOString(),
      })
      .eq("id", proposal.id);
    if (updateError) console.error("[propositions] statut", updateError);

    await supabaseAdmin.storage.from(PROPOSALS_BUCKET).remove([proposal.fichier_path]);
    await tellContributor(
      proposal,
      "Votre document est en ligne",
      `Bonne nouvelle : votre document « ${meta.matiere} » a été vérifié et publié dans la bibliothèque. Merci pour votre contribution !`,
    );
    return ok(req, { document, message: "Le document a été publié dans la bibliothèque." });
  }

  throw new HttpError(400, "Requête invalide.");
});

export const OPTIONS = preflight();
