// World Cup 2026 Prediction Game production config example.
// Copy to config.production.js for GitHub Pages only when you are ready to deploy.
//
// The Supabase anon/publishable key is allowed in frontend code because Row
// Level Security protects database access.
//
// Never put these values here:
// - Supabase service role key
// - API-Football key
// - passwords or private server secrets

window.WC2026_CONFIG = {
  APP_MODE: "production",
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your_supabase_anon_or_publishable_key"
};
