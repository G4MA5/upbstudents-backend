import { supabase } from "../../../../lib/supabaseClient.js";

const FRONT_ORIGINS = [
  "https://upbstudents-labibliotheque.netlify.app",
  "https://upbstudents-labibliotheque.com",
];

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

export async function GET(req) {
  const origin = req.headers.get("origin") || "";
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ status: "error", message: "Token manquant" }),
        { status: 401, headers: corsHeaders(origin) }
      );
    }

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
        { status: 401, headers: corsHeaders(origin) }
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
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", utilisateur: utilisateurData }),
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
