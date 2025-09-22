import { supabase } from "../../../../lib/supabaseClient.js";
const FRONT_ORIGINS = ["https://upbstudents-labibliotheque.netlify.app"];
function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
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

        id: doc.id,
        filePath: doc.filename,
      };
    });

    return new Response(
      JSON.stringify({ status: "ok", document: docsWithUrls }),
      {
        status: 200,
        headers: corsHeaders(origin),
      }
    );
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

export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
