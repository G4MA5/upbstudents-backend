// Mon back : /api/utilisateur - SOLUTION OPTIMALE

import { supabase } from "../../../../lib/supabaseClient.js";

// L'origine autorisée (doit être la même que dans le middleware)
const FRONT_ORIGIN = "https://upbstudents-labibliotheque.netlify.app";

// Headers CORS complets pour la réponse OPTIONS (pré-vol)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": FRONT_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization", // IMPORTANT pour l'en-tête Bearer
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
};

// 🛑 NOUVEAU : Fonction pour gérer la requête OPTIONS (pré-vol)
export async function OPTIONS() {
  // Répond avec le statut 204 No Content et les headers CORS requis par le navigateur
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// 🛑 MODIFIÉ : Fonction pour gérer la requête GET (requête réelle)
export async function GET(req) {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return new Response(
      JSON.stringify({ status: "error", message: "Token manquant" }),
      // Ajout du header ACAO et Credentials pour la requête réelle.
      {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": FRONT_ORIGIN,
          "Access-Control-Allow-Credentials": "true",
        },
      }
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
        {
          status: 401,
          headers: {
            "Access-Control-Allow-Origin": FRONT_ORIGIN,
            "Access-Control-Allow-Credentials": "true",
          },
        }
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
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": FRONT_ORIGIN,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", utilisateur: utilisateurData }),
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": FRONT_ORIGIN,
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": FRONT_ORIGIN,
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  }
}
