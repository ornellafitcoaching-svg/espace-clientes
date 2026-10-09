// ============================================================================
// 💰 Mes finances — réservé à la coach (table « finances » protégée : RLS is_coach,
// aucun accès anonyme). Tout est recalculé à chaque ouverture depuis la base :
//  - encaissé = table paiements (GoCardless + Stripe arrivent tout seuls), hors lignes ⚠️
//  - prévu    = rentrées attendues ; cochée « reçue » dès qu'un paiement de la cliente
//               arrive le même mois (ou bouton ✅ Reçu → crée le paiement dans sa fiche)
//  - autres revenus (Vinted, LinkedIn…), prélèvements fixes CIC, virement Revolut → CIC
// ============================================================================
const FIN = { TAUX_URSSAF: 0.258 };   // micro-entreprise BNC 2026 : 25,6 % + CFP 0,2 %

async function renderFinances(){
  const box = document.getElementById("finances");
  if (!box) return;
  const euro = Calc.euro;
  const r2 = n => Math.round(n*100)/100;
  let F = [], P = [];
  try {
    const [a, b] = await Promise.all([
      sb.from("finances").select("*").order("mois",{ascending:true}).order("created_at",{ascending:true}),
      sb.from("paiements").select("id,cliente_id,montant,date,mode,note"),
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    F = a.data || []; P = (b.data || []).filter(p => !String(p.note||"").startsWith("⚠️"));
  } catch(e){
    box.innerHTML = `<div class="card" style="margin-top:14px;color:var(--accent)">Finances indisponibles : ${esc(UI.errText ? UI.errText(e) : String(e))}</div>`;
    return;
  }
  const nom = id => { const c = (STATE.clientes||[]).find(x => String(x.cliente.id) === String(id)); return c ? String(c.cliente.prenom||"").trim() : ""; };
  const ym = d => String(d||"").slice(0,7);
  const now = ym(Calc.today());
  const addM = (m, k) => { const [y,mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo-1+k, 1)); return d.toISOString().slice(0,7); };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const sansAccent = t => String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
  const libM = m => { const [y,mo] = m.split("-").map(Number); return new Date(y, mo-1, 1).toLocaleDateString("fr-FR",{month:"long", year:"numeric"}); };

  // ---- Rapprochement prévu ↔ paiements reçus (même cliente, même mois) -------
  const payPool = {};   // "cliente|mois" → montant reçu restant à affecter
  P.forEach(p => { const k = p.cliente_id+"|"+ym(p.date); payPool[k] = (payPool[k]||0) + Number(p.montant||0); });
  const prevus = F.filter(f => f.kind === "prevu");
  prevus.forEach(f => {
    const m = ym(f.mois);
    if (f.fait) { f._recu = true; return; }
    if (f.cliente_id){
      const k = f.cliente_id+"|"+m;
      if ((payPool[k]||0) >= Number(f.montant) - 0.01){ payPool[k] -= Number(f.montant); f._recu = true; return; }
    }
    f._recu = false;
  });

  const charges = F.filter(f => f.kind === "charge");
  const totalCharges = r2(charges.reduce((s,f)=>s+Number(f.montant||0),0));

  // ---- Mois affichés : depuis janvier 2026 (ou 1er paiement) jusqu'à +2 mois -----
  const mois = [];
  for (let m = "2026-01"; m <= addM(now, 2); m = addM(m, 1)) mois.push(m);
  const ligne = m => {
    const encaisse = r2(P.filter(p => ym(p.date) === m).reduce((s,p)=>s+Number(p.montant||0),0)
                      + prevus.filter(f => ym(f.mois) === m && f.fait && !f.cliente_id).reduce((s,f)=>s+Number(f.montant),0));
    const attendu = m >= now ? r2(prevus.filter(f => ym(f.mois) === m && !f._recu).reduce((s,f)=>s+Number(f.montant),0)) : 0;
    const revPro = r2(F.filter(f => f.kind==="revenu" && f.pro && ym(f.mois)===m).reduce((s,f)=>s+Number(f.montant),0));
    const revPerso = r2(F.filter(f => f.kind==="revenu" && !f.pro && ym(f.mois)===m).reduce((s,f)=>s+Number(f.montant),0));
    const coaching = r2(encaisse + attendu);
    const urssaf = r2((coaching + revPro) * FIN.TAUX_URSSAF);
    const pourToi = r2(coaching + revPro - urssaf + revPerso - totalCharges);
    return { m, encaisse, attendu, revPro, revPerso, coaching, urssaf, pourToi, futur: m > now, courant: m === now };
  };
  const L = mois.map(ligne).filter(l => l.coaching || l.revPro || l.revPerso || l.m >= now);
  const cur = L.find(l => l.courant) || ligne(now);

  // ---- Virement Revolut → CIC du mois -------------------------------------
  const vir = F.find(f => f.kind === "virement" && ym(f.mois) === now);
  const virHtml = totalCharges > 0
    ? (vir && vir.fait
        ? `<div class="card" style="margin-top:10px;padding:10px 14px;border-left:4px solid #4a8b5c">✅ <strong>Virement Revolut → CIC fait</strong> pour ${libM(now)} (${euro(vir.montant)}) <button class="btn-ghost" data-fin-virundo="${vir.id}" style="float:right;padding:2px 8px;font-size:.75rem">Annuler</button></div>`
        : `<div class="card" style="margin-top:10px;padding:10px 14px;border-left:4px solid var(--accent)">🏦 <strong>À virer de Revolut vers CIC ce mois-ci : ${euro(totalCharges)}</strong><br><span class="isub">Le total de tes prélèvements fixes CIC.</span><div style="margin-top:8px"><button class="btn-accent" data-fin-virok="1">✅ C'est fait</button></div></div>`)
    : `<div class="card" style="margin-top:10px;padding:10px 14px;border-left:4px solid var(--gold)">🏦 Ajoute tes <strong>prélèvements fixes CIC</strong> (plus bas) : je calculerai ce que tu dois virer de Revolut vers CIC chaque mois.</div>`;

  // ---- Tuiles du mois en cours ----------------------------------------------
  const tuiles = `<div class="summary" style="margin-top:8px;background:var(--dark);border-radius:16px;padding:14px 16px">
    <div class="sum-item"><div class="k">Encaissé ${libM(now).split(" ")[0]}</div><div class="v">${euro(cur.encaisse)}</div></div>
    <div class="sum-item"><div class="k">Encore attendu</div><div class="v" style="color:#ffc2b8">${euro(cur.attendu)}</div></div>
    <div class="sum-item"><div class="k">URSSAF à garder</div><div class="v">${euro(cur.urssaf)}</div></div>
    <div class="sum-item"><div class="k">Reste pour toi</div><div class="v" style="color:${cur.pourToi<0?"#ffc2b8":"#a8e6bb"}">${euro(cur.pourToi)}</div></div>
  </div>`;

  // ---- Tableau mois par mois ---------------------------------------------
  const tableau = `<div class="card" style="margin-top:6px;padding:4px 12px">${L.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line-soft);${l.courant?"background:rgba(201,99,88,.06);margin:0 -12px;padding:9px 12px;":""}">
      <div style="flex:1;min-width:0">
        <strong>${cap(libM(l.m))}</strong>${l.futur?` <span class="badge">prévu</span>`:l.courant?` <span class="badge">en cours</span>`:""}
        <div class="isub" style="margin-top:2px;font-size:.8rem">Coaching ${euro(l.coaching)}${l.attendu?` (dont ${euro(l.attendu)} attendu)`:""}${l.revPro+l.revPerso?` · autres ${euro(l.revPro+l.revPerso)}`:""}</div>
        <div class="isub" style="font-size:.8rem">URSSAF −${euro(l.urssaf)}${totalCharges?` · prélèvements −${euro(totalCharges)}`:""}</div>
      </div>
      <div style="text-align:right;white-space:nowrap"><div class="isub">pour toi</div><strong style="font-size:1rem;color:${l.pourToi<0?"var(--accent)":"#2f7a46"}">${euro(l.pourToi)}</strong></div>
    </div>`).join("")}</div>
    <p class="isub" style="margin-top:6px">« Coaching » = paiements reçus (GoCardless et Stripe arrivent tout seuls) + ce qui est encore attendu. URSSAF ≈ 25,8 % de ce que tu encaisses en pro : à mettre de côté chaque mois.</p>`;

  // ---- Rentrées prévues (mois en cours + 2) + retards ---------------------
  const enRetard = prevus.filter(f => ym(f.mois) < now && !f._recu);
  const prochains = prevus.filter(f => ym(f.mois) >= now && ym(f.mois) <= addM(now,2));
  const lignePrevu = f => `<div class="cl-line" style="padding:7px 0;align-items:center;gap:8px;border-top:1px solid var(--line-soft)">
      <span style="flex:1;min-width:0">${f._recu?"✅":"⏳"} <strong>${esc(f.libelle)}</strong>${f.cliente_id&&!sansAccent(f.libelle).startsWith(sansAccent(nom(f.cliente_id)))?` <span class="isub">${esc(nom(f.cliente_id))}</span>`:""}
        <span class="isub"> · ${cap(libM(ym(f.mois)))}</span></span>
      <strong style="white-space:nowrap">${euro(f.montant)}</strong>
      ${f._recu ? (f.fait && !f.cliente_id ? `<button class="btn-ghost" data-fin-unfait="${f.id}" style="padding:2px 8px;font-size:.72rem">Annuler</button>` : `<span class="isub" style="white-space:nowrap">reçu</span>`)
               : `<button class="btn-accent" data-fin-recu="${f.id}" style="padding:3px 9px;font-size:.74rem;white-space:nowrap">✅ Reçu</button>`}
      <button class="btn-ghost" data-fin-edit="${f.id}" title="Modifier" style="padding:2px 7px;font-size:.74rem">✏️</button>
      <button class="btn-ghost" data-fin-del="${f.id}" title="Supprimer" style="padding:2px 7px;font-size:.74rem">🗑</button>
    </div>`;
  const blocPrevu = `<div class="card" style="margin-top:6px;padding:6px 12px">
      ${enRetard.length?`<div style="color:var(--accent);font-weight:700;font-size:.8rem;margin:6px 0">⚠️ Pas encore reçu (mois passé) :</div>${enRetard.map(lignePrevu).join("")}`:""}
      ${prochains.length?prochains.map(lignePrevu).join(""):`<p class="isub" style="padding:8px 0">Aucune rentrée prévue. Ajoute tes échéances pour voir ton prévisionnel.</p>`}
      <div style="margin:10px 0 4px"><button class="btn-ghost" data-fin-add="prevu">＋ Rentrée prévue</button></div>
    </div>`;

  // ---- Autres revenus + charges fixes --------------------------------------
  const autres = F.filter(f => f.kind === "revenu" && ym(f.mois) >= addM(now,-2)).sort((a,b)=>a.mois<b.mois?1:-1);
  const ligneSimple = f => `<div class="cl-line" style="padding:7px 0;align-items:center;gap:8px;border-top:1px solid var(--line-soft)">
      <span style="flex:1;min-width:0"><strong>${esc(f.libelle)}</strong>${f.kind==="revenu"?`<span class="isub"> · ${cap(libM(ym(f.mois)))}${f.pro?" · pro":""}</span>`:""}${f.note?`<span class="isub"> · ${esc(f.note)}</span>`:""}</span>
      <strong style="white-space:nowrap">${euro(f.montant)}</strong>
      <button class="btn-ghost" data-fin-edit="${f.id}" title="Modifier" style="padding:2px 7px;font-size:.74rem">✏️</button>
      <button class="btn-ghost" data-fin-del="${f.id}" title="Supprimer" style="padding:2px 7px;font-size:.74rem">🗑</button></div>`;
  const blocAutres = `<div class="card" style="margin-top:6px;padding:6px 12px">
      ${autres.length?autres.map(ligneSimple).join(""):`<p class="isub" style="padding:8px 0">Vinted, LinkedIn… note ici ce qui rentre à côté pour voir ton vrai total du mois.</p>`}
      <div style="margin:10px 0 4px"><button class="btn-ghost" data-fin-add="revenu">＋ Autre revenu</button></div></div>`;
  const blocCharges = `<div class="card" style="margin-top:6px;padding:6px 12px">
      ${charges.length?charges.map(ligneSimple).join("")+`<div class="cl-line" style="padding:8px 0;border-top:2px solid var(--line-soft)"><strong>Total par mois</strong><strong>${euro(totalCharges)}</strong></div>`:`<p class="isub" style="padding:8px 0">Aucun prélèvement noté. Regarde ton relevé CIC et ajoute chaque prélèvement fixe (loyer, assurance, téléphone, crédit…).</p>`}
      <div style="margin:10px 0 4px"><button class="btn-ghost" data-fin-add="charge">＋ Prélèvement fixe CIC</button></div></div>`;

  const titre = t => `<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--accent);margin:16px 2px 2px">${t}</div>`;
  box.innerHTML = `<div class="section-block" style="margin:14px 0">
    <h2 style="font-size:1.05rem;margin:4px 2px 0">💰 Mes finances <span class="isub" style="font-weight:400">· visible uniquement par toi</span></h2>
    ${tuiles}${virHtml}
    ${titre("📅 Mois par mois")}${tableau}
    ${titre("⏳ Rentrées prévues")}${blocPrevu}
    ${titre("🛍 Autres revenus (Vinted, LinkedIn…)")}${blocAutres}
    ${titre("🏦 Prélèvements fixes CIC")}${blocCharges}
  </div>`;

  // ---- Actions -------------------------------------------------------------
  const byId = id => F.find(f => String(f.id) === String(id));
  const refresh = () => renderFinances();
  const err = e => UI.toast("Oups : " + (UI.errText ? UI.errText(e) : String(e)), "error");
  const clientesOpts = [{value:"",label:"— Aucune —"}].concat(
    (STATE.clientes||[]).filter(c => c.cliente.statut !== "termine")
      .map(c => ({ value:String(c.cliente.id), label:`${c.cliente.prenom} ${c.cliente.nom||""}`.trim() }))
      .sort((a,b)=>a.label.localeCompare(b.label)));
  const moisVal = d => ym(d || Calc.today());

  async function formulaire(kind, f){
    const champs = [];
    if (kind === "prevu"){
      champs.push({ name:"cliente_id", label:"Cliente", type:"select", options:clientesOpts, value:f?String(f.cliente_id||""):"" });
      champs.push({ name:"libelle", label:"Libellé", required:true, value:f?f.libelle:"", placeholder:"Ex. Linda — nouveau pack" });
      champs.push({ name:"montant", label:"Montant (€)", type:"text", required:true, half:true, value:f?f.montant:"", placeholder:"ex. 99,50" });
      champs.push({ name:"mois", label:"Mois", type:"month", required:true, half:true, value:moisVal(f&&f.mois) });
      if (!f) champs.push({ name:"repeter", label:"Répéter sur combien de mois ?", type:"number", value:1, hint:"Ex. 3 pour un parcours de 3 mois payé chaque mois" });
    } else if (kind === "revenu"){
      champs.push({ name:"libelle", label:"Source", type:"select", value:f?f.libelle:"Vinted", options:["Vinted","LinkedIn","Vente programme en ligne (Stripe)","Autre"].map(x=>({value:x,label:x})).concat(f&&!["Vinted","LinkedIn","Vente programme en ligne (Stripe)","Autre"].includes(f.libelle)?[{value:f.libelle,label:f.libelle}]:[]) });
      champs.push({ name:"montant", label:"Montant (€)", type:"text", required:true, half:true, value:f?f.montant:"", placeholder:"ex. 99,50" });
      champs.push({ name:"mois", label:"Mois", type:"month", required:true, half:true, value:moisVal(f&&f.mois) });
      champs.push({ name:"note", label:"Note", value:f?f.note||"":"" });
      champs.push({ name:"pro", label:"Revenu de mon activité de coach (compte pour l'URSSAF)", type:"checkbox", value:f?f.pro:false });
    } else {
      champs.push({ name:"libelle", label:"Prélèvement", required:true, value:f?f.libelle:"", placeholder:"Ex. Loyer, assurance, téléphone…" });
      champs.push({ name:"montant", label:"Montant par mois (€)", type:"text", required:true, value:f?f.montant:"" });
    }
    const titres = { prevu:"Rentrée prévue", revenu:"Autre revenu", charge:"Prélèvement fixe CIC" };
    const v = await UI.form({ title:(f?"Modifier — ":"")+titres[kind], submit:"Enregistrer", fields:champs });
    if (!v) return;
    const montant = Number(String(v.montant).replace(",", "."));
    if (!(montant > 0)) { UI.toast("Montant invalide", "error"); return; }
    const row = { kind, libelle:String(v.libelle||"").trim() || titres[kind], montant: r2(montant) };
    if (kind !== "charge"){ if (!/^\d{4}-\d{2}$/.test(v.mois||"")) { UI.toast("Mois invalide", "error"); return; } row.mois = v.mois + "-01"; }
    else row.mensuel = true;
    if (kind === "prevu") row.cliente_id = v.cliente_id || null;
    if (kind === "revenu"){ row.note = v.note || null; row.pro = !!v.pro; }
    try {
      if (f){ const { error } = await sb.from("finances").update(row).eq("id", f.id); if (error) throw error; }
      else {
        const n = kind === "prevu" ? Math.min(24, Math.max(1, parseInt(v.repeter,10) || 1)) : 1;
        const rows = Array.from({length:n}, (_,i) => ({ ...row, mois: row.mois ? addM(v.mois, i) + "-01" : undefined }));
        const { error } = await sb.from("finances").insert(rows); if (error) throw error;
      }
      UI.toast("Enregistré ✅"); refresh();
    } catch(e){ err(e); }
  }

  box.onclick = async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    try {
      if (d.finAdd) return formulaire(d.finAdd);
      if (d.finEdit){ const f = byId(d.finEdit); if (f) return formulaire(f.kind, f); return; }
      if (d.finDel){
        const f = byId(d.finDel); if (!f) return;
        if (!(await UI.confirm(`Supprimer « ${f.libelle} » (${euro(f.montant)}) ?`))) return;
        const { error } = await sb.from("finances").delete().eq("id", f.id); if (error) throw error;
        UI.toast("Supprimé"); return refresh();
      }
      if (d.finRecu){
        const f = byId(d.finRecu); if (!f) return;
        if (!f.cliente_id){
          const { error } = await sb.from("finances").update({ fait:true }).eq("id", f.id); if (error) throw error;
          UI.toast("Noté comme reçu ✅"); return refresh();
        }
        const v = await UI.form({ title:`Paiement reçu de ${nom(f.cliente_id)}`, submit:"C'est reçu ✅", fields:[
          { name:"montant", label:"Montant reçu (€)", type:"text", required:true, half:true, value:f.montant },
          { name:"date", label:"Date", type:"date", required:true, half:true, value:Calc.today() },
          { name:"mode", label:"Moyen de paiement", type:"select", value:"Virement", options:["Virement","Espèces","GoCardless","Stripe","Chèque"].map(x=>({value:x,label:x})) },
        ]});
        if (!v) return;
        const montant = r2(Number(String(v.montant).replace(",", ".")));
        if (!(montant > 0)) { UI.toast("Montant invalide", "error"); return; }
        // Le paiement va dans la fiche de la cliente (comme une saisie manuelle) → tout reste cohérent.
        const { error } = await sb.from("paiements").insert({ cliente_id:f.cliente_id, date:v.date || Calc.today(), montant, mode:v.mode, note:f.libelle });
        if (error) throw error;
        // Si la date saisie n'est pas dans le mois prévu, on aligne le prévu sur ce mois.
        if (ym(v.date) !== ym(f.mois)) await sb.from("finances").update({ mois: ym(v.date)+"-01" }).eq("id", f.id);
        UI.toast("Paiement enregistré dans la fiche ✅"); return refresh();
      }
      if (d.finUnfait){ const { error } = await sb.from("finances").update({ fait:false }).eq("id", d.finUnfait); if (error) throw error; return refresh(); }
      if (d.finVirok){
        const row = { kind:"virement", libelle:"Virement Revolut → CIC", montant: totalCharges, mois: now+"-01", fait:true };
        const { error } = vir ? await sb.from("finances").update({ fait:true, montant: totalCharges }).eq("id", vir.id) : await sb.from("finances").insert(row);
        if (error) throw error; UI.toast("Virement noté ✅"); return refresh();
      }
      if (d.finVirundo){ const { error } = await sb.from("finances").update({ fait:false }).eq("id", d.finVirundo); if (error) throw error; return refresh(); }
    } catch(e){ err(e); }
  };
}
