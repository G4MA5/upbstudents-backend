import { supabase } from "../../../../lib/supabaseClient";

// Méthode POST
export async function POST(req) {
  try {
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
          headers: { "Content-Type": "application/json" },
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
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response(JSON.stringify({ status: "ok", user: data.user }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Méthode OPTIONS (préflight CORS)
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "https://upbstudents.netlify.app",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
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
