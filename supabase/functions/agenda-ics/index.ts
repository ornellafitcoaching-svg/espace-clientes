// ============================================================================
// agenda-ics — Flux calendrier (iCalendar/.ics) des séances clientes.
//
// Apple Calendrier (ou Google Agenda) s'y ABONNE une seule fois ; le flux est
// régénéré en direct depuis Supabase à chaque rafraîchissement → toute séance
// ajoutée / modifiée / annulée dans l'espace se répercute automatiquement, sans
// doublon (chaque séance a un UID stable → l'agenda met à jour l'événement).
//
// Sécurité : lien secret via ?token=... (aucune donnée n'est accessible sans le
// bon jeton). Lit la base avec la clé service role (contourne la RLS, lecture seule).
//
// Déploiement : Supabase → Edge Functions → agenda-ics, "Verify JWT" = OFF.
// URL : https://xvetwfqzkkcfchxxifuu.supabase.co/functions/v1/agenda-ics?token=SECRET
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Jeton secret : lu depuis la variable d'environnement ICS_TOKEN (secret Supabase),
// JAMAIS écrit en dur (le repo est public). Défini dans Edge Functions → Secrets.
const TOKEN = Deno.env.get("ICS_TOKEN") ?? "";

// Échappe le texte pour le format iCalendar.
function esc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
// "YYYY-MM-DD" + "HH:MM(:SS)"|null  ->  "YYYYMMDDTHHMMSS" (heure locale Paris)
function stamp(date: string, heure: string | null, addMin = 0): string {
  const [Y, M, D] = date.split("-").map(Number);
  let hh = 9, mm = 0; // défaut 9h si aucune heure saisie
  if (heure) { const p = heure.split(":"); hh = Number(p[0]); mm = Number(p[1] || 0); }
  // On ajoute la durée via un Date UTC (composants "flottants") pour gérer les
  // débordements d'heure ; le libellé TZID=Europe/Paris fixe le fuseau.
  const d = new Date(Date.UTC(Y, M - 1, D, hh, mm + addMin, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}
function nowStampUTC(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const code = url.searchParams.get("code"); // lien perso cliente (= son code d'accès)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Deux accès possibles :
  //  • ?token=  → agenda COACH (toutes les clientes)
  //  • ?code=   → agenda d'UNE cliente (uniquement SES séances ; clé = son code d'accès)
  let clienteId: string | null = null;
  if (TOKEN && token === TOKEN) {
    // coach : pas de filtre
  } else if (code) {
    const { data: cl } = await supabase
      .from("clientes").select("id").ilike("access_code", code).maybeSingle();
    if (!cl) return new Response("Forbidden", { status: 403 });
    clienteId = (cl as any).id;
  } else {
    return new Response("Forbidden", { status: 403 });
  }

  // Fenêtre : 30 jours en arrière → futur. Non annulées.
  const depuis = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
  let q = supabase
    .from("seances")
    .select("id,date,heure,type,duree,statut,objectif,clientes(prenom,nom,type,adresse)")
    .neq("statut", "annulee")
    .gte("date", depuis)
    .order("date");
  if (clienteId) q = q.eq("cliente_id", clienteId);
  const { data, error } = await q;

  if (error) return new Response(error.message, { status: 500 });

  const dtstamp = nowStampUTC();
  const L: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ornella Fit Coaching//Agenda seances//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Séances clientes",
    "X-WR-TIMEZONE:Europe/Paris",
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
  ];

  for (const s of (data ?? [])) {
    // Exclut les fausses séances CRM reconstituées (réalisées, datées du 31/08/2026,
    // sans heure) — mêmes que celles masquées dans l'espace, sinon doublons agenda.
    if ((s as any).statut === "realisee" && (s as any).date === "2026-08-31") continue;
    const cl = (s as any).clientes || {};
    const duree = Number((s as any).duree) || 60;
    const start = stamp((s as any).date, (s as any).heure);
    const end = stamp((s as any).date, (s as any).heure, duree);
    const prenom = cl.prenom || "Cliente";
    const typeCl = cl.type ? ` (${cl.type})` : "";
    const typeSeance = (s as any).type ? ` — ${(s as any).type}` : "";
    const fait = (s as any).statut === "realisee" ? "✅ " : "🏋️ ";
    const summary = `${fait}${prenom}${typeCl}${typeSeance}`;

    L.push("BEGIN:VEVENT");
    L.push(`UID:seance-${(s as any).id}@ornellafitcoaching`);
    L.push(`DTSTAMP:${dtstamp}`);
    L.push(`DTSTART;TZID=Europe/Paris:${start}`);
    L.push(`DTEND;TZID=Europe/Paris:${end}`);
    L.push(`SUMMARY:${esc(summary)}`);
    if (cl.adresse) L.push(`LOCATION:${esc(cl.adresse)}`);
    if ((s as any).objectif) L.push(`DESCRIPTION:${esc((s as any).objectif)}`);
    L.push((s as any).statut === "realisee" ? "STATUS:CONFIRMED" : "STATUS:TENTATIVE");
    // Rappel 2h avant (uniquement pour les séances à venir, pas les faites).
    if ((s as any).statut !== "realisee") {
      L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Séance", "TRIGGER:-PT2H", "END:VALARM");
    }
    L.push("END:VEVENT");
  }

  L.push("END:VCALENDAR");
  const body = L.join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0",
      "Content-Disposition": 'inline; filename="seances.ics"',
    },
  });
});
