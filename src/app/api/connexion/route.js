import {
  clientIp,
  HttpError,
  loadProfile,
  ok,
  preflight,
  publicProfile,
  readJson,
  route,
  sessionPayload,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { createAnonClient } from "../../../../lib/supabaseClient.js";
import { isEmail, normalizeEmail } from "../../../../lib/validation.js";

const UNCONFIRMED =
  "Veuillez confirmer votre adresse e-mail avant de vous connecter. Un e-mail de confirmation vous a été envoyé (pensez à vérifier vos spams).";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    throw new HttpError(400, "Veuillez saisir votre e-mail et votre mot de passe.");
  }
  if (!isEmail(email)) {
    throw new HttpError(400, "L'adresse e-mail n'est pas valide.");
  }

  rateLimit(`login:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60_000 });
  rateLimit(`login:${email}`, { limit: 8, windowMs: 15 * 60_000 });

  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const unconfirmed =
      error.code === "email_not_confirmed" ||
      /confirm|not verified/i.test(error.message || "");
    if (unconfirmed) {
      throw new HttpError(403, UNCONFIRMED, { code: "EMAIL_NOT_CONFIRMED" });
    }
    if (error.status === 429) {
      throw new HttpError(
        429,
        "Trop de tentatives de connexion. Veuillez patienter quelques minutes.",
      );
    }
    throw new HttpError(
      400,
      "Adresse e-mail ou mot de passe incorrect. Veuillez réessayer.",
      { code: "INVALID_CREDENTIALS" },
    );
  }

  if (!data.user?.confirmed_at && !data.user?.email_confirmed_at) {
    throw new HttpError(403, UNCONFIRMED, { code: "EMAIL_NOT_CONFIRMED" });
  }

  const profile = await loadProfile(data.user);
  const session = sessionPayload(data.session);

  return ok(req, {
    user: { id: data.user.id, email: data.user.email },
    profile: publicProfile(profile),
    session,
    // Kept for older clients that only read `token`.
    token: session?.access_token || null,
  });
});

export const OPTIONS = preflight();
