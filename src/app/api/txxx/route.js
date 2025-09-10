import { supabase } from "../../../../lib/supabaseClient";

export async function GET() {
  const { data, error } = await supabase
    .from("utilisateurs")
    .select("*")
    .limit(1);

  if (error) {
    return new Response(
      JSON.stringify({ status: "error", message: error.message }),
      { status: 400 }
    );
  }

  return new Response(JSON.stringify({ status: "ok", data }), { status: 200 });
}
