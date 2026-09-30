// Password change for a signed-in user (requires the current password).
import {
  HttpError,
  ok,
  preflight,
  readJson,
  requireUser,
  route,
} from "../../../../lib/http.js";
import { rateLimit } from "../../../../lib/rateLimit.js";
import {
  createAnonClient,
  supabaseAdmin,
} from "../../../../lib/supabaseClient.js";
import { validatePassword } from "../../../../lib/validation.js";

export const POST = route(async (req) => {
  const { user } = await requireUser(req);
  const { current_password, new_password } = await readJson(req);

  if (!current_password) {
    throw new HttpError(400, "Veuillez saisir votre mot de passe actuel.");
  }
  validatePassword(new_password);
  if (current_password === new_password) {
    throw new HttpError(400, "Le nouveau mot de passe doit être différent de l'actuel.");
  }

  rateLimit(`password:${user.id}`, { limit: 5, windowMs: 15 * 60_000 });

  const check = await createAnonClient().auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });
  if (check.error) {
    throw new HttpError(400, "Le mot de passe actuel est incorrect.", {
      field: "current_password",
    });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: new_password,
  });
  if (error) throw error;

  return ok(req, { message: "Votre mot de passe a été modifié avec succès." });
});

export const OPTIONS = preflight();
