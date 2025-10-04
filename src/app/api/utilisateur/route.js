import { supabase } from "../../../../lib/supabaseClient.js";

export async function GET(req) {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return new Response(
      JSON.stringify({ status: "error", message: "Token manquant" }),
      { status: 401 }
    );
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
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
      { status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500 }
    );
  }
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204 });
}
