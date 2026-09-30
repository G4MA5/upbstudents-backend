// Public contribution: anyone can propose a document. It is stored in a
// PRIVATE bucket with the status "en_attente" and is never listed in the
// library until an administrator reviews and publishes it.
//   1. { action: "prepare", ...proposal, fileName, fileType, fileSize }
//   2. the browser uploads the file to the signed URL
//   3. { action: "finalize", ...proposal, fileName, path, expires, ticket }
import { randomUUID } from "node:crypto";
import {
  adminEmail,
  FRONTEND_URL,
  PROPOSALS_BUCKET,
} from "../../../../lib/config.js";
import {
  clientIp,
  HttpError,
  ok,
  optionalUser,
  preflight,
  readJson,
  route,
} from "../../../../lib/http.js";
import {
  detailsTable,
  emailLayout,
  isMailConfigured,
  sendMail,
} from "../../../../lib/mailer.js";
import {
  checkTicket,
  ensureProposalsBucket,
  isMissingTable,
  PROPOSALS_TABLE,
  readProposal,
  signTicket,
} from "../../../../lib/proposals.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import {
  ALLOWED_FILE_TYPES,
  clean,
  escapeHtml,
  validateFile,
} from "../../../../lib/validation.js";
import {
  createUploadUrl,
  verifyUploadedObject,
} from "../../../../lib/uploads.js";

const UPLOAD_WINDOW_MS = 90 * 60_000;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

async function prepare(req, body) {
  const proposal = readProposal(body);
  validateFile(body);
  rateLimit(`proposer:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60_000 });

  await ensureProposalsBucket();
  const month = new Date().toISOString().slice(0, 7);
  const path = `${month}/${randomUUID()}.${ALLOWED_FILE_TYPES[body.fileType]}`;
  const upload = await createUploadUrl(PROPOSALS_BUCKET, path);
  const expires = Date.now() + UPLOAD_WINDOW_MS;

  return ok(req, {
    ...upload,
    expires,
    ticket: signTicket(path, proposal.email, expires),
  });
}

async function notifyAdmin(proposal, file, id) {
  const to = adminEmail();
  if (!to || !isMailConfigured()) return false;

  const { data: signed } = await supabaseAdmin.storage
    .from(PROPOSALS_BUCKET)
    .createSignedUrl(file.path, 7 * 24 * 3600, {
      download: file.name || true,
    });

  const reviewUrl = `${FRONTEND_URL}/propositions`;
  await sendMail({
    to,
    replyTo: proposal.email,
    subject: `[Proposition] ${proposal.type} · ${proposal.filiere} · ${proposal.matiere}`,
    text: [
      "Un nouveau document a été proposé et attend votre validation.",
      "",
      `Proposé par : ${proposal.nom} <${proposal.email}>`,
      `Type : ${proposal.type}`,
      `Filière : ${proposal.filiere}`,
      `Niveau : ${proposal.niveau}`,
      `Matière : ${proposal.matiere}`,
      `Année : ${proposal.annee}`,
      proposal.session ? `Session : ${proposal.session}` : "",
      proposal.description ? `Description : ${proposal.description}` : "",
      "",
      signed?.signedUrl ? `Télécharger le fichier (7 jours) : ${signed.signedUrl}` : "",
      `Examiner les propositions : ${reviewUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
    html: emailLayout(
      "Nouvelle proposition",
      `<p>Un nouveau document a été proposé et <strong>attend votre validation</strong>. Il n'est pas visible dans la bibliothèque.</p>
${detailsTable([
  ["Référence", id ? `#${id}` : ""],
  ["Proposé par", `${proposal.nom} (${proposal.email})`],
  ["Type", proposal.type],
  ["Filière", proposal.filiere],
  ["Niveau", proposal.niveau],
  ["Matière", proposal.matiere],
  ["Année", proposal.annee],
  ["Session", proposal.session],
  ["Fichier", `${file.name || "document"} · ${formatSize(file.size)}`],
])}
${proposal.description ? `<div style="margin-top:12px;padding:12px;background:#f9fafb;border-radius:12px;white-space:pre-wrap">${escapeHtml(proposal.description)}</div>` : ""}
<p style="margin-top:20px">
${signed?.signedUrl ? `<a href="${escapeHtml(signed.signedUrl)}" style="display:inline-block;background:#f47b20;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold;margin-right:8px">Télécharger le fichier</a>` : ""}
<a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#16325c;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Examiner les propositions</a>
</p>
<p style="color:#6b7280;font-size:12px">Le lien de téléchargement expire dans 7 jours.</p>`,
    ),
  });
  return true;
}

async function acknowledge(proposal) {
  if (!isMailConfigured()) return false;
  try {
    await sendMail({
      to: proposal.email,
      subject: "Votre proposition de document a bien été reçue",
      text: `Bonjour ${proposal.nom},\n\nMerci pour votre contribution ! Votre document « ${proposal.matiere} » (${proposal.type}, ${proposal.filiere}) a bien été reçu. Il sera examiné par l'équipe de la bibliothèque avant publication.\n\nL'équipe UpB Student's`,
      html: emailLayout(
        "Proposition reçue",
        `<p>Bonjour ${escapeHtml(proposal.nom)},</p><p>Merci pour votre contribution ! Votre document <strong>« ${escapeHtml(proposal.matiere)} »</strong> (${escapeHtml(proposal.type)}, ${escapeHtml(proposal.filiere)}) a bien été reçu.</p><p>Il sera examiné par l'équipe de la bibliothèque avant d'être publié.</p><p>L'équipe UpB Student's</p>`,
      ),
    });
    return true;
  } catch {
    // Confirmation to the contributor is a courtesy; never fail on it.
    return false;
  }
}

