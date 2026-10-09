// ============================================================================
// prospects.js — onglet « 🏢 Entreprises » de l'espace coach (privé, coach seule).
// Suivi du démarchage B2B : statut de chaque entreprise + prochaine action datée.
// Table prospects_b2b (RLS is_coach). Aucune donnée visible côté cliente.
// ============================================================================
const PRO_ST = [
  { k:"a_contacter", label:"À contacter", ico:"⚪" },
  { k:"contacte",    label:"Contactée",   ico:"📨" },
  { k:"relance",     label:"Relancée",    ico:"🔁" },
  { k:"rdv",         label:"Rendez-vous", ico:"📞" },
  { k:"devis",       label:"Devis envoyé",ico:"📄" },
  { k:"signe",       label:"Signée",      ico:"✅" },
  { k:"perdu",       label:"Pas intéressée", ico:"✖️" },
];
const PRO_LABEL = Object.fromEntries(PRO_ST.map(s => [s.k, s.ico + " " + s.label]));
let PRO_FILTRE = "actives";
let PRO_CACHE = null;

function proToday(){ const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function proAddDays(iso, n){ const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); }
function proFmt(iso){ if (!iso) return ""; const [y,m,d] = iso.split("-"); return `${d}/${m}`; }
function proEsc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

async function renderProspects(){
  const box = document.getElementById("prospects");
  if (!box) return;
  let P = PRO_CACHE;
  if (!P){
    const { data, error } = await sb.from("prospects_b2b").select("*").order("numero", { ascending:true });
    if (error){ box.innerHTML = `<div class="card">Impossible de charger les entreprises : ${proEsc(error.message)}</div>`; return; }
    P = PRO_CACHE = data || [];
  }
  const today = proToday(), dans7 = proAddDays(today, 7);
  const actives = P.filter(p => p.statut !== "signe" && p.statut !== "perdu");
  const aFaire = actives.filter(p => p.prochaine_action && p.prochaine_action <= dans7)
                        .sort((a,b) => (a.prochaine_action < b.prochaine_action ? -1 : 1));
  const compte = (k) => P.filter(p => p.statut === k).length;

  // --- Résumé : où en est le démarchage ---
  const tuiles = PRO_ST.filter(s => s.k !== "perdu").map(s => `
    <button class="pro-tile ${PRO_FILTRE===s.k?"on":""}" data-pro-filtre="${s.k}">
      <span class="n">${compte(s.k)}</span><span class="l">${s.ico} ${s.label}</span></button>`).join("");
  const signees = compte("signe");

  // --- À faire cette semaine ---
  const ligneAFaire = (p) => {
    const retard = p.prochaine_action < today;
    const quoi = { a_contacter:"Premier contact", contacte:"Relancer", relance:"Dernière relance", rdv:"Rendez-vous / rappeler", devis:"Relancer le devis" }[p.statut] || "À faire";
    return `<div class="pro-todo ${retard?"late":""}" data-pro-edit="${p.id}">
      <div class="d">${retard ? "⏰ en retard" : proFmt(p.prochaine_action)}</div>
      <div class="b"><strong>${proEsc(p.nom)}</strong> <span class="isub">· ${proEsc(p.ville||"")}</span>
        <div class="isub">${quoi} — ${proEsc(p.contact_comment||"")}</div></div></div>`;
  };

  // --- Liste filtrée ---
  const liste = (PRO_FILTRE === "actives" ? actives : PRO_FILTRE === "toutes" ? P : P.filter(p => p.statut === PRO_FILTRE));
  const carte = (p) => `<div class="pro-card">
      <div class="pro-top">
        <div><span class="pro-num">${p.numero!=null?"n°"+p.numero:""}</span> <strong>${proEsc(p.nom)}</strong>
          <div class="isub">${proEsc(p.ville||"")}${p.secteur?" · "+proEsc(p.secteur):""}</div></div>
        <select class="pro-sel" data-pro-statut="${p.id}" aria-label="Statut">
          ${PRO_ST.map(s => `<option value="${s.k}" ${p.statut===s.k?"selected":""}>${s.ico} ${s.label}</option>`).join("")}
        </select>
      </div>
      <div class="isub" style="margin-top:6px">📍 ${proEsc(p.contact_comment||"—")}</div>
      ${(p.contact_nom||p.contact_tel||p.contact_email) ? `<div class="isub">👤 ${proEsc([p.contact_nom,p.contact_tel,p.contact_email].filter(Boolean).join(" · "))}</div>` : ""}
      ${p.note ? `<div class="isub" style="color:var(--text-mid)">📝 ${proEsc(p.note)}</div>` : ""}
      <div class="pro-bot">
        <span class="isub">${p.prochaine_action ? `Prochaine action : <strong>${proFmt(p.prochaine_action)}</strong>` : "Pas de date"}${p.dernier_contact ? ` · dernier contact ${proFmt(p.dernier_contact)}` : ""}</span>
        <span>${p.site ? `<a class="link" href="${proEsc(p.site)}" target="_blank" rel="noopener">Site</a> · ` : ""}<button class="link" data-pro-edit="${p.id}">✏️ Modifier</button></span>
      </div></div>`;

  box.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h2 class="view-title" style="margin:0 0 4px">🏢 Démarchage entreprises</h2>
      <p class="isub" style="margin:0 0 12px">${P.length} entreprises · <strong style="color:var(--ok)">${signees} signée${signees>1?"s":""}</strong>. Change le statut d'une entreprise dès que tu la contactes : la date de relance se met toute seule (7 jours après).</p>
      <div class="pro-tiles">${tuiles}</div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 8px;font-size:1rem">📅 À faire cette semaine <span class="isub">(${aFaire.length})</span></h3>
      ${aFaire.length ? aFaire.map(ligneAFaire).join("") : `<p class="isub" style="margin:0">Rien à faire dans les 7 prochains jours 👍</p>`}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
      <button class="jchip ${PRO_FILTRE==="actives"?"jchip-accent":""}" data-pro-filtre="actives">En cours</button>
      <button class="jchip ${PRO_FILTRE==="toutes"?"jchip-accent":""}" data-pro-filtre="toutes">Toutes</button>
      <button class="jchip ${PRO_FILTRE==="perdu"?"jchip-accent":""}" data-pro-filtre="perdu">✖️ Pas intéressées (${compte("perdu")})</button>
      <button class="btn-accent btn-sm" data-pro-add style="margin-left:auto">＋ Ajouter une entreprise</button>
    </div>
    <div class="pro-list">${liste.length ? liste.map(carte).join("") : `<p class="empty">Aucune entreprise ici.</p>`}</div>`;
}

async function proSave(id, patch){
  patch.updated_at = new Date().toISOString();
  const { error } = await sb.from("prospects_b2b").update(patch).eq("id", id);
  if (error) throw error;
  const p = (PRO_CACHE||[]).find(x => x.id === id); if (p) Object.assign(p, patch);
}

async function proEdit(p){
  const v = await UI.form({ title: p ? "Modifier — " + p.nom : "Nouvelle entreprise", submit:"Enregistrer", fields:[
    { name:"nom", label:"Entreprise", required:true, value:p?p.nom:"" },
    { name:"ville", label:"Ville", half:true, value:p?p.ville||"":"" },
    { name:"secteur", label:"Secteur", half:true, value:p?p.secteur||"":"" },
    { name:"statut", label:"Où tu en es", type:"select", half:true, value:p?p.statut:"a_contacter", options:PRO_ST.map(s=>({ value:s.k, label:s.ico+" "+s.label })) },
    { name:"prochaine_action", label:"Prochaine action le", type:"date", half:true, value:p?p.prochaine_action||"":proToday() },
    { name:"contact_comment", label:"Comment les contacter", value:p?p.contact_comment||"":"", placeholder:"Ex. accueil, formulaire, LinkedIn RH…" },
    { name:"contact_nom", label:"Nom du contact", half:true, value:p?p.contact_nom||"":"", placeholder:"Ex. Mme Durand (RH)" },
    { name:"contact_tel", label:"Téléphone", half:true, value:p?p.contact_tel||"":"" },
    { name:"contact_email", label:"Email", value:p?p.contact_email||"":"" },
    { name:"site", label:"Site web", value:p?p.site||"":"" },
    { name:"note", label:"Note", type:"textarea", value:p?p.note||"":"", placeholder:"Ce qu'ils ont dit, à qui tu as parlé…" },
  ]});
  if (!v) return;
  const row = { nom:v.nom.trim(), ville:v.ville||null, secteur:v.secteur||null, statut:v.statut, prochaine_action:v.prochaine_action||null,
    contact_comment:v.contact_comment||null, contact_nom:v.contact_nom||null, contact_tel:v.contact_tel||null,
    contact_email:v.contact_email||null, site:v.site||null, note:v.note||null };
  try{
    if (p){ await proSave(p.id, row); }
    else {
      const num = Math.max(0, ...(PRO_CACHE||[]).map(x => x.numero||0)) + 1;
      const { data, error } = await sb.from("prospects_b2b").insert({ ...row, numero:num }).select().single();
      if (error) throw error;
      (PRO_CACHE = PRO_CACHE || []).push(data);
    }
    UI.toast("Enregistré ✓"); renderProspects();
  }catch(e){ console.error(e); UI.toast(UI.errText ? UI.errText(e) : String(e.message||e), "err"); }
}

document.addEventListener("click", (e) => {
  const box = document.getElementById("prospects");
  if (!box || !box.contains(e.target)) return;
  const f = e.target.closest("[data-pro-filtre]");
  if (f){ PRO_FILTRE = f.dataset.proFiltre; renderProspects(); return; }
  if (e.target.closest("[data-pro-add]")) return proEdit(null);
  const ed = e.target.closest("[data-pro-edit]");
  if (ed){ const p = (PRO_CACHE||[]).find(x => x.id === ed.dataset.proEdit); if (p) proEdit(p); }
});
document.addEventListener("change", async (e) => {
  const sel = e.target.closest && e.target.closest("[data-pro-statut]");
  if (!sel) return;
  const id = sel.dataset.proStatut, st = sel.value, today = proToday();
  const p = (PRO_CACHE||[]).find(x => x.id === id); const avant = p ? p.statut : null;
  const patch = { statut: st };
  // Contactée / relancée → on note la date et on programme la relance à J+7.
  if (st === "contacte" || st === "relance"){ patch.dernier_contact = today; patch.prochaine_action = proAddDays(today, 7); }
  if (st === "devis"){ patch.dernier_contact = today; patch.prochaine_action = proAddDays(today, 5); }
  if (st === "signe" || st === "perdu"){ patch.prochaine_action = null; }
  try{ await proSave(id, patch); UI.toast(PRO_LABEL[st] + (patch.prochaine_action ? ` · relance le ${proFmt(patch.prochaine_action)}` : "")); renderProspects(); }
  catch(err){ console.error(err); if (p) p.statut = avant; sel.value = avant; UI.toast("Pas enregistré, réessaie", "err"); }
});
