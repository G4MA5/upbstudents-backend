import { supabase } from "../../../../lib/supabaseClient";

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
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

// Vérifier si l’email existe déjà
const isEmailTaken = async (email) => {
  const { data, error } = await supabase
    .from("utilisateurs")
    .select("email")
    .eq("email", email)
    .single();

  if (error && error.code !== "PGRST116") {
    // "PGRST116" = pas trouvé, donc ok
    console.error("Erreur vérification email :", error.message);
    return false; // traiter comme non existant en cas d'erreur autre
  }
  return !!data; // true si email existe
};

// Méthode POST
export async function POST(req) {
  try {
    const origin = req.headers.get("origin") || "";
    const body = await req.json();
    const { email, password, nom, prenom, niveau, filiere, numero } = body;

    // Vérifier si l’email existe déjà
    const emailTaken = await isEmailTaken(email);
    if (emailTaken) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "L’email est déjà existant. Veuillez plutôt vous connecter.",
        }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Création utilisateur
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nom, prenom, niveau, filiere, numero },
        emailRedirectTo: "https://upbstudents-labibliotheque.netlify.app", // ← ton front
      },
    });

    if (error) {
      let message = error.message;

      // Gestion spécifique du "rate limit"
      if (error.message.includes("Email rate limit exceeded")) {
        message =
          "Trop de monde sur le site actuellement. Veuillez patienter et réessayer dans quelques minutes.";
      }

      return new Response(JSON.stringify({ status: "error", message }), {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    // Insertion des infos utilisateur dans la table
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
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    return new Response(JSON.stringify({ status: "ok", user: data.user }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

// OPTIONS = préflight
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
