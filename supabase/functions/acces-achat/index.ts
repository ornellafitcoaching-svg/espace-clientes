// acces-achat — après un paiement Stripe, la page de remerciement / le programme
// demande sa clé de déverrouillage. On ne la donne QUE si la session Stripe
// (enregistrée par stripe-webhook) a bien été payée via un lien de paiement
// autorisé pour cette page. Personne d'autre ne peut lire les clés.
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ORIGINES = ["https://ornellafitcoaching.com", "https://www.ornellafitcoaching.com", "https://espace.ornellafitcoaching.com"];
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(o) ? o : ORIGINES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response(JSON.stringify({ erreur: "methode" }), { status: 405, headers: h });
  let body: { session_id?: string; page?: string } = {};
  try { body = await req.json(); } catch { /* vide */ }
  const sid = String(body.session_id ?? "");
  const page = String(body.page ?? "");
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,}$/.test(sid) || !page || page.length > 80) {
    return new Response(JSON.stringify({ erreur: "requete" }), { status: 400, headers: h });
  }
  const { data: achat } = await supa.from("achats_stripe").select("payment_link").eq("session_id", sid).maybeSingle();
  if (!achat) return new Response(JSON.stringify({ attente: true }), { status: 202, headers: h });
  const { data: p } = await supa.from("pages_protegees").select("cle,payment_links").eq("page", page).maybeSingle();
  if (!p || !achat.payment_link || !(p.payment_links ?? []).includes(achat.payment_link)) {
    return new Response(JSON.stringify({ erreur: "refuse" }), { status: 403, headers: h });
  }
  return new Response(JSON.stringify({ cle: p.cle }), { status: 200, headers: h });
});
