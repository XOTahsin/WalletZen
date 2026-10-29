// WalletZen Supabase configuration.
// These are public browser-client values; row access is protected by database RLS.
// Never place a Supabase service_role or secret key in this file.
export const supabaseUrl = "https://djytqqgaydbpfyhchfkh.supabase.co";
export const supabaseAnonKey = "sb_publishable_RAl1gpFkoVSnSXKx4vl_kw_zNPyM8Q5";
export const isSupabaseConfigured = () =>
  /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co$/.test(supabaseUrl) &&
  !supabaseUrl.includes("YOUR_PROJECT_REF") &&
  supabaseAnonKey &&
  !supabaseAnonKey.startsWith("YOUR_");
