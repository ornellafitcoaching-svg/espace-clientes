// ============================================================================
// auth.js — session, rôle, gardes de page.
// ============================================================================
window.Auth = {
  async session() {
    const { data } = await window.sb.auth.getSession();
    return data.session || null;
  },

  async profile() {
    const s = await this.session();
    if (!s) return null;
    const { data } = await window.sb
      .from("profiles")
      .select("id, role, prenom, nom, email")
      .eq("id", s.user.id)
      .maybeSingle();
    return data || null;
  },

  // Garde une page réservée à la coach. Redirige vers login si pas connectée
  // ou si le rôle n'est pas 'coach'. Renvoie le profil sinon.
  async requireCoach() {
    const p = await this.profile();
    if (!p) {
      location.href = "login.html";
      return null;
    }
    if (p.role !== "coach") {
      await window.sb.auth.signOut();
      location.href = "login.html?err=role";
      return null;
    }
    return p;
  },

  async signInCoach(email, password) {
    return window.sb.auth.signInWithPassword({ email, password });
  },

  // ==========================================================================
  // CLIENTE — accès par code d'accès (le code = identifiant + mot de passe).
  // On dérive un email technique déterministe à partir du code ; c'est cet
  // email/mot de passe qui est utilisé pour la vraie session Supabase (RLS).
  // ==========================================================================
  clienteEmail(code) {
    const dom = (window.APP_CONFIG && window.APP_CONFIG.CLIENTE_EMAIL_DOMAIN) || "espace.ornellafit.local";
    return String(code || "").trim().toLowerCase() + "@" + dom;
  },

  async signInCliente(code) {
    const c = String(code || "").trim();
    const email = this.clienteEmail(c);
    // Mot de passe = code en MAJUSCULES → login insensible à la casse saisie.
    return window.sb.auth.signInWithPassword({ email, password: c.toUpperCase() });
  },

  // Garde une page réservée à la cliente. Redirige vers espace.html sinon.
  async requireCliente() {
    const p = await this.profile();
    if (!p) { location.href = "espace.html"; return null; }
    if (p.role !== "cliente") {
      await window.sb.auth.signOut();
      location.href = "espace.html?err=role";
      return null;
    }
    return p;
  },

  // CÔTÉ COACH : crée le compte auth de la cliente SANS déloger la session coach.
  // Utilise un 2e client Supabase "jetable" (persistSession:false) pour le signUp.
  // Le trigger handle_new_user crée le profil role='cliente'. Renvoie le user id.
  // PRÉ-REQUIS Supabase : Auth → "Confirm email" = OFF (emails techniques bidons).
  async provisionCliente(code, prenom, nom) {
    const cfg = window.APP_CONFIG || {};
    const c = String(code || "").trim();
    const email = this.clienteEmail(c);
    const tmp = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sb-tmp-provision" },
    });
    const { data, error } = await tmp.auth.signUp({
      email, password: c.toUpperCase(), options: { data: { prenom: prenom || "", nom: nom || "" } },
    });
    try { await tmp.auth.signOut(); } catch (_) { /* pas de session si confirmation ON */ }
    if (error) throw error;
    if (!data || !data.user) throw new Error("Compte cliente non créé.");
    return data.user.id;
  },

  async signOut() {
    await window.sb.auth.signOut();
    location.href = "login.html";
  },

  // Déconnexion cliente (retour vers son espace de connexion)
  async signOutCliente() {
    await window.sb.auth.signOut();
    location.href = "espace.html";
  },
};
