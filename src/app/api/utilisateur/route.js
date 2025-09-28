// Route API (ex: /pages/api/utilisateur.js ou équivalent)
import { supabase } from "../../../../lib/supabaseClient.js";
// Les fonctions corsHeaders, FRONT_ORIGINS et l'export OPTIONS ont été supprimés !

export async function GET(req) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ status: "error", message: "Token manquant" }),
      { status: 401 } // Le middleware ajoutera les headers CORS
    );
  }

  try {
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Utilisateur non connecté",
        }),
        { status: 401 }
      );
    }

    const { data: utilisateurData, error: utilisateurError } = await supabase
      .from("utilisateurs")
      .select("num_id, proprietaire")
      .eq("email", user.email)
      .single();

    if (utilisateurError || !utilisateurData) {
      return new Response(
        JSON.stringify({ status: "error", message: "Utilisateur introuvable" }),
        { status: 404 }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", utilisateur: utilisateurData }),
      { status: 200 } // Le middleware ajoutera les headers CORS
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500 }
    );
  }
}
