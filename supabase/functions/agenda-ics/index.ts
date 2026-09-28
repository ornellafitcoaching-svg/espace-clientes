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
// ---- Helpers dates (échéances : bilans / renouvellements de programmes) -----
const todayYMD = (): string => new Date().toISOString().slice(0, 10);
// "YYYY-MM-DD" -> "YYYYMMDD" (pour un événement "journée entière")
const dateOnly = (ymd: string): string => ymd.replace(/-/g, "");
// Décale une date de N jours (renvoie "YYYY-MM-DD").
function addDays(ymd: string, n: number): string {
  const [Y, M, D] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Décale une date de N mois (renvoie "YYYY-MM-DD"), comme Calc.dateFin côté front.
function addMonths(ymd: string, n: number): string {
  const [Y, M, D] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const maxDate = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : (a >= b ? a : b);
// Émet un VEVENT "journée entière" pour une échéance (bilan / renouvellement).
// UID stable → l'agenda déplace l'événement quand la date se recalcule (pas de doublon).
// Rappel la veille à 9h pour anticiper ("demain, X").
function echeanceVEVENT(uid: string, ymd: string, summary: string, dtstamp: string): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}@ornellafitcoaching`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dateOnly(ymd)}`,
    `DTEND;VALUE=DATE:${dateOnly(addDays(ymd, 1))}`,
    `SUMMARY:${esc(summary)}`,
    "STATUS:TENTATIVE",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:À prévoir", "TRIGGER:-PT15H", "END:VALARM",
    "END:VEVENT",
  ];
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

  // ---- Échéances (agenda COACH uniquement) : prochains bilans + renouvellements ----
  // On les calcule ici pour qu'Ornella les voie dans le même agenda que les séances,
  // sans rien réinstaller. Absent du flux d'une cliente (?code=) : ce sont des tâches coach.
  if (!clienteId) {
    const today = todayYMD();
    // On ne réclame plus rien pour une cliente terminée / en pause (filtré côté code
    // pour rester robuste aux statuts vides, qu'un NOT IN SQL exclurait à tort).
    const actives = ((await supabase
      .from("clientes")
      .select("id,prenom,type,statut")).data ?? [])
      .filter((c: any) => c.statut !== "termine" && c.statut !== "en_pause");
    const ids = actives.map((c: any) => c.id);
    if (ids.length) {
      const [accR, bilR, menR, qiR, progR] = await Promise.all([
        supabase.from("accompagnements").select("cliente_id,date_debut,nutrition_active").in("cliente_id", ids),
        supabase.from("bilans").select("cliente_id,date,saisi_par").in("cliente_id", ids),
        supabase.from("mensurations").select("cliente_id,date,saisi_par").in("cliente_id", ids),
        supabase.from("questionnaire_initial").select("cliente_id,date").in("cliente_id", ids),
        supabase.from("programmes").select("cliente_id,kind,envoye,date_envoi,date_fin,created_at").in("cliente_id", ids),
      ]);
      const acc: Record<string, any> = {};
      (accR.data ?? []).forEach((a: any) => { acc[a.cliente_id] = a; });
      const grp = (rows: any[]): Record<string, any[]> => {
        const m: Record<string, any[]> = {};
        (rows ?? []).forEach((r: any) => { (m[r.cliente_id] ||= []).push(r); });
        return m;
      };
      const bilBy = grp(bilR.data ?? []), menBy = grp(menR.data ?? []),
            qiBy = grp(qiR.data ?? []), progBy = grp(progR.data ?? []);
      // Dernière échéance d'un programme (date_fin saisie sinon dernier envoi + 1 mois).
      const progEcheance = (cid: string, kind: string): string | null => {
        const progs = (progBy[cid] ?? []).filter((p: any) => p.kind === kind && p.envoye);
        if (!progs.length) return null; // jamais envoyé → pas de date (visible dans « À traiter »)
        const d = progs.slice().sort((a: any, b: any) =>
          ((a.date_envoi || a.created_at || "") < (b.date_envoi || b.created_at || "") ? 1 : -1))[0];
        const dernier = d.date_envoi || (d.created_at ? String(d.created_at).slice(0, 10) : null);
        return d.date_fin || (dernier ? addMonths(dernier, 1) : null);
      };

      for (const c of actives as any[]) {
        const a = acc[c.id] || {};
        // Prochain bilan = dernier point (bilan OU mensurations saisies par la cliente) + 28 j.
        const dernierBilan = (bilBy[c.id] ?? []).map((x: any) => x.date).filter(Boolean).sort().slice(-1)[0] || null;
        const checkin = (menBy[c.id] ?? []).filter((m: any) => m.saisi_par === "cliente" && m.date)
          .map((m: any) => m.date).sort().slice(-1)[0] || null;
        const demarrage = (qiBy[c.id] ?? []).map((x: any) => x.date).filter(Boolean).sort()[0] || null;
        const ancre = maxDate(dernierBilan, checkin) || demarrage || a.date_debut || null;
        if (ancre) {
          let dBilan = addDays(ancre, 28);
          if (dBilan < today) dBilan = today; // en retard → épinglé à aujourd'hui (reste visible)
          // Présentiel/hybride = mensurations prises en séance ; distanciel = à demander.
          const verbe = c.type === "distanciel" ? "à demander" : "mensurations";
          L.push(...echeanceVEVENT(`echeance-bilan-${c.id}`, dBilan, `📊 Bilan ${c.prenom} (${verbe})`, dtstamp));
        }
        // Renouvellement programme entraînement (distanciel / hybride).
        if (c.type === "distanciel" || c.type === "hybride") {
          let e = progEcheance(c.id, "sportif");
          if (e) { if (e < today) e = today; L.push(...echeanceVEVENT(`echeance-prog-sportif-${c.id}`, e, `📤 Programme entraînement — ${c.prenom}`, dtstamp)); }
        }
        // Renouvellement nutrition (clientes avec suivi nutrition actif).
        if (a.nutrition_active) {
          let e = progEcheance(c.id, "nutrition");
          if (e) { if (e < today) e = today; L.push(...echeanceVEVENT(`echeance-prog-nutrition-${c.id}`, e, `🥗 Nutrition à renouveler — ${c.prenom}`, dtstamp)); }
        }
      }
    }
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
