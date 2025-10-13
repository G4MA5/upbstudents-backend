import { supabaseAdmin } from "../../../../lib/supabaseClient.js";

const FRONT_ORIGINS = [
  "https://upbstudents-labibliotheque.netlify.app",
  "https://upbstudents-labibliotheque.com",
];

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (FRONT_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export async function POST(req) {
  const origin = req.headers.get("origin") || "";

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ status: "error", message: "Email requis" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo:
        "https://upbstudents-labibliotheque.netlify.app/mot-de-passe-oublie", // ton front
    });

    if (error) {
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", message: "Email envoyé" }),
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
