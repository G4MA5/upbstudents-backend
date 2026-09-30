// Exchanges a refresh token for a new session, so users stay signed in
// without re-entering their password when the 1-hour access token expires.
import {
  HttpError,
  loadProfile,
  ok,
  preflight,
  publicProfile,
  readJson,
  route,
  sessionPayload,
} from "../../../../lib/http.js";
import { createAnonClient } from "../../../../lib/supabaseClient.js";

export const POST = route(async (req) => {
  const { refresh_token } = await readJson(req);
  if (!refresh_token || typeof refresh_token !== "string") {
    throw new HttpError(401, "Session invalide.", { code: "SESSION_EXPIRED" });
  }

  const client = createAnonClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token });
  if (error || !data?.session || !data.user) {
    throw new HttpError(
      401,
      "Votre session a expiré. Veuillez vous reconnecter.",
      { code: "SESSION_EXPIRED" },
    );
  }

  const profile = await loadProfile(data.user);
  return ok(req, {
    user: { id: data.user.id, email: data.user.email },
    profile: publicProfile(profile),
    session: sessionPayload(data.session),
  });
});

export const OPTIONS = preflight();
