import { supabase } from "../../../../lib/supabaseClient.js";

const FRONT_ORIGINS = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  const headers = { "Content-Type": "application/json" };
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
    const { access_token, new_password } = await req.json();

    // ⚡ Étape 1 : connecter temporairement l’utilisateur avec son token
    const { data: session, error: sessionError } =
      await supabase.auth.setSession({
        access_token,
        refresh_token: access_token, // hack: supabase demande refresh_token mais tu n’en as pas
      });

    if (sessionError) {
      return new Response(
        JSON.stringify({ status: "error", message: sessionError.message }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // ⚡ Étape 2 : updateUser marche maintenant
    const { error } = await supabase.auth.updateUser({
      password: new_password,
    });

    if (error) {
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", message: "Mot de passe mis à jour" }),
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
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
