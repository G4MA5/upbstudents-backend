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
// Méthode POST
export async function POST(req) {
  try {
    const origin = req.headers.get("origin") || "";
    const body = await req.json(); // Avec App Router, pas req.body directement
    const { email, password, nom, prenom, niveau, filiere, numero } = body;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nom, prenom, niveau, filiere, numero },
      },
    });

    if (error) {
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        {
          status: 400,
          headers: corsHeaders(origin),
        }
      );
    }

    const { error: insertError } = await supabase.from("utilisateurs").insert([
      {
        user_id: data.user.id,
        nom,
        prenom,
        email: data.user.email,
        numero,
        niveau,
        filiere,
      },
    ]);

    if (insertError) {
      return new Response(
        JSON.stringify({ status: "error", message: insertError.message }),
        {
          status: 400,
          headers: corsHeaders(origin),
        }
      );
    }
    return new Response(JSON.stringify({ status: "ok", user: data.user }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      {
        status: 500,
        headers: corsHeaders(origin),
      }
    );
  }
}

const getUserByEmail = async (email) => {
  const { data, error } = await supabase
    .from("utilisateur")
    .select("*")
    .eq("email", email) // ou .eq("user_id", userId)
    .single(); // récupère un seul enregistrement

  if (error) {
    console.error("Erreur récupération utilisateur :", error.message);
    return null;
  }

  console.log("Utilisateur trouvé :", data);
  return data;
};

// OPTIONS = préflight (toujours nécessaire pour CORS)
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
