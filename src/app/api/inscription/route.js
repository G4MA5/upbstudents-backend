import { FRONTEND_URL } from "../../../../lib/config.js";
import {
  clientIp,
  HttpError,
  ok,
  preflight,
  readJson,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
// ---------- Divine : WhatsApp (import) ----------
import { notifyWhatsApp } from "../../../../lib/whatsapp.js";
// ---------- Divine : fin ----------
import {
  createAnonClient,
  supabaseAdmin,
} from "../../../../lib/supabaseClient.js";
import {
  clean,
  FILIERES,
  isEmail,
  NIVEAUX_INSCRIPTION,
  normalizeEmail,
  requireFields,
  requireOneOf,
  validatePassword,
} from "../../../../lib/validation.js";

const EMAIL_TAKEN = "Cette adresse e-mail est déjà utilisée. Veuillez plutôt vous connecter.";

async function isEmailTaken(email) {
  const { data, error } = await supabaseAdmin
    .from("utilisateurs")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const nom = clean(body.nom, 80);
  const prenom = clean(body.prenom, 80);
  const niveau = clean(body.niveau, 30);
  const filiere = clean(body.filiere, 30);
  const numero = clean(body.numero, 20).replace(/[\s.-]/g, "");
  const password = body.password;

  requireFields({ email, nom, prenom, niveau, filiere, numero, password });
  if (!isEmail(email)) throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  requireOneOf(filiere, FILIERES, "Filière");
  requireOneOf(niveau, NIVEAUX_INSCRIPTION, "Niveau");
  if (!/^\+?\d{8,15}$/.test(numero)) {
    throw new HttpError(400, "Le numéro de téléphone n'est pas valide.");
  }
  validatePassword(password);

  rateLimit(`signup:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60_000 });

  if (await isEmailTaken(email)) {
    throw new HttpError(409, EMAIL_TAKEN, { code: "EMAIL_TAKEN" });
  }

  const client = createAnonClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { nom, prenom, niveau, filiere, numero },
      emailRedirectTo: `${FRONTEND_URL}/?compte=confirme`,
    },
  });

  if (error) {
    if (/rate limit/i.test(error.message || "") || error.status === 429) {
      throw new HttpError(
        429,
        "Trop de demandes d'inscription en ce moment. Veuillez réessayer dans quelques minutes.",
      );
    }
    if (/already registered|already exists/i.test(error.message || "")) {
      throw new HttpError(409, EMAIL_TAKEN, { code: "EMAIL_TAKEN" });
    }
    if (/password/i.test(error.message || "")) {
      throw new HttpError(400, "Ce mot de passe est trop faible. Choisissez-en un plus long ou plus complexe.");
    }
    throw error;
  }

  // Supabase hides existing accounts by returning a user with no identity.
  if (!data.user || data.user.identities?.length === 0) {
    throw new HttpError(409, EMAIL_TAKEN, { code: "EMAIL_TAKEN" });
  }

  const { error: insertError } = await supabaseAdmin.from("utilisateurs").insert([
    {
      user_id: data.user.id,
      nom,
      prenom,
      email: data.user.email,
      numero,
      niveau,
      filiere,
    },
  ]);

  // A missing profile row is rebuilt from the auth metadata at first login,
  // so a failure here must not block the registration itself.
  if (insertError && insertError.code !== "23505") {
    console.error("[inscription] profil non créé", insertError);
  }

  // ---------- Divine : début WhatsApp ----------
  // Le formulaire d'inscription pose la question "recevoir les notifications
  // WhatsApp ?" : on enregistre la réponse (oui / non). Sans réponse (ancien
  // client), on n'enregistre rien : la fenêtre de consentement sera proposée plus tard.
  // Enregistrement "au mieux" : si la migration n'est pas appliquée, l'inscription n'est pas bloquée.
  const whatsappAccepted = body.whatsapp === true;
  if (typeof body.whatsapp === "boolean") {
    const { error: optinError } = await supabaseAdmin
      .from("utilisateurs")
      .update({ whatsapp_optin: whatsappAccepted, whatsapp_optin_at: new Date().toISOString() })
      .eq("user_id", data.user.id);
    if (optinError) console.error("[inscription] consentement WhatsApp", optinError.message);
  }

  // Message de bienvenue seulement si le nouvel inscrit a accepté.
  // (le lien de confirmation, lui, est envoyé par e-mail par Supabase).
  // La clé "signup:<id>" évite d'envoyer le message deux fois.
  if (whatsappAccepted) {
    await notifyWhatsApp(
      "signup_confirmation",
      numero,
      { prenom, email: data.user.email },
      `signup:${data.user.id}`,
    );
  }
  // ---------- Divine : fin ----------

  return ok(req, {
    message:
      "Compte créé ! Un e-mail de confirmation vient de vous être envoyé. Cliquez sur le lien qu'il contient pour activer votre compte.",
    email: data.user.email,
  });
});

export const OPTIONS = preflight();
