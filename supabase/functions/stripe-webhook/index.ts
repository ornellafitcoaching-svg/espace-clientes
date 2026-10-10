// stripe-webhook — reçoit les paiements Stripe (checkout.session.completed).
// Marque les paniers de la personne comme payés → les relances s'arrêtent immédiatement,
// et met à jour sa fiche Brevo (PANIER_STATUT = paye, sortie de la liste « Paniers abandonnés »).
// + Enregistre le paiement dans la fiche de la cliente de l'espace (table paiements).
// + Enregistre la session payée (achats_stripe) → déverrouille la page achetée (acces-achat).
// Signature vérifiée avec le secret du webhook (stocké dans private.config, ou variable STRIPE_WEBHOOK_SECRET).

import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") ?? "";

async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}

function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify(raw: string, header: string, WEBHOOK_SECRET: string) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((p) => p.length === 2));
  const t = parts["t"];
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)));
  return sigs.some((s) => s.length === expected.length && s === expected);
}

async function panierListId() {
  const r = await fetch("https://api.brevo.com/v3/contacts/lists?limit=50&offset=0", { headers: { "api-key": BREVO_KEY, accept: "application/json" } });
  if (!r.ok) return null;
  const l = ((await r.json()).lists ?? []).find((x: { name: string }) => x.name === "Paniers abandonnés");
  return l?.id ?? null;
}

// ---- Paiement → fiche cliente de l'espace (table paiements) ------------------
// Retrouve la/les cliente(s) : metadata.clientes (« Prénom Nom, Prénom Nom » → montant
// partagé), sinon email (email_perso), sinon nom saisi au paiement. Introuvable →
// tâche « paiement à rattacher » dans l'espace coach. Idempotent (réf = id session).
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
async function versFicheCliente(s: Record<string, any>, email: string) {
  const ref = String(s.id);
  const { data: deja } = await supa.from("paiements").select("id").ilike("note", `%${ref}%`).limit(1);
  if (deja && deja.length) return "deja";
  const total = Number(s.amount_total || 0) / 100;
  if (!total) return "zero";
  const date = new Date((s.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  const { data: toutes } = await supa.from("clientes").select("id,prenom,nom,email_perso").neq("statut", "termine");
  const list = toutes || [];
  let cibles: Array<{ id: string }> = [];
  const meta = String(s.metadata?.clientes || "").trim();
  if (meta) {
    for (const nomComplet of meta.split(/\s*,\s*/)) {
      const n = norm(nomComplet);
      const c = list.find((x) => norm(`${x.prenom} ${x.nom || ""}`) === n || norm(x.prenom) === n);
      if (c && !cibles.some((x) => x.id === c.id)) cibles.push(c);
    }
  }
  if (!cibles.length && email) {
    const c = list.filter((x) => norm(x.email_perso || "") === norm(email));
    if (c.length === 1) cibles = c;
  }
  const nomPayeur = String(s.customer_details?.name || s.collected_information?.individual_name || "");
  if (!cibles.length && nomPayeur) {
    const parts = nomPayeur.trim().split(/\s+/);
    const c = list.filter((x) => norm(x.prenom) === norm(parts[0]) && (parts.length < 2 || !x.nom || norm(x.nom) === norm(parts.slice(1).join(" "))));
    if (c.length === 1) cibles = c;
  }
  if (!cibles.length) {
    // Achat d'un programme en ligne par une inconnue : pas une cliente de l'espace → rien à faire.
    if (!meta && !s.metadata?.devis) return "hors_espace";
    await supa.from("taches_coach").insert({
      titre: `💳 Paiement Stripe à rattacher : ${total} € — ${nomPayeur || email || "?"}`,
      echeance: date, priorite: "haute", note: `${meta} · ${email} · réf ${ref}`,
    });
    return "a_rattacher";
  }
  const part = Math.round((total / cibles.length) * 100) / 100;
  for (const c of cibles) {
    await supa.from("paiements").insert({
      cliente_id: c.id, date, montant: part, mode: "Stripe",
      note: `${s.metadata?.devis ? "Devis " + s.metadata.devis + " · " : ""}Paiement Stripe${cibles.length > 1 ? ` (partagé entre ${cibles.length})` : ""} · réf ${ref}`,
    });
    const { data: ac } = await supa.from("accompagnements").select("id,montant_du").eq("cliente_id", c.id).limit(1);
    if (ac && ac.length && ac[0].montant_du != null && Number(ac[0].montant_du) > 0) {
      await supa.from("accompagnements").update({ montant_du: Math.max(0, Math.round((Number(ac[0].montant_du) - part) * 100) / 100) }).eq("id", ac[0].id);
    }
  }
  return "ok:" + cibles.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const WEBHOOK_SECRET = await secret("STRIPE_WEBHOOK_SECRET", "stripe_webhook_secret");
  if (!WEBHOOK_SECRET) return new Response("STRIPE_WEBHOOK_SECRET manquant", { status: 503 });
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("stripe-signature") ?? "", WEBHOOK_SECRET))) return new Response("signature invalide", { status: 400 });

  const event = JSON.parse(raw);
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return new Response(JSON.stringify({ ignore: event.type }), { status: 200 });
  }
  const s = event.data.object;
  if (event.type === "checkout.session.completed" && s.payment_status === "unpaid") {
    return new Response(JSON.stringify({ attente: "paiement différé" }), { status: 200 });
  }
  const email = String(s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();

  // Session payée → mémorisée pour déverrouiller la page achetée (fonction acces-achat).
  try {
    await supa.from("achats_stripe").upsert({
      session_id: String(s.id), payment_link: s.payment_link ? String(s.payment_link) : null,
      email: email || null, montant: Number(s.amount_total || 0) / 100,
    }, { onConflict: "session_id" });
  } catch (_) { /* ne bloque jamais le reste */ }

  if (!email) {
    let fiche = ""; try { fiche = await versFicheCliente(s, ""); } catch (e) { fiche = "erreur: " + String(e); }
    return new Response(JSON.stringify({ sans_email: true, fiche }), { status: 200 });
  }

  const { data } = await supa.from("paniers")
    .update({ statut: "paye", paid_at: new Date().toISOString(), stripe_session_id: s.id })
    .ilike("email", email).in("statut", ["ouvert", "stop", "expire"])
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
    .select("id");

  if (BREVO_KEY && data && data.length) {
    const listId = await panierListId();
    const body: Record<string, unknown> = {
      email, updateEnabled: true,
      attributes: { PANIER_STATUT: "paye" },
    };
    if (listId) body.unlinkListIds = [listId];
    await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }
  let fiche = "";
  try { fiche = await versFicheCliente(s, email); } catch (e) { fiche = "erreur: " + String(e); }
  return new Response(JSON.stringify({ paniers_payes: data?.length ?? 0, fiche }), { status: 200 });
});
