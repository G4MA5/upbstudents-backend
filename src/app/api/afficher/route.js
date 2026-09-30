import { DOCUMENTS_BUCKET } from "../../../../lib/config.js";
import { ok, preflight, route } from "../../../../lib/http.js";
import { supabase } from "../../../../lib/supabaseClient.js";

const METHODS = "GET, OPTIONS";

export const GET = route(async (req) => {
  const { searchParams } = new URL(req.url);
  const param = (name) => searchParams.get(name) || "%";

  const { data: docs, error } = await supabase
    .from("document")
    .select("*")
    .ilike("matiere", param("matiere"))
    .ilike("filiere", param("filiere"))
    .ilike("annee", param("annee"))
    .ilike("session", param("session"))
    .ilike("type", param("type"))
    .ilike("niveau", param("niveau"))
    .order("id", { ascending: false });

  if (error) throw error;

  const documents = docs.map((doc) => {
    const { data } = supabase.storage
      .from(DOCUMENTS_BUCKET)
      .getPublicUrl(doc.filename);

    // Same shape as before (title / licence / file_url / filePath) so any
    // existing client keeps working; `niveau` and `created_at` are additions.
    return {
      id: doc.id,
      title: doc.matiere,
      filiere: doc.filiere,
      annee: doc.annee,
      licence: doc.niveau,
      niveau: doc.niveau,
      session: doc.session,
      type: doc.type,
      image: "/default-cover.png",
      file_url: data.publicUrl,
      filePath: doc.filename,
      created_at: doc.created_at || null,
    };
  });

  // Short shared cache: the list changes rarely, and the client updates its
  // own copy immediately after an upload or a deletion.
  return ok(
    req,
    { document: documents },
    { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    METHODS,
  );
}, METHODS);

export const OPTIONS = preflight(METHODS);
