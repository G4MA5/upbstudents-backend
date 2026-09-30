// Shared HTTP helpers: CORS, JSON responses, error handling and auth checks.
import { HttpError } from "./errors.js";
import { supabaseAdmin } from "./supabaseClient.js";

export { HttpError };

const DEFAULT_ORIGINS = [
  "https://upbstudents-labibliotheque.netlify.app",
  "https://upbstudents-labibliotheque.com",
  "https://www.upbstudents-labibliotheque.com",
];

// Netlify deploy previews (https://deploy-preview-12--upbstudents-labibliotheque.netlify.app).
const NETLIFY_PREVIEW =
  /^https:\/\/[a-z0-9-]+--upbstudents-labibliotheque\.netlify\.app$/;
// Any local dev server (Vite may pick 5173, 5174, 4173…).
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (DEFAULT_ORIGINS.includes(origin) || extra.includes(origin)) return true;
  if (NETLIFY_PREVIEW.test(origin)) return true;
  return process.env.NODE_ENV !== "production" && LOCALHOST.test(origin);
}

export function corsHeaders(req, methods = "GET, POST, OPTIONS") {
  const origin = req.headers.get("origin") || "";
  const headers = { Vary: "Origin" };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

export function json(req, body, status = 200, extraHeaders = {}, methods) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(req, methods),
      ...extraHeaders,
    },
  });
}

export function ok(req, data = {}, extraHeaders, methods) {
  return json(req, { status: "ok", ...data }, 200, extraHeaders, methods);
}

export function preflight(methods) {
  return async (req) =>
    new Response(null, { status: 204, headers: corsHeaders(req, methods) });
}

/**
 * Wraps a route handler: every thrown HttpError becomes a clean JSON
 * response; anything else is logged server-side and reported to the user
 * with a generic French message (no stack traces, no database internals).
 */
export function route(handler, methods) {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(
          req,
          { status: "error", message: err.message, ...err.extra },
          err.status,
          {},
          methods,
        );
      }
      console.error(`[${new URL(req.url).pathname}]`, err);
      return json(
        req,
        {
          status: "error",
          message:
            "Une erreur inattendue est survenue. Veuillez réessayer dans quelques instants.",
        },
        500,
        {},
        methods,
      );
    }
  };
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Requête invalide.");
  }
}

export function clientIp(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "inconnu"
  );
}

function bearer(req) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Columns of `utilisateurs` that may be sent to the account owner. */
export const PROFILE_COLUMNS =
  "num_id, user_id, nom, prenom, email, numero, niveau, filiere, proprietaire";

/** Verifies the bearer token and returns the Supabase user. */
export async function requireUser(req) {
  const token = bearer(req);
  if (!token) {
    throw new HttpError(401, "Vous devez être connecté pour continuer.", {
      code: "AUTH_REQUIRED",
    });
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    throw new HttpError(
      401,
      "Votre session a expiré. Veuillez vous reconnecter.",
      { code: "SESSION_EXPIRED" },
    );
  }
  return { user: data.user, token };
}

/** Optional auth: returns the user when a valid token is present. */
export async function optionalUser(req) {
  if (!bearer(req)) return null;
  try {
    return (await requireUser(req)).user;
  } catch {
    return null;
  }
}

/**
 * Loads the profile row of an auth user. If the row is missing (sign-up
 * interrupted after the auth account was created), it is rebuilt from the
 * metadata saved at registration so the user is not locked out.
 */
async function linkProfileByEmail(profile, user) {
  if (profile.user_id) {
    if (profile.user_id !== user.id) {
      throw new HttpError(
        409,
        "Cette adresse e-mail est déjà liée à un autre compte.",
        { code: "ACCOUNT_LINK_CONFLICT" },
      );
    }
    return profile;
  }

  const { data: linked, error: linkError } = await supabaseAdmin
    .from("utilisateurs")
    .update({ user_id: user.id })
    .eq("num_id", profile.num_id)
    .is("user_id", null)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (linkError) throw linkError;
  if (linked) return linked;

  const { data: raced, error: racedError } = await supabaseAdmin
    .from("utilisateurs")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();
  if (racedError) throw racedError;
  if (raced) return raced;

  throw new HttpError(
    409,
    "Cette adresse e-mail est déjà liée à un autre compte.",
    { code: "ACCOUNT_LINK_CONFLICT" },
  );
}

async function createProfileFromAuthUser(user) {
  const meta = user.user_metadata || {};
  const fullName = String(meta.full_name || meta.name || "").trim();
  const nameParts = fullName ? fullName.split(/\s+/) : [];
  const { data: created, error: insertError } = await supabaseAdmin
    .from("utilisateurs")
    .insert([
      {
        user_id: user.id,
        email: user.email,
        nom: meta.nom || meta.family_name || nameParts.slice(1).join(" ") || "",
        prenom: meta.prenom || meta.given_name || nameParts[0] || "",
        numero: meta.numero || "",
        niveau: meta.niveau || "",
        filiere: meta.filiere || "",
      },
    ])
    .select(PROFILE_COLUMNS)
    .single();
  if (insertError) throw insertError;
  return created;
}

export async function loadProfile(user) {
  const { data: byId, error } = await supabaseAdmin
    .from("utilisateurs")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (byId) return byId;

  const { data: byEmail, error: emailError } = await supabaseAdmin
    .from("utilisateurs")
    .select(PROFILE_COLUMNS)
    .eq("email", user.email)
    .maybeSingle();
  if (emailError) throw emailError;
  if (byEmail) return linkProfileByEmail(byEmail, user);

  return createProfileFromAuthUser(user);
}

/** Profile fields shown to the account owner (internal ids stay server-side). */
export function publicProfile(profile) {
  if (!profile) return null;
  return {
    nom: profile.nom || "",
    prenom: profile.prenom || "",
    email: profile.email || "",
    numero: profile.numero || "",
    niveau: profile.niveau || "",
    filiere: profile.filiere || "",
    proprietaire: Boolean(profile.proprietaire),
  };
}

export function sessionPayload(session) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  };
}
