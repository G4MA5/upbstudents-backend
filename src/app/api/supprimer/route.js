import { supabaseAdmin } from "../../../../lib/supabaseClient.js";

const FRONT_ORIGINS = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  const headers = { "Content-Type": "application/json" };
  if (FRONT_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export async function DELETE(req) {
  const origin = req.headers.get("origin") || "";
  try {
    const body = await req.json();
    const { id, filePath } = body;

    if (!id || !filePath) {
      return new Response(
        JSON.stringify({ status: "error", message: "id et filePath requis" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // 1. Supprimer dans la table
    const { error: dbError } = await supabaseAdmin
      .from("document")
      .delete()
      .eq("id", id);

    if (dbError) throw dbError;

    // 2. Supprimer dans le bucket
    const { error: storageError } = await supabaseAdmin.storage
      .from("Doc")
      .remove([filePath]);

    if (storageError) throw storageError;

    return new Response(
      JSON.stringify({ status: "ok", message: "Document supprimé" }),
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