async function finalize(req, body) {
  const proposal = readProposal(body);
  checkTicket({ ...body, email: proposal.email });
  const user = await optionalUser(req);

  const info = await verifyUploadedObject(PROPOSALS_BUCKET, body.path);
  const file = {
    path: body.path,
    name: clean(body.fileName, 150),
    type: info.contentType,
    size: info.size,
  };

  let id = null;
  let stored = false;
  const { data: row, error } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .insert([
      {
        ...proposal,
        user_id: user?.id || null,
        statut: "en_attente",
        fichier_path: file.path,
        fichier_nom: file.name,
        fichier_type: file.type,
        fichier_taille: file.size,
      },
    ])
    .select("id")
    .single();

  if (!error) {
    id = row.id;
    stored = true;
  } else if (error.code === "23505") {
    // Same upload finalized twice (double click, retry): already recorded.
    return ok(req, { message: "Votre proposition a déjà été enregistrée." });
  } else if (!isMissingTable(error)) {
    throw error;
  } else {
    console.error("[proposer] table « proposition » absente : appliquez la migration");
  }

  let notified = false;
  try {
    notified = await notifyAdmin(proposal, file, id);
  } catch (err) {
    console.error("[proposer] notification", err);
  }

  if (!stored && !notified) {
    throw new HttpError(
      502,
      "Votre proposition n'a pas pu être transmise. Veuillez réessayer plus tard ou nous contacter.",
    );
  }

  const confirmationSent = await acknowledge(proposal);

  return ok(req, {
    id,
    confirmation_envoyee: confirmationSent,
    message:
      "Merci ! Votre document a été transmis à l'équipe de la bibliothèque. Il sera publié après vérification.",
  });
}

export const POST = route(async (req) => {
  const body = await readJson(req);
  // Honeypot: invisible field that only bots fill in.
  if (body.website) return ok(req, { message: "Proposition reçue." });

  if (body.action === "prepare") return prepare(req, body);
  if (body.action === "finalize") return finalize(req, body);
  throw new HttpError(400, "Requête invalide.");
});

export const OPTIONS = preflight();
