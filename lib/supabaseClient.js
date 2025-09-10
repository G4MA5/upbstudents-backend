import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.Next_public_supabase_url;
const supabaseAnonKey = process.env.Next_public_supabase_anon_key;
const supabaseServiceRoleKey =
  process.env.Next_public_supabase_service_role_key;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
