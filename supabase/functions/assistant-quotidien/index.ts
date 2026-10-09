// ============================================================================
// assistant-quotidien — l'assistante d'Ornella, chaque matin (pg_cron, 7 h 45 Paris).
//
//  1) RAPPEL J-1 aux clientes (email Brevo) : « ta séance demain à … » + adresse.
//  2) RELANCE du questionnaire de démarrage (email) 3 jours après l'ouverture de
//     l'espace si la cliente ne l'a pas rempli.
//  3) RÉCAP du matin pour Ornella (email) : séances du jour (heure + adresse),
//     ce que les clientes ont rempli/envoyé hier, paiements reçus, paiements à
//     rattacher, qui doit de l'argent, fins de suivi à renouveler, et les rappels
//     WhatsApp à envoyer elle-même (clientes sans email) avec liens pré-remplis.
//
// Appel : header x-cron-secret (private.config cron_secret). ?dry=1 → n'envoie rien,
// renvoie le contenu (test). Une seule exécution par jour → aucun doublon.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SENDER = { email: "contact@ornellafitcoaching.com", name: "Ornella Fit Coaching" };
const ORNELLA = "ornellafit.coaching@gmail.com";
const ESPACE = "https://espace.ornellafitcoaching.com";
const WA_ORNELLA = "33756834626";

