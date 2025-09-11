import { supabase } from "../../../../lib/supabaseClient";

export async function POST(req) {
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
        { status: 400, headers: { "Content-Type": "application/json" } }
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
        { status: 403, headers: { "Content-Type": "application/json" } }
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
        { status: 404, headers: { "Content-Type": "application/json" } }
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
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
