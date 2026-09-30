import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./errors.js";

// Accept the historical lowercase names and the usual Supabase names.
const env = (...names) => names.map((n) => process.env[n]).find(Boolean);

const config = () => ({
  url: env("supabase_url", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
  anon: env("supabase_anon_key", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  service: env("supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY"),
});

// Serverless instances are shared between requests: a client must never keep
// a session in memory, otherwise one user's identity leaks into the next
// request. Every client below is stateless.
const STATELESS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function build(kind) {
  const { url, anon, service } = config();
  const key = kind === "service" ? service : anon;
  if (!url || !key) {
    // Reported as a clean JSON error (with CORS headers) instead of crashing
    // the module, which the browser would only show as a "CORS error".
    console.error(
      `[config] Variable(s) manquante(s) : ${[
        !url && "supabase_url",
        !key && (kind === "service" ? "supabase_service_role_key" : "supabase_anon_key"),
      ]
        .filter(Boolean)
        .join(", ")} (voir .env.example)`,
    );
    throw new HttpError(
      503,
      "Le serveur n'est pas correctement configuré (accès à la base de données manquant). Veuillez contacter l'administrateur.",
      { code: "SERVER_CONFIG" },
    );
  }
  return createClient(url, key, STATELESS);
}

/** Created on first use, so a missing variable never breaks module loading. */
function lazy(kind) {
  let instance = null;
  return new Proxy(
    {},
    {
      get(_, prop) {
        instance ??= build(kind);
        const value = instance[prop];
        return typeof value === "function" ? value.bind(instance) : value;
      },
    },
  );
}

/**
 * Fresh anon client for auth flows that create a session (sign in, sign up,
 * refresh). One client per request, discarded afterwards.
 */
export function createAnonClient() {
  return build("anon");
}

/** Read-only public queries (document listing). Holds no session. */
export const supabase = lazy("anon");

/** Service-role client: only for trusted server-side operations. */
export const supabaseAdmin = lazy("service");
