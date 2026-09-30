// Sets a new password from the recovery link sent by /api/forgot.
import {
  clientIp,
  HttpError,
  ok,
  preflight,
  readJson,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient.js";
import { validatePassword } from "../../../../lib/validation.js";

export const POST = route(async (req) => {
  const { access_token, new_password } = await readJson(req);

  if (!access_token || typeof access_token !== "string") {
    throw new HttpError(
      400,
      "Le lien de réinitialisation est invalide. Veuillez refaire une demande.",
      { code: "INVALID_LINK" },
    );
  }
  validatePassword(new_password);
  rateLimit(`reset:${clientIp(req)}`, { limit: 10, windowMs: 15 * 60_000 });

  // The token is verified by Supabase; no session is ever stored server-side.
  const { data, error } = await supabaseAdmin.auth.getUser(access_token);
  if (error || !data?.user) {
    throw new HttpError(
      400,
      "Ce lien de réinitialisation a expiré. Veuillez refaire une demande.",
      { code: "INVALID_LINK" },
    );
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    data.user.id,
    { password: new_password },
  );
  if (updateError) {
    if (/different from the old/i.test(updateError.message || "")) {
      throw new HttpError(
        400,
        "Le nouveau mot de passe doit être différent de l'ancien.",
      );
    }
    throw updateError;
  }

  return ok(req, {
    message: "Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter.",
  });
});

export const OPTIONS = preflight();
