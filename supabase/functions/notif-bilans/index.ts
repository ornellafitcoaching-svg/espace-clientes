// ============================================================================
// notif-bilans — prévient ORNELLA par email (Brevo) dès qu'une cliente envoie
// quelque chose depuis son espace : bilan des 4 semaines, mensurations, bilan
// de démarrage, questionnaire de départ, questionnaire alimentaire.
//
// Appelée toutes les 2 min par pg_cron. Regroupement : on attend 2 min après le
// DERNIER envoi d'une cliente → UN seul email par cliente (bilan + mensurations
// ensemble). Seules les lignes saisi_par = 'cliente' comptent : ce qu'Ornella
// saisit elle-même ne déclenche rien. Une ligne est notifiée une seule fois
// (colonne notif_coach_at, migration_23).
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
const ATTENTE_MIN = 2;   // délai de regroupement après le dernier envoi de la cliente
const TABLES = ["bilans", "mensurations", "bilans_demarrage", "questionnaire_initial", "questionnaire_nutrition"] as const;

async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fr = (ymd: string) => { const [y, m, d] = String(ymd).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const num = (v: unknown) => String(Number(v)).replace(".", ",");
function emailHtml(titre: string, corps: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1E1616;line-height:1.55">
  <div style="background:#2C1F1A;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="color:#C9957A;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Ornella Fit Coaching</div><div style="font-size:20px;font-weight:700;margin-top:4px">${titre}</div></div>
  <div style="background:#F7F3F0;padding:20px 22px;border-radius:0 0 14px 14px">${corps}</div></div>`;
}
async function send(subject: string, html: string) {
  if (!BREVO_KEY) return "pas de clé Brevo";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email: ORNELLA, name: "Ornella" }], subject, htmlContent: html }),
  });
  return r.ok ? "ok" : "erreur " + r.status;
}

const bloc = (titre: string, lignes: string[]) => lignes.length
  ? `<div style="background:#fff;border-radius:12px;padding:14px 16px;margin:0 0 12px"><div style="font-weight:700;color:#C96358;margin-bottom:6px">${titre}</div>${lignes.join("")}</div>` : "";
const ligne = (label: string, v: unknown, suffixe = "") => (v === null || v === undefined || v === "")
  ? "" : `<div style="margin:3px 0"><strong>${esc(label)} :</strong> ${esc(Array.isArray(v) ? v.join(", ") : v)}${suffixe}</div>`;

const MENSU: Record<string, string> = {
  poids: "Poids", masse_grasse: "Masse grasse", tour_taille: "Tour de taille", tour_hanches: "Tour de hanches",
  tour_fessiers: "Tour de fessiers", tour_cuisse: "Tour de cuisse", tour_bras: "Tour de bras", tour_mollet: "Tour de mollet",
  tour_dos: "Tour de dos", tour_cou: "Tour de cou", poitrine: "Poitrine", sous_poitrine: "Sous-poitrine",
};
const nomMensu = (t: string) => MENSU[t] ?? (t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " "));
const uniteMensu = (m: any) => m.unite || (m.type === "poids" ? "kg" : m.type === "masse_grasse" ? "%" : "cm");

Deno.serve(async (req) => {
  const CRON = await secret("CRON_SECRET", "cron_secret");
  if (!CRON || req.headers.get("x-cron-secret") !== CRON) return new Response("Forbidden", { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  // Tout ce que les clientes ont envoyé et qui n'a pas encore été signalé à Ornella.
  const lots: Record<string, Record<string, any[]>> = {};
  for (const t of TABLES) {
    const { data, error } = await supa.from(t).select("*").eq("saisi_par", "cliente").is("notif_coach_at", null);
    if (error) return Response.json({ erreur: `${t} : ${error.message}` }, { status: 500 });
    for (const r of data || []) ((lots[r.cliente_id] ||= {})[t] ||= []).push(r);
  }
  const ids = Object.keys(lots);
  if (!ids.length) return Response.json({ envois: [] });

  const { data: clientes } = await supa.from("clientes").select("id,prenom,nom").in("id", ids);
  const CL: Record<string, any> = {}; (clientes || []).forEach((c) => (CL[c.id] = c));

  const limite = Date.now() - ATTENTE_MIN * 60e3;
  const out: any[] = [];
  for (const id of ids) {
    const lot = lots[id];
    const tout = TABLES.flatMap((t) => lot[t] || []);
    const dernier = Math.max(...tout.map((r) => Date.parse(r.created_at)));
    const prenom = CL[id]?.prenom || "Une cliente";
    if (dernier > limite) { out.push({ cliente: prenom, statut: "en attente (regroupement)" }); continue; }

    const quoi: string[] = [];
    let corps = "";

    // --- Bilan des 4 semaines -------------------------------------------------
    for (const b of lot.bilans || []) {
      const r = b.reponses || {};
      corps += bloc(`📊 Bilan du ${fr(b.date)}`, [
        ligne("Poids", b.poids != null ? num(b.poids) + " kg" : ""),
        ligne("Ressenti", b.ressenti),
        ligne("Ce qui a changé", b.evolution),
        ligne("Son pourquoi", r.pourquoi_evolue),
        ligne("Sommeil", r.sommeil),
        ligne("Stress", r.stress != null && r.stress !== "" ? `${r.stress}/10` : ""),
        ligne("Énergie", r.energie != null && r.energie !== "" ? `${r.energie}/5` : ""),
        ligne("Motivation", r.motivation != null && r.motivation !== "" ? `${r.motivation}/5` : ""),
        ligne("Points positifs", b.points_positifs),
        ligne("Difficultés", b.difficultes),
        ligne("Objectifs atteints", b.objectifs_atteints),
        ligne("Nouveaux objectifs", b.nouveaux_objectifs),
      ].filter(Boolean));
    }
    if (lot.bilans?.length) quoi.push("son bilan");

    // --- Mensurations (avec l'écart par rapport à la mesure précédente) --------
    if (lot.mensurations?.length) {
      const ms = lot.mensurations;
      const idsLot = new Set(ms.map((m: any) => m.id));
      const { data: avant } = await supa.from("mensurations").select("id,type,valeur,date,created_at")
        .eq("cliente_id", id).in("type", [...new Set(ms.map((m: any) => m.type))]).order("date", { ascending: false }).order("created_at", { ascending: false });
      const lignes = ms.sort((a: any, b: any) => (a.type === "poids" ? -1 : b.type === "poids" ? 1 : nomMensu(a.type).localeCompare(nomMensu(b.type)))).map((m: any) => {
        const prec = (avant || []).find((p) => p.type === m.type && !idsLot.has(p.id) && String(p.date) < String(m.date));
        let ecart = "";
        if (prec) {
          const d = Math.round((Number(m.valeur) - Number(prec.valeur)) * 10) / 10;
          const coul = d < 0 ? "#2E8B57" : d > 0 ? "#C96358" : "#888";
          ecart = ` <span style="color:${coul};font-weight:700">(${d > 0 ? "+" : d < 0 ? "−" : "="}${d !== 0 ? num(Math.abs(d)) : ""} depuis le ${fr(prec.date)})</span>`;
        }
        return ligne(nomMensu(m.type), `${num(m.valeur)} ${uniteMensu(m)}`, ecart);
      });
      const dates = [...new Set(ms.map((m: any) => String(m.date)))].sort();
      corps += bloc(`📏 Mensurations du ${dates.map(fr).join(", ")}`, lignes);
      quoi.push("ses mensurations");
    }

    // --- Bilan de démarrage (retour sur les premières séances) -----------------
    for (const d of lot.bilans_demarrage || []) {
      corps += bloc(`🚀 Bilan de démarrage du ${fr(d.date)}`, [
        ligne("Douleurs / courbatures", d.douleur != null ? `${d.douleur}/10${d.douleur_zones ? ` (${d.douleur_zones})` : ""}` : ""),
        ligne("Intensité", d.intensite), ligne("Récupération", d.recuperation),
        ligne("Énergie", d.energie != null ? `${d.energie}/5` : ""), ligne("Motivation", d.motivation != null ? `${d.motivation}/5` : ""),
        ligne("Plaisir", d.plaisir != null ? `${d.plaisir}/5` : ""),
        ligne("Séances OK", d.seances_ok), ligne("Fréquence OK", d.frequence_ok),
        ligne("Exercices difficiles", d.exercices_difficiles), ligne("Exercices préférés", d.exercices_preferes),
        ligne("Gêne à signaler", d.gene_a_signaler), ligne("Commentaire", d.commentaire),
      ].filter(Boolean));
    }
    if (lot.bilans_demarrage?.length) quoi.push("son bilan de démarrage");

    // --- Questionnaire de départ : on remonte surtout « le pourquoi » -----------
    for (const q of lot.questionnaire_initial || []) {
      const r = q.reponses || {};
      corps += bloc("📝 Questionnaire de départ", [
        ligne("Pourquoi c'est important", r.objectifs_pourquoi),
        ligne("Ce qu'elle veut retrouver", r.retrouver),
        ligne("Si elle y arrivait", r.si_reussi),
        ligne("Si rien ne changeait", r.cout_statu_quo),
        ligne("Stress", r.stress != null && r.stress !== "" ? `${r.stress}/10` : ""),
        ligne("D'où vient son stress", r.stress_cause),
        ligne("Ce qui perturbe son sommeil", r.sommeil_pb),
        ligne("Pour souffler", r.souffler),
        `<div style="margin-top:6px;color:#6b5b55">Toutes ses réponses sont dans sa fiche.</div>`,
      ].filter(Boolean));
    }
    if (lot.questionnaire_initial?.length) quoi.push("son questionnaire de départ");

    if (lot.questionnaire_nutrition?.length) {
      corps += bloc("🥗 Questionnaire alimentaire", [`<div>Rempli — ses réponses sont dans sa fiche, onglet nutrition.</div>`]);
      if (!lot.questionnaire_initial?.length) quoi.push("son questionnaire alimentaire");
    }

    const liste = quoi.length > 1 ? quoi.slice(0, -1).join(", ") + " et " + quoi[quoi.length - 1] : quoi[0];
    const sujet = `📊 ${prenom} vient d'envoyer ${liste}`;
    const html = `<p style="margin-top:0"><strong>${esc(prenom)}${CL[id]?.nom ? " " + esc(CL[id].nom) : ""}</strong> vient d'envoyer ${esc(liste)} depuis son espace.</p>`
      + corps
      + `<p style="text-align:center;margin:20px 0 6px"><a href="${ESPACE}/cliente.html?id=${encodeURIComponent(id)}" style="background:#C96358;color:#fff;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:700">Ouvrir sa fiche</a></p>`;

    const statut = dry ? "dry" : await send(sujet, emailHtml(`${esc(prenom)} — ${esc(liste)}`, html));
    out.push({ cliente: prenom, quoi, statut, ...(dry ? { sujet, html } : {}) });
    if (statut !== "ok") continue;   // dry, ou échec Brevo → on retentera au prochain passage
    const now = new Date().toISOString();
    for (const t of TABLES) {
      const rows = lot[t] || [];
      if (rows.length) await supa.from(t).update({ notif_coach_at: now }).in("id", rows.map((r) => r.id));
    }
  }
  return Response.json({ envois: out });
});
