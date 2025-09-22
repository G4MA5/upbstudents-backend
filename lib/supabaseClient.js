import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.supabase_url;
const supabaseAnonKey = process.env.supabase_anon_key;
const supabaseServiceRoleKey = process.env.supabase_service_role_key;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
