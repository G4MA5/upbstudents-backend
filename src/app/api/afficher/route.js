import { supabase } from "../../../../lib/supabaseClient.js";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const filiere = searchParams.get("filiere") || "%";
  const annee = searchParams.get("annee") || "%";
  const session = searchParams.get("session") || "%";
  const type = searchParams.get("type") || "%";
  const niveau = searchParams.get("niveau") || "%";
  const matiere = searchParams.get("matiere") || "%";

  try {
    const { data: docs, error } = await supabase
      .from("document")
      .select("*")
      .ilike("matiere", matiere)
      .ilike("filiere", filiere)
      .ilike("annee", annee)
      .ilike("session", session)
      .ilike("type", type)
      .ilike("niveau", niveau);

    if (error) throw error;

    const docsWithUrls = docs.map((doc) => {
      const { data: publicUrlData } = supabase.storage
        .from("Doc") // ← ton vrai bucket
        .getPublicUrl(doc.filename);

      return {
        title: doc.matiere,
        filiere: doc.filiere,
        annee: doc.annee,
        licence: doc.niveau,
        session: doc.session,
        type: doc.type,
        image: "/default-cover.png",
        file_url: publicUrlData.publicUrl,
      };
    });

    return new Response(
      JSON.stringify({ status: "ok", document: docsWithUrls }),
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      {
        status: 500,
        headers: corsHeaders(),
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

// 🔑 Factorisation : éviter d’oublier les headers
function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://joyful-cat-8e488a.netlify.app",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