async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}
// Date du jour à Paris (YYYY-MM-DD) + décalage en jours.
function parisDay(offset = 0) {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function jourLong(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${JOURS[dt.getUTCDay()]} ${d} ${MOIS[m - 1]}`;
}
const h5 = (h: string | null) => (h ? String(h).slice(0, 5).replace(":", "h") : "");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const euro = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
function waLink(tel: string | null, msg: string) {
  let t = String(tel || "").replace(/[^\d+]/g, "");
  if (!t) return "";
  if (t.startsWith("+")) t = t.slice(1); else if (t.startsWith("0")) t = "33" + t.slice(1); else if (t.length === 9) t = "33" + t;
  return `https://wa.me/${t}?text=${encodeURIComponent(msg)}`;
}
function emailHtml(titre: string, corps: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1E1616;line-height:1.55">
  <div style="background:#2C1F1A;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="color:#C9957A;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Ornella Fit Coaching</div><div style="font-size:20px;font-weight:700;margin-top:4px">${titre}</div></div>
  <div style="background:#F7F3F0;padding:20px 22px;border-radius:0 0 14px 14px">${corps}</div></div>`;
}
async function send(to: string, name: string, subject: string, html: string, dry: boolean, replyTo = true) {
  if (dry) return "dry";
  if (!BREVO_KEY) return "pas de clé Brevo";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to, name }], subject, htmlContent: html, ...(replyTo ? { replyTo: { email: ORNELLA, name: "Ornella" } } : {}) }),
  });
  return r.ok ? "ok" : "erreur " + r.status;
}

Deno.serve(async (req) => {
  const CRON = await secret("CRON_SECRET", "cron_secret");
  if (!CRON || req.headers.get("x-cron-secret") !== CRON) return new Response("Forbidden", { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const today = parisDay(0), demain = parisDay(1), hier = parisDay(-1), j3 = parisDay(-3);

  const [{ data: clientes }, { data: seances }, { data: accs }, { data: pays }, { data: qi }, { data: qn }, { data: bil }, { data: taches }, { data: mens }] = await Promise.all([
    supa.from("clientes").select("id,prenom,nom,type,statut,email_perso,telephone,adresse,tutoiement,access_code,profile_id,created_at"),
    supa.from("seances").select("id,cliente_id,date,heure,duree,type,statut").in("date", [today, demain]).eq("statut", "prevue").order("heure"),
    supa.from("accompagnements").select("cliente_id,prix,montant_du,date_fin,formule"),
    supa.from("paiements").select("cliente_id,montant,date,mode,created_at"),
    supa.from("questionnaire_initial").select("cliente_id,created_at"),
    supa.from("questionnaire_nutrition").select("cliente_id,created_at"),
    supa.from("bilans").select("cliente_id,created_at,saisi_par"),
    supa.from("taches_coach").select("titre,echeance,faite").eq("faite", false),
    supa.from("mensurations").select("cliente_id,created_at,saisi_par"),
  ]);
  const CL: Record<string, any> = {}; (clientes || []).forEach((c) => (CL[c.id] = c));
  const AC: Record<string, any> = {}; (accs || []).forEach((a) => (AC[a.cliente_id] = a));
  const tu = (c: any, t: string, v: string) => (c?.tutoiement ? t : v);
  const depuisHier = (x: any) => x.created_at && String(x.created_at).slice(0, 10) >= hier;
  const out: any = { rappels: [], relances: [], recap: "" };
  const aEnvoyerWA: string[] = [];

  // ---- 1) Rappels J-1 ----------------------------------------------------
  for (const s of (seances || []).filter((x) => x.date === demain)) {
    const c = CL[s.cliente_id]; if (!c || c.statut === "termine") continue;
    const quand = `${jourLong(demain)}${s.heure ? " à " + h5(s.heure) : ""}`;
    const msg = `Coucou ${c.prenom} 😊 Petit rappel : ${tu(c, "on se voit", "nous nous voyons")} demain, ${quand} 💪 ${tu(c, "Pense", "Pensez")} à ${tu(c, "ta", "votre")} bouteille d'eau. À demain ! Ornella`;
    if (c.email_perso) {
      const corps = `<p>${tu(c, "Coucou", "Bonjour")} ${esc(c.prenom)} 😊</p><p>Petit rappel : ${tu(c, "on se voit", "nous nous voyons")} <strong>demain, ${esc(quand)}</strong>${s.type ? ` (${esc(s.type)})` : ""}.</p>${c.adresse && c.type !== "distanciel" ? `<p>📍 ${esc(c.adresse)}</p>` : ""}<p>${tu(c, "Pense", "Pensez")} à ${tu(c, "ta", "votre")} bouteille d'eau et une tenue confortable 💪</p><p>Un empêchement ? ${tu(c, "Préviens-moi", "Prévenez-moi")} au plus vite sur WhatsApp : <a href="https://wa.me/${WA_ORNELLA}">ici</a>.</p><p>À demain !<br>Ornella</p>`;
      out.rappels.push({ cliente: c.prenom, envoi: await send(c.email_perso, c.prenom, `Rappel : ta séance demain ${s.heure ? "à " + h5(s.heure) : ""}`.replace("ta séance", tu(c, "ta séance", "votre séance")), emailHtml("Ta séance de demain 💪".replace("Ta", tu(c, "Ta", "Votre")), corps), dry) });
    }
    const wa = c.email_perso ? "" : waLink(c.telephone, msg);   // pas d'email → rappel WhatsApp à envoyer en 1 clic
    if (wa) aEnvoyerWA.push(`<li><a href="${wa}">📲 Rappel WhatsApp à ${esc(c.prenom)}</a> (${esc(quand)})</li>`);
  }

  // ---- 2) Relance questionnaire (J+3, une seule fois) --------------------
  const qiSet = new Set((qi || []).map((x) => x.cliente_id));
  for (const c of clientes || []) {
    if (c.statut === "termine" || !c.profile_id || qiSet.has(c.id)) continue;
    if (String(c.created_at).slice(0, 10) !== j3) continue;
    const lien = `${ESPACE}/espace.html?code=${encodeURIComponent(c.access_code || "")}`;
    if (c.email_perso) {
      const corps = `<p>${tu(c, "Coucou", "Bonjour")} ${esc(c.prenom)} 😊</p><p>Pour que je puisse construire ${tu(c, "ton", "votre")} accompagnement sur-mesure, il me manque ${tu(c, "ton", "votre")} <strong>questionnaire de démarrage</strong>. C'est surtout des cases à cocher, et ${tu(c, "tu peux", "vous pouvez")} le faire en plusieurs fois.</p><p style="text-align:center;margin:22px 0"><a href="${lien}" style="background:#C96358;color:#fff;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:700">Remplir mon questionnaire</a></p><p>À très vite !<br>Ornella</p>`;
      out.relances.push({ cliente: c.prenom, envoi: await send(c.email_perso, c.prenom, `${c.prenom}, ${tu(c, "ton", "votre")} questionnaire t'attend 📋`.replace("t'attend", tu(c, "t'attend", "vous attend")), emailHtml(tu(c, "Ton", "Votre") + " questionnaire de démarrage 📋", corps), dry) });
    }
    const wa = c.email_perso ? "" : waLink(c.telephone, `Coucou ${c.prenom} 😊 Petit rappel : ${tu(c, "ton", "votre")} questionnaire de démarrage ${tu(c, "t'attend", "vous attend")} dans ${tu(c, "ton", "votre")} espace, c'est grâce à lui que je prépare tout pour ${tu(c, "toi", "vous")} 💪 ${lien}`);
    if (wa) aEnvoyerWA.push(`<li><a href="${wa}">📲 Relancer ${esc(c.prenom)} pour son questionnaire</a></li>`);
  }

  // ---- 3) Récap du matin pour Ornella ------------------------------------
  const ligne = (t: string) => `<li style="margin:4px 0">${t}</li>`;
  const bloc = (titre: string, items: string[]) => items.length ? `<h3 style="font-size:15px;margin:18px 0 6px;color:#C96358">${titre}</h3><ul style="padding-left:18px;margin:0">${items.join("")}</ul>` : "";
  const sJour = (seances || []).filter((x) => x.date === today).map((s) => {
    const c = CL[s.cliente_id] || {};
    const maps = c.adresse ? ` · <a href="https://maps.google.com/?q=${encodeURIComponent(c.adresse)}">itinéraire</a>` : "";
    return ligne(`<strong>${h5(s.heure) || "?"}</strong> — ${esc(c.prenom)}${c.adresse ? ` · ${esc(c.adresse)}` : ""}${maps}`);
  });
  const recus: string[] = [];
  (qi || []).filter(depuisHier).forEach((x) => recus.push(ligne(`📋 ${esc(CL[x.cliente_id]?.prenom)} a rempli son questionnaire de démarrage`)));
  (qn || []).filter(depuisHier).forEach((x) => recus.push(ligne(`🥗 ${esc(CL[x.cliente_id]?.prenom)} a rempli son questionnaire alimentaire`)));
  (bil || []).filter((x) => depuisHier(x) && x.saisi_par === "cliente").forEach((x) => recus.push(ligne(`📊 ${esc(CL[x.cliente_id]?.prenom)} a envoyé son bilan`)));
  const mensQui = new Set((mens || []).filter((x) => depuisHier(x) && x.saisi_par === "cliente").map((x) => x.cliente_id));
  mensQui.forEach((id) => recus.push(ligne(`📏 ${esc(CL[id]?.prenom)} a envoyé ses mensurations`)));
  const payes = (pays || []).filter(depuisHier).map((p) => ligne(`💶 ${esc(CL[p.cliente_id]?.prenom)} : ${euro(Number(p.montant))}${p.mode ? " (" + esc(p.mode) + ")" : ""}`));
  const rattacher = (taches || []).filter((t) => /rattacher/i.test(t.titre)).map((t) => ligne(esc(t.titre)));
  // Tâches / encaissements prévus aujourd'hui (ou oubliés les jours d'avant).
  const aFaire = (taches || []).filter((t) => !/rattacher/i.test(t.titre) && t.echeance && t.echeance <= today)
    .sort((a, b) => (a.echeance < b.echeance ? -1 : 1))
    .map((t) => ligne(`${esc(t.titre)}${t.echeance < today ? ` <span style="color:#C0564B">(depuis le ${jourLong(t.echeance)})</span>` : ""}`));
  const dettes: string[] = [];
  const fins: string[] = [];
  for (const c of clientes || []) {
    if (c.statut === "termine") continue;
    const a = AC[c.id]; if (!a) continue;
    // Seulement ce qu'Ornella a saisi comme « montant dû » (vrais retards), jamais le reste d'un contrat.
    const du = a.montant_du != null && a.montant_du !== "" ? Number(a.montant_du) : 0;
    if (du > 0.009) dettes.push(ligne(`${esc(c.prenom)} : ${euro(du)}`));
    if (a.date_fin && a.date_fin >= today && a.date_fin <= parisDay(14)) {
      const wa = waLink(c.telephone, `Coucou ${c.prenom} 😊 ${tu(c, "Ton", "Votre")} accompagnement se termine le ${jourLong(a.date_fin)}. On en parle pour la suite ? J'ai plein d'idées pour continuer ${tu(c, "tes", "vos")} progrès 💪`);
      fins.push(ligne(`${esc(c.prenom)} — fin le ${jourLong(a.date_fin)}${wa ? ` · <a href="${wa}">proposer de renouveler</a>` : ""}`));
    }
  }
  const envoyes = [
    ...out.rappels.map((r: any) => ligne(`✉️ Rappel de séance envoyé à ${esc(r.cliente)}`)),
    ...out.relances.map((r: any) => ligne(`✉️ Relance questionnaire envoyée à ${esc(r.cliente)}`)),
  ];
  const corps = `<p>Bonjour Ornella ☀️ Voici ta journée du <strong>${jourLong(today)}</strong>.</p>`
    + (sJour.length ? bloc(`📅 Tes séances aujourd'hui (${sJour.length})`, sJour) : `<p>📅 Aucune séance aujourd'hui.</p>`)
    + bloc("📌 À faire / à encaisser aujourd'hui", aFaire)
    + bloc("🆕 Reçu depuis hier", recus)
    + bloc("💶 Paiements reçus depuis hier", payes)
    + bloc("⚠️ Paiements à rattacher", rattacher)
    + bloc("📲 À envoyer toi-même sur WhatsApp (1 clic)", aEnvoyerWA)
    + bloc("🤖 Déjà fait pour toi", envoyes)
    + bloc("🔁 Fins de suivi dans les 14 jours", fins)
    + bloc("💳 On te doit encore", dettes)
    + `<p style="margin-top:20px"><a href="${ESPACE}/coach.html" style="color:#C96358;font-weight:700">Ouvrir mon espace coach →</a></p>`;
  out.recap = corps;
  out.recap_envoi = await send(ORNELLA, "Ornella", `☀️ Ta journée du ${jourLong(today)}${sJour.length ? ` — ${sJour.length} séance${sJour.length > 1 ? "s" : ""}` : ""}`, emailHtml("Ton récap du matin", corps), dry, false);
  return Response.json(out);
});
