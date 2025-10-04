// Mon back : /api/utilisateur
import { supabase } from "../../../../lib/supabaseClient.js";

// 🛑 SUPPRIMER : const FRONT_ORIGINS = [...]
// 🛑 SUPPRIMER : function corsHeaders(origin) { ... }

export async function GET(req) {
  // 🛑 SUPPRIMER : const origin = req.headers.get("origin") || "";
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return new Response(
      JSON.stringify({ status: "error", message: "Token manquant" }), // 🛑 CORRIGÉ : PLUS de headers CORS ici
      { status: 401 }
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
        }), // 🛑 CORRIGÉ : PLUS de headers CORS ici
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
        JSON.stringify({ status: "error", message: "Utilisateur introuvable" }), // 🛑 CORRIGÉ : PLUS de headers CORS ici
        { status: 404 }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", utilisateur: utilisateurData }), // 🛑 CORRIGÉ : PLUS de headers CORS ici
      { status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }), // 🛑 CORRIGÉ : PLUS de headers CORS ici
      { status: 500 }
    );
  }
}

// 🛑 SUPPRIMER : export async function OPTIONS(req) { ... }
