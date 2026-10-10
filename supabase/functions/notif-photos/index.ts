// ============================================================================
// notif-photos — prévient la cliente par email (Brevo) quand Ornella partage des
// photos de suivi avec elle (visibilite = 'cliente').
//
// Appelée toutes les 5 min par pg_cron. Regroupement : on attend 10 min après la
// DERNIÈRE photo rendue visible pour une cliente → UN seul email par série.
// Les photos « privé (coach) » ne déclenchent jamais rien.
// Une photo est notifiée une seule fois (photos.notif_envoyee_at).
//
// Appel : header x-cron-secret (private.config cron_secret). ?dry=1 → n'envoie rien
// et ne marque rien, renvoie ce qui partirait (test).
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SENDER = { email: "contact@ornellafitcoaching.com", name: "Ornella Fit Coaching" };
const ORNELLA = "ornellafit.coaching@gmail.com";
const ESPACE = "https://espace.ornellafitcoaching.com";
const ATTENTE_MIN = 10;   // délai de regroupement après la dernière photo

async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const jourMois = (ymd: string) => { const [, m, d] = ymd.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MOIS[m - 1]}`; };
// « du 10 octobre » · « du 3 et du 10 octobre » · « du 28 septembre, du 3 et du 10 octobre »
function lesDates(dates: string[]) {
  const l = dates.map(jourMois);
  return "du " + (l.length === 1 ? l[0] : l.slice(0, -1).join(", du ") + " et du " + l[l.length - 1]);
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function emailHtml(titre: string, corps: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1E1616;line-height:1.55">
  <div style="background:#2C1F1A;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="color:#C9957A;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Ornella Fit Coaching</div><div style="font-size:20px;font-weight:700;margin-top:4px">${titre}</div></div>
  <div style="background:#F7F3F0;padding:20px 22px;border-radius:0 0 14px 14px">${corps}</div></div>`;
}
async function send(to: string, name: string, subject: string, html: string) {
  if (!BREVO_KEY) return "pas de clé Brevo";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to, name }], subject, htmlContent: html, replyTo: { email: ORNELLA, name: "Ornella" } }),
  });
  return r.ok ? "ok" : "erreur " + r.status;
}

Deno.serve(async (req) => {
  const CRON = await secret("CRON_SECRET", "cron_secret");
  if (!CRON || req.headers.get("x-cron-secret") !== CRON) return new Response("Forbidden", { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const { data: photos, error } = await supa.from("photos")
    .select("id,cliente_id,date,visible_depuis,created_at")
    .eq("visibilite", "cliente").is("notif_envoyee_at", null);
  if (error) return Response.json({ erreur: error.message }, { status: 500 });

  const parCliente: Record<string, any[]> = {};
  for (const p of photos || []) (parCliente[p.cliente_id] ||= []).push(p);
  const ids = Object.keys(parCliente);
  if (!ids.length) return Response.json({ series: [] });

  const { data: clientes } = await supa.from("clientes")
    .select("id,prenom,email_perso,tutoiement,access_code,profile_id").in("id", ids);
  const CL: Record<string, any> = {}; (clientes || []).forEach((c) => (CL[c.id] = c));
  // Clientes qui ont DÉJÀ des photos partagées avant cette série → sinon ce sont ses photos de départ.
  const { data: anciennes } = await supa.from("photos").select("cliente_id")
    .eq("visibilite", "cliente").not("notif_envoyee_at", "is", null).in("cliente_id", ids);
  const dejaPhotos = new Set((anciennes || []).map((p) => p.cliente_id));

  const limite = Date.now() - ATTENTE_MIN * 60e3;
  const out: any[] = [];
  for (const id of ids) {
    const lot = parCliente[id];
    const derniere = Math.max(...lot.map((p) => Date.parse(p.visible_depuis || p.created_at)));
    if (derniere > limite) { out.push({ cliente: CL[id]?.prenom, photos: lot.length, statut: "en attente (regroupement)" }); continue; }

    const c = CL[id];
    let statut: string;
    if (!c || !c.email_perso) statut = "pas d'email → badge seulement";
    else if (!c.profile_id) statut = "pas d'accès cliente → pas d'email";
    else {
      const tu = (t: string, v: string) => (c.tutoiement ? t : v);   // réglage « tutoiement » de la fiche
      const dates = [...new Set(lot.map((p) => String(p.date)))].sort();
      const quand = lesDates(dates);
      const n = lot.length;
      const lien = `${ESPACE}/espace.html?${c.access_code ? "code=" + encodeURIComponent(c.access_code) + "&" : ""}v=photos`;
      const depart = !dejaPhotos.has(id);   // 1re série : pas de comparaison possible
      const corps = `<p>${tu("Coucou", "Bonjour")} ${esc(c.prenom)} !</p>`
        + (depart
          ? `<p>${tu("Tes", "Vos")} photos de départ ${quand} sont dans ${tu("ton", "votre")} espace 📸</p>`
            + `<p>C'est ${tu("ton", "votre")} point de départ : dans quelques semaines, on refera les mêmes et ${tu("tu pourras", "vous pourrez")} voir ${tu("ta", "votre")} transformation côte à côte 💪</p>`
          : `<p>${tu("Tes", "Vos")} photos de suivi ${quand} sont dispo dans ${tu("ton", "votre")} espace 📸</p>`
            + `<p>${n > 1 ? `${n} photos ${tu("t'attendent", "vous attendent")}` : `Une photo ${tu("t'attend", "vous attend")}`} : ${tu("prends", "prenez")} un moment pour comparer avec ${tu("tes", "vos")} débuts, ${tu("tu vas voir", "vous allez voir")} le chemin parcouru 💪</p>`)
        + `<p style="text-align:center;margin:22px 0"><a href="${lien}" style="background:#C96358;color:#fff;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:700">Voir mes photos</a></p>`
        + `<p>${tu("Tes", "Vos")} photos restent 100 % privées : il n'y a que ${tu("toi", "vous")} et moi qui y avons accès 💛</p>`
        + `<p>À très vite !<br>Ornella</p>`;
      const sujet = depart
        ? `${c.prenom}, ${tu("tes", "vos")} photos de départ sont dans ${tu("ton", "votre")} espace 📸`
        : `${c.prenom}, ${tu("tes", "vos")} photos de suivi ${quand} sont dispo 📸`;
      statut = dry ? "dry" : await send(c.email_perso, c.prenom, sujet, emailHtml(depart ? `${tu("Tes", "Vos")} photos de départ 📸` : `${tu("Tes", "Vos")} nouvelles photos 📸`, corps));
      out.push({ cliente: c.prenom, photos: n, statut, ...(dry ? { sujet, html: corps } : {}) });
      if (statut !== "ok") continue;   // échec Brevo → on retentera au prochain passage
    }
    if (statut !== "ok") out.push({ cliente: c?.prenom, photos: lot.length, statut });
    // Série traitée (email parti, ou impossible faute d'email/accès) → plus jamais renvoyée.
    if (!dry) await supa.from("photos").update({ notif_envoyee_at: new Date().toISOString() }).in("id", lot.map((p) => p.id));
  }
  return Response.json({ series: out });
});
