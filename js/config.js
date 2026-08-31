// ============================================================================
// CONFIG — projet Supabase d'Ornella (rempli automatiquement le 2026-08-29).
//   • SUPABASE_URL      = adresse du projet
//   • SUPABASE_ANON_KEY = clé PUBLIABLE (publique par design ; sécurité = RLS serveur)
// ============================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://xvetwfqzkkcfchxxifuu.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_6MX4NRr9dB4lXo_XDCa0lQ_rZroOwa7",

  // Domaine email technique des comptes clientes (Étape 2). Ne pas changer une fois
  // des accès créés (sinon les emails dérivés ne correspondraient plus).
  // NB : Supabase valide le domaine par DNS et refuse ".local" ou un sous-domaine
  // sans enregistrement. On utilise donc le domaine racine (qui a des MX/A valides).
  // Aucun email n'est envoyé (Confirm email = OFF) : ce domaine ne sert qu'à
  // fabriquer un identifiant unique déterministe pour la session Supabase.
  CLIENTE_EMAIL_DOMAIN: "ornellafitcoaching.com",

  // Numéro WhatsApp d'Ornella au format international SANS le "+" ni espaces.
  // Ex. pour +33 6 12 34 56 78 → "33612345678". Laisser vide masque le bouton.
  WHATSAPP_NUMBER: "33756834626",
};
