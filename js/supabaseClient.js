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

// ============================================================================
// withTimeout — garde-temps universel. Sur réseau mobile instable, un appel
// Supabase (session ou requête) peut ne JAMAIS répondre : sans ça, la page
// resterait bloquée à l'infini sur « Chargement… ». Ici on rejette après `ms`
// pour que l'appelant affiche une erreur claire + un bouton « Réessayer ».
// Accepte un thenable Supabase (Promise.resolve l'adopte proprement).
// ============================================================================
window.withTimeout = function (promise, ms, label) {
  ms = ms || 15000;
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error((label || "Chargement") + " : le réseau ne répond pas (délai dépassé).")),
      ms
    );
  });
  return Promise.race([Promise.resolve(promise), guard]).finally(() => clearTimeout(timer));
};
