// WalletZen Supabase configuration.
// Copy these values from Supabase Dashboard > Project Settings > API.
// The publishable/anon key is intended for browser use; protect data with RLS.
// NEVER put a service_role key in this file.
export const supabaseUrl = "https://YOUR_PROJECT_REF.supabase.co";
export const supabaseAnonKey = "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY";
export const isSupabaseConfigured = () =>
  /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co$/.test(supabaseUrl) &&
  !supabaseUrl.includes("YOUR_PROJECT_REF") &&
  supabaseAnonKey &&
  !supabaseAnonKey.startsWith("YOUR_");
