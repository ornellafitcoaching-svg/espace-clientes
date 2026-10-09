// ============================================================================
// paiements-auto — enregistre AUTOMATIQUEMENT les paiements GoCardless dans la
// fiche de la cliente (table paiements), comme si Ornella les avait saisis.
//
// GoCardless → Développeurs → Webhooks → URL :
//   https://xvetwfqzkkcfchxxifuu.supabase.co/functions/v1/paiements-auto
//   ("Verify JWT" = OFF pour cette fonction)
// Secrets (Supabase → Edge Functions → Secrets, ou private.config) :
//   GOCARDLESS_WEBHOOK_SECRET  (secret affiché à la création du webhook)
//   GOCARDLESS_ACCESS_TOKEN    (jeton d'accès LECTURE seule, GoCardless → Développeurs)
//
// Paiement « confirmed » (argent encaissé) → on retrouve la cliente par email
// (email_perso), sinon par prénom + nom. Introuvable → tâche « paiement à rattacher »
// dans l'espace coach. Idempotent : un même paiement n'est jamais ajouté deux fois.
// Le « montant dû » saisi à la main est diminué d'autant (jamais en dessous de 0).
// Import de l'historique : POST ?import=AAAA-MM-JJ (&dry=1 pour un aperçu), header x-cron-secret.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secretKey: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

let DRY = false;   // mode « aperçu » de l'import historique (rien n'est écrit)
// ---- Rattachement à une cliente + enregistrement ---------------------------
async function enregistrer(p: {
  ref: string; montant: number; date: string; mode: string; email?: string; prenom?: string; nom?: string; libelle?: string;
}) {
  // Déjà enregistré ? (référence unique dans la note)
  const { data: deja } = await supa.from("paiements").select("id").ilike("note", `%${p.ref}%`).limit(1);
  if (deja && deja.length) return { deja: true };

  let cl: { id: string; prenom: string } | null = null;
  if (p.email) {
    const { data } = await supa.from("clientes").select("id,prenom").ilike("email_perso", p.email.trim()).limit(2);
    if (data && data.length === 1) cl = data[0];
  }
  if (!cl && p.prenom) {
    const { data } = await supa.from("clientes").select("id,prenom,nom");   // toutes (historique compris)
    const cand = (data || []).filter((c) => norm(c.prenom) === norm(p.prenom!) && (!p.nom || !c.nom || norm(c.nom) === norm(p.nom)));
    if (cand.length === 1) cl = cand[0];
  }
  const qui = [p.prenom, p.nom].filter(Boolean).join(" ") || p.email || "?";
  if (!cl) {
    if (DRY) return { introuvable: qui, montant: p.montant, date: p.date };
    await supa.from("taches_coach").insert({
      titre: `💳 Paiement reçu à rattacher : ${p.montant} € — ${qui} (${p.mode})`,
      echeance: p.date, priorite: "haute",
      note: `${p.libelle || ""} ${p.email ? "· " + p.email : ""} · réf ${p.ref}`.trim(),
    });
    return { a_rattacher: true };
  }
  // Déjà saisi à la main (même cliente, même montant, à ±6 jours, mode GoCardless) ? → on ne double pas.
  const d0 = new Date(p.date + "T00:00:00Z");
  const de = new Date(d0.getTime() - 6 * 864e5).toISOString().slice(0, 10);
  const a = new Date(d0.getTime() + 6 * 864e5).toISOString().slice(0, 10);
  const { data: manuels } = await supa.from("paiements").select("id,note").eq("cliente_id", cl.id).eq("montant", p.montant)
    .gte("date", de).lte("date", a).ilike("mode", "%gocardless%");
  if ((manuels || []).some((m) => !String(m.note || "").includes("réf "))) return { deja_saisi_main: cl.prenom, montant: p.montant, date: p.date };
  if (DRY) return { a_ajouter: cl.prenom, montant: p.montant, date: p.date };
  await supa.from("paiements").insert({
    cliente_id: cl.id, date: p.date, montant: p.montant, mode: p.mode,
    note: `${p.libelle || "Paiement automatique"} · réf ${p.ref}`,
  });
  // Diminue le « montant dû » manuel s'il y en a un.
  const { data: ac } = await supa.from("accompagnements").select("id,montant_du").eq("cliente_id", cl.id).limit(1);
  if (ac && ac.length && ac[0].montant_du != null && Number(ac[0].montant_du) > 0) {
    const reste = Math.max(0, Math.round((Number(ac[0].montant_du) - p.montant) * 100) / 100);
    await supa.from("accompagnements").update({ montant_du: reste }).eq("id", ac[0].id);
  }
  return { cliente: cl.prenom };
}

