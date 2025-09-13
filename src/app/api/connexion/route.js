import { supabase } from "../../../../lib/supabaseClient";
const FRONT_ORIGINS = ["https://upbstudents-labibliotheque.netlify.app"];
function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (FRONT_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  try {
    const { email, password } = await req.json();

    // Connexion avec email et mot de passe
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            "Adresse email ou mot de passe incorrect. Veuillez réessayer.",
        }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Vérifie si l'email est confirmé
    if (!data.user?.confirmed_at) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            "Veuillez confirmer votre adresse email avant de vous connecter. Un email de confirmation vous a été envoyé.",
        }),
        { status: 403, headers: corsHeaders(origin) }
      );
    }

    // Récupération du profil utilisateur depuis la table
    const { data: profile, error: profileError } = await supabase
      .from("utilisateurs")
      .select("*")
      .eq("email", email)
      .single();

    if (profileError) {
      return new Response(
        JSON.stringify({ status: "error", message: profileError.message }),
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    // Retourner le token pour les futures requêtes
    return new Response(
      JSON.stringify({
        status: "ok",
        user: data.user,
        profile,
        token: data.session?.access_token || null,
      }),
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
