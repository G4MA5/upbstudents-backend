// Revokes the refresh tokens of the current session. The client clears its
// local session whatever the outcome, so this call never blocks a logout.
import { ok, preflight, requireUser, route } from "../../../../lib/http.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";

export const POST = route(async (req) => {
  try {
    const { token } = await requireUser(req);
    await supabaseAdmin.auth.admin.signOut(token, "local");
  } catch {
    // Already expired or invalid: nothing to revoke.
  }
  return ok(req, { message: "Vous êtes déconnecté." });
});

export const OPTIONS = preflight();
