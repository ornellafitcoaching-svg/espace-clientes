// ============================================================================
// Client Supabase partagé. Charge @supabase/supabase-js depuis le CDN via la
// balise <script> dans le HTML (window.supabase).
// ============================================================================
(function () {
  const cfg = window.APP_CONFIG || {};
  if (!window.supabase) {
    console.error("supabase-js non chargé (vérifie la balise <script> CDN).");
    return;
  }
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("REMPLACER")) {
    console.warn("APP_CONFIG non configuré — édite js/config.js.");
  }
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
})();
