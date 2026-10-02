// One WhatsApp template per existing e-mail. Each receives the same data as
// the e-mail and returns plain text (*bold*, sober emojis, links as text).
// `required` fields are validated by /notify; `optional` ones are documented.

const SIGNATURE = "— L'équipe UpB Student's";

const line = (label, value) => (value ? `${label} : ${value}` : null);
// null/undefined/false are skipped; "" is kept as a blank line.
const lines = (...parts) =>
  parts.filter((p) => p !== null && p !== undefined && p !== false).join("\n");

function formatSize(bytes) {
  const n = Number(bytes);
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export const templates = {
  // api/contact → admin
  contact_message: {
    description: "Nouveau message du formulaire de contact (destinataire : admin).",
    required: ["nom", "email", "objet", "message"],
    optional: [],
    build: (d) =>
      lines(
        "📩 *Nouveau message de contact*",
        "",
        line("*Nom*", d.nom),
        line("*E-mail*", d.email),
        line("*Objet*", d.objet),
        "",
        d.message,
      ),
  },

  // api/proposer → admin (notifyAdmin)
  proposal_admin: {
    description: "Nouvelle proposition de document à valider (destinataire : admin).",
    required: ["nom", "email", "type", "filiere", "niveau", "matiere", "annee"],
    optional: ["id", "session", "fileName", "fileSize", "description", "downloadUrl", "reviewUrl"],
    build: (d) =>
      lines(
        "📄 *Nouvelle proposition de document*",
        "Elle attend votre validation (non visible dans la bibliothèque).",
        "",
        line("*Référence*", d.id ? `#${d.id}` : ""),
        line("*Proposé par*", `${d.nom} (${d.email})`),
        line("*Type*", d.type),
        line("*Filière*", d.filiere),
        line("*Niveau*", d.niveau),
        line("*Matière*", d.matiere),
        line("*Année*", d.annee),
        line("*Session*", d.session),
        line(
          "*Fichier*",
          [d.fileName, formatSize(d.fileSize)].filter(Boolean).join(" · "),
        ),
        d.description ? `\n*Description* :\n${d.description}` : null,
        d.downloadUrl ? `\n⬇️ Télécharger le fichier (7 jours) :\n${d.downloadUrl}` : null,
        d.reviewUrl ? `\n✅ Examiner les propositions :\n${d.reviewUrl}` : null,
      ),
  },

  // api/proposer → contributor (acknowledge)
  proposal_received: {
    description: "Accusé de réception d'une proposition (destinataire : contributeur).",
    required: ["nom", "matiere", "type", "filiere"],
    optional: [],
    build: (d) =>
      lines(
        `Bonjour ${d.nom},`,
        "",
        `✅ Merci pour votre contribution ! Votre document *« ${d.matiere} »* (${d.type}, ${d.filiere}) a bien été reçu.`,
        "Il sera examiné par l'équipe de la bibliothèque avant d'être publié.",
        "",
        SIGNATURE,
      ),
  },

  // api/propositions "publier" → contributor (tellContributor)
  proposal_published: {
    description: "Proposition publiée (destinataire : contributeur).",
    required: ["nom", "matiere"],
    optional: [],
    build: (d) =>
      lines(
        `Bonjour ${d.nom},`,
        "",
        `🎉 Bonne nouvelle : votre document *« ${d.matiere} »* a été vérifié et publié dans la bibliothèque. Merci pour votre contribution !`,
        "",
        SIGNATURE,
      ),
  },

  // api/propositions "refuser" → contributor (tellContributor)
  proposal_rejected: {
    description: "Proposition refusée (destinataire : contributeur).",
    required: ["nom", "matiere"],
    optional: ["motif"],
    build: (d) =>
      lines(
        `Bonjour ${d.nom},`,
        "",
        `Merci pour votre proposition *« ${d.matiere} »*. Après examen, elle n'a pas pu être publiée.`,
        d.motif ? `*Motif* : ${d.motif}` : null,
        "",
        SIGNATURE,
      ),
  },
};

// Supabase Auth sends these two e-mails itself (the link is not accessible
// to the application), so the WhatsApp message is a notice without the link.
Object.assign(templates, {
  // api/inscription → new user (after signUp succeeded)
  signup_confirmation: {
    description: "Compte créé, e-mail de confirmation envoyé par Supabase (destinataire : nouvel inscrit).",
    required: ["prenom", "email"],
    optional: [],
    build: (d) =>
      lines(
        `Bonjour ${d.prenom},`,
        "",
        "🎓 Votre compte UpB Student's a bien été créé.",
        `Un e-mail de confirmation vient d'être envoyé à *${d.email}* : cliquez sur le lien qu'il contient pour activer votre compte. Pensez à vérifier vos spams.`,
        "",
        SIGNATURE,
      ),
  },

  // api/forgot → account owner (after resetPasswordForEmail succeeded)
  password_reset_requested: {
    description: "Demande de réinitialisation du mot de passe, e-mail envoyé par Supabase (destinataire : propriétaire du compte).",
    required: ["prenom", "email"],
    optional: [],
    build: (d) =>
      lines(
        `Bonjour ${d.prenom},`,
        "",
        "🔐 Une demande de réinitialisation de mot de passe a été faite pour votre compte.",
        `Un e-mail contenant le lien de réinitialisation a été envoyé à *${d.email}* (vérifiez vos spams).`,
        "⚠️ Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
        "",
        SIGNATURE,
      ),
  },
});

export function listTemplates() {
  return Object.entries(templates).map(([type, t]) => ({
    type,
    description: t.description,
    required: t.required,
    optional: t.optional,
  }));
}
