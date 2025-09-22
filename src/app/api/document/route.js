import { supabase } from "../../../../lib/supabaseClient.js";
import { supabaseAdmin } from "../../../../lib/supabaseClient";
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
const PREDEFINED_PASSWORD = "GAMALab's'onTOP@2024";

export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  try {
    // Vérifier token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ status: "error", message: "Token manquant" }),
        { status: 401, headers: corsHeaders(origin) }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    // Vérification utilisateur via token
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

    // Récupération du FormData
    const formData = await req.formData();
    const file = formData.get("document");
    const filiere = formData.get("filiere")?.toString() || "";
    const session = formData.get("session")?.toString() || "";
    const annee = formData.get("annee")?.toString() || "";
    const type = formData.get("type")?.toString() || "";
    const matiere = formData.get("matiere")?.toString() || "";
    const niveau = formData.get("niveau")?.toString() || "";
    const password = formData.get("password")?.toString() || "";

    // Vérification mot de passe
    if (password !== PREDEFINED_PASSWORD) {
      return new Response(
        JSON.stringify({ status: "error", message: "Mot de passe incorrect" }),
        { status: 403, headers: corsHeaders(origin) }
      );
    }

    if (!file) {
      return new Response(
        JSON.stringify({ status: "error", message: "Aucun fichier fourni" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Récupérer NumID depuis utilisateur
    const { data: utilisateurData, error: utilisateurError } = await supabase
      .from("utilisateurs")
      .select("num_id")
      .eq("email", user.email)
      .single();

    if (utilisateurError || !utilisateurData) {
      return new Response(
        JSON.stringify({ status: "error", message: "Utilisateur introuvable" }),
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    const admis = utilisateurData.num_id;

    // Générer nom unique + buffer
    const uniqueFileName = `${type}_${filiere}_${session}`;
    const fileBuffer = new Uint8Array(await file.arrayBuffer());

    // Upload fichier
    //pro
    const { error: uploadError } = await supabaseAdmin.storage
      .from("Doc")
      .upload(uniqueFileName, fileBuffer, {
        contentType: file.type || "application/octet-stream",
      });

    if (uploadError) throw uploadError;
    // pro

    // Insertion table documents
    const { data: docData, error: dbError } = await supabase
      .from("document")
      .insert([
        {
          admis,
          matiere,
          filiere,
          session,
          annee,
          type,
          filename: uniqueFileName,
          niveau,
        },
      ])
      .select();

    if (dbError) throw dbError;

    const { error: updateError } = await supabase
      .from("utilisateurs")
      .update({ proprietaire: true })
      .eq("num_id", admis);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ status: "ok", document: docData[0] }),
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