// ---- GoCardless --------------------------------------------------------------
async function gc(path: string, token: string) {
  const r = await fetch("https://api.gocardless.com" + path, {
    headers: { Authorization: "Bearer " + token, "GoCardless-Version": "2015-07-06", accept: "application/json" },
  });
  if (!r.ok) throw new Error("GoCardless " + path + " → " + r.status);
  return await r.json();
}

// Import de l'HISTORIQUE GoCardless (paiements encaissés depuis une date).
async function importer(depuis: string, token: string) {
  const out: unknown[] = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: "200", "charge_date[gte]": depuis });
    if (after) q.set("after", after);
    const j = await gc("/payments?" + q, token);
    for (const pay of j.payments || []) {
      if (!["confirmed", "paid_out"].includes(pay.status)) continue;
      try {
        const mandate = (await gc("/mandates/" + pay.links.mandate, token)).mandates;
        const cust = (await gc("/customers/" + mandate.links.customer, token)).customers;
        out.push(await enregistrer({
          ref: pay.id, montant: Number(pay.amount) / 100, date: pay.charge_date,
          mode: "GoCardless", email: cust.email, prenom: cust.given_name, nom: cust.family_name,
          libelle: pay.description || "Prélèvement GoCardless",
        }));
      } catch (e) { out.push({ erreur: String(e), paiement: pay.id }); }
    }
    after = j.meta?.cursors?.after || "";
    if (!after) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  DRY = false;   // jamais d'aperçu par défaut (le webhook enregistre toujours)
  const url = new URL(req.url);
  if (url.searchParams.get("import")) {
    const CRON = await secret("CRON_SECRET", "cron_secret");
    if (!CRON || req.headers.get("x-cron-secret") !== CRON) return new Response("Forbidden", { status: 403 });
    DRY = url.searchParams.get("dry") === "1";
    const TOK = await secret("GOCARDLESS_ACCESS_TOKEN", "gocardless_access_token");
    return Response.json({ dry: DRY, resultats: await importer(url.searchParams.get("import")!, TOK) });
  }
  const raw = await req.text();
  const WH = await secret("GOCARDLESS_WEBHOOK_SECRET", "gocardless_webhook_secret");
  const TOKEN = await secret("GOCARDLESS_ACCESS_TOKEN", "gocardless_access_token");
  if (!WH || !TOKEN) return new Response("secrets GoCardless manquants", { status: 503 });
  const sig = req.headers.get("webhook-signature") ?? "";
  if (sig !== (await hmac(WH, raw))) return new Response("signature invalide", { status: 498 });

  const events = (JSON.parse(raw).events || []) as Array<{ resource_type: string; action: string; links: { payment?: string } }>;
  const out: unknown[] = [];
  for (const ev of events) {
    if (ev.resource_type !== "payments" || ev.action !== "confirmed" || !ev.links?.payment) continue;
    try {
      const pay = (await gc("/payments/" + ev.links.payment, TOKEN)).payments;
      const mandate = (await gc("/mandates/" + pay.links.mandate, TOKEN)).mandates;
      const cust = (await gc("/customers/" + mandate.links.customer, TOKEN)).customers;
      out.push(await enregistrer({
        ref: pay.id, montant: Number(pay.amount) / 100, date: pay.charge_date || new Date().toISOString().slice(0, 10),
        mode: "GoCardless", email: cust.email, prenom: cust.given_name, nom: cust.family_name,
        libelle: pay.description || "Prélèvement GoCardless",
      }));
    } catch (e) { out.push({ erreur: String(e) }); }
  }
  return new Response(JSON.stringify({ ok: true, out }), { status: 200, headers: { "Content-Type": "application/json" } });
});
