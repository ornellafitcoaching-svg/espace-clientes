// ============================================================================
// 💰 Mes finances — réservé à la coach (table « finances » protégée : RLS is_coach,
// aucun accès anonyme). Tout est recalculé à chaque ouverture depuis la base.
//
// Présentation en 2 comptes, comme dans la vraie vie :
//   💼 PRO (Revolut)  : ce que les clientes paient (reçu + à recevoir, avec la date),
//                       l'URSSAF à mettre de côté, les abonnements pro.
//   🏠 PERSO (CIC)    : le virement Revolut → CIC qui paie les prélèvements perso,
//                       les dépenses du mois (essence, courses, Luciana…), l'épargne.
// URSSAF : case à cocher sur CHAQUE paiement (cochée = déclaré = 26 % mis de côté).
// En haut : l'essentiel du mois = combien virer sur CIC, combien encaisser pour s'en sortir, quoi vendre.
//
// Données (table finances) :
//   prevu    = paiement attendu d'une cliente, à une DATE précise (colonne mois = la date)
//   revenu   = autre rentrée (Vinted, Leboncoin, LinkedIn, vente en ligne…) ; pro = compte pour l'URSSAF
//   charge   = charge mensuelle ; pro=true → prélevée sur CIC ; pro=false → abonnement pro (Revolut) ; « Épargne… » = épargne
//   depense  = dépense variable notée au fil de l'eau (date dans mois)
//   virement = virement Revolut → CIC du mois (fait = oui/non)
// Paiements reçus = table paiements (GoCardless et Stripe arrivent tout seuls), hors lignes ⚠️.
// ============================================================================
const FIN = { TAUX_URSSAF: 0.26 };   // à mettre de côté (taux exact connu à la recréation de la micro-entreprise)

async function renderFinances(cache){
  const box = document.getElementById("finances");
  if (!box) return;
  const euro = Calc.euro;
  const r2 = n => Math.round(n*100)/100;
  let F = [], P = [];
  if (cache){ F = cache.F; P = cache.P; } else try {
    const [a, b] = await Promise.all([
      sb.from("finances").select("*").order("mois",{ascending:true}).order("created_at",{ascending:true}),
      sb.from("paiements").select("id,cliente_id,montant,date,mode,note,urssaf"),
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    F = (a.data || []).filter(f => !f.masque); P = (b.data || []).filter(p => !String(p.note||"").startsWith("⚠️"));
  } catch(e){
    box.innerHTML = `<div class="card" style="margin-top:14px;color:var(--accent)">Finances indisponibles : ${esc(UI.errText ? UI.errText(e) : String(e))}</div>`;
    return;
  }

  const nom = id => { const c = (STATE.clientes||[]).find(x => String(x.cliente.id) === String(id)); return c ? String(c.cliente.prenom||"").trim() : ""; };
  const ym = d => String(d||"").slice(0,7);
  const today = Calc.today();
  const now = ym(today);
  const addM = (m, k) => { const [y,mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo-1+k, 1)); return d.toISOString().slice(0,7); };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const sansAccent = t => String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
  const libM = m => { const [y,mo] = m.split("-").map(Number); return new Date(y, mo-1, 1).toLocaleDateString("fr-FR",{month:"long", year:"numeric"}); };
  const moisSeul = m => cap(libM(m).replace(/\s\d{4}$/, ""));
  const jour = d => new Date(String(d).slice(0,10)+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
  const sum = arr => r2(arr.reduce((s,x)=>s+Number(x.montant||0),0));

  // ---- Paiements attendus ↔ paiements reçus (même cliente, même mois) ----------
  const payPool = {};
  P.forEach(p => { const k = p.cliente_id+"|"+ym(p.date); payPool[k] = (payPool[k]||0) + Number(p.montant||0); });
  const prevus = F.filter(f => f.kind === "prevu").sort((a,b)=>a.mois<b.mois?-1:1);
  prevus.forEach(f => {
    if (f.fait) { f._recu = true; return; }
    const k = f.cliente_id+"|"+ym(f.mois);
    if (f.cliente_id && (payPool[k]||0) >= Number(f.montant) - 0.01){ payPool[k] -= Number(f.montant); f._recu = true; return; }
    f._recu = false;
  });

  // ---- Charges : perso (CIC), pro (Revolut), épargne ---------------------------
  const charges = F.filter(f => f.kind === "charge");
  const estEpargne = f => /^[ée]pargne/i.test(f.libelle);
  const chCIC = charges.filter(f => f.pro && !estEpargne(f));
  const chPro = charges.filter(f => !f.pro && !estEpargne(f));
  const chEpargne = charges.filter(estEpargne);
  const totCIC = sum(chCIC), totPro = sum(chPro), totEpargne = sum(chEpargne);

  // ---- Dépenses variables -------------------------------------------------
  const deps = F.filter(f => f.kind === "depense");
  const depMois = m => sum(deps.filter(f => ym(f.mois) === m));
  const moisAvecDep = [...new Set(deps.map(f => ym(f.mois)))].filter(m => m < now).sort().slice(-3);
  const depEstimee = moisAvecDep.length ? r2(moisAvecDep.reduce((s,m)=>s+depMois(m),0) / moisAvecDep.length) : 0;

  // ---- Calcul d'un mois ------------------------------------------------------
  // URSSAF : calculée paiement par paiement (case « URSSAF » cochée = déclaré = 26 % mis de côté).
  const declare = x => x.urssaf !== false;
  const OFFRES = [ { n:"forfait 1 séance/semaine", prix:300 }, { n:"séance à l'unité", prix:65 }, { n:"programme à distance", prix:79 } ];
  const calc = m => {
    const recus = P.filter(p => ym(p.date) === m).sort((a,b)=>a.date<b.date?-1:1);
    const recusSansCliente = prevus.filter(f => ym(f.mois) === m && f.fait && !f.cliente_id);
    const aRecevoir = m >= now ? prevus.filter(f => ym(f.mois) === m && !f._recu) : [];
    const revPro = F.filter(f => f.kind==="revenu" && f.pro && ym(f.mois)===m);
    const revPerso = F.filter(f => f.kind==="revenu" && !f.pro && ym(f.mois)===m);
    const recu = r2(sum(recus) + sum(recusSansCliente) + sum(revPro));
    const attendu = sum(aRecevoir);
    const totalPro = r2(recu + attendu);
    const baseUrssaf = r2(sum(recus.filter(declare)) + sum(recusSansCliente.filter(declare)) + sum(revPro.filter(declare)) + sum(aRecevoir.filter(declare)));
    const urssaf = r2(baseUrssaf * FIN.TAUX_URSSAF);
    const dispoPro = r2(totalPro - urssaf - totPro);
    const autres = sum(revPerso);
    const depenses = m > now ? depEstimee : (m === now ? Math.max(depMois(m), depEstimee) : depMois(m));
    const reste = r2(dispoPro - totCIC + autres - depenses);
    // Pour t'en sortir : ce qu'il faut encaisser (déclaré) pour que « il te reste » = 0.
    const besoin = Math.max(0, r2((totPro + totCIC + depenses - autres) / (1 - FIN.TAUX_URSSAF)));
    const manque = reste < 0 ? r2(-reste / (1 - FIN.TAUX_URSSAF)) : 0;
    const aVendre = manque ? OFFRES.map(o => `${Math.ceil(manque / o.prix)} ${o.n}${Math.ceil(manque / o.prix) > 1 ? "s" : ""} à ${o.prix} €`.replace("séance à l'unités","séances à l'unité").replace("forfait 1 séance/semaines","forfaits 1 séance/semaine").replace("programme à distances","programmes à distance")) : [];
    return { m, recus, recusSansCliente, revPro, aRecevoir, recu, attendu, totalPro, baseUrssaf, urssaf, dispoPro, autres, depenses, reste, besoin, manque, aVendre };
  };

  // ---- Styles communs -------------------------------------------------------
  const L = (label, val, opt={}) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;${opt.top?"border-top:1px solid var(--line-soft);margin-top:4px;padding-top:8px;":""}${opt.small?"font-size:.82rem;color:var(--text-light);":""}">
      <span>${label}</span><strong style="white-space:nowrap;${opt.color?`color:${opt.color};`:""}${opt.big?"font-size:1.08rem;":""}">${val}</strong></div>`;
  const vert = "#2f7a46", rouge = "var(--accent)";
  const signe = n => n < 0 ? rouge : vert;
  const titre = t => `<div style="font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--accent);margin:20px 2px 4px">${t}</div>`;
  const carte = (inner, couleur) => `<div class="card" style="margin-top:6px;padding:10px 14px;${couleur?`border-left:4px solid ${couleur};`:""}">${inner}</div>`;
  const caseUrssaf = (attr, id, on) => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;color:var(--text-light);cursor:pointer;white-space:nowrap"><input type="checkbox" ${attr}="${id}" ${on?"checked":""} style="width:15px;height:15px;margin:0">URSSAF</label>`;

  const nomPrevu = f => {
    const n = f.cliente_id ? nom(f.cliente_id) : "";
    return n && !sansAccent(f.libelle).startsWith(sansAccent(n)) ? `${esc(n)} — ${esc(f.libelle)}` : esc(f.libelle);
  };
  // Tableau des paiements d'un mois : reçus + à venir, case URSSAF et montant URSSAF par ligne.
  const td = (x, st="") => `<td style="padding:7px 4px;vertical-align:top;${st}">${x}</td>`;
  const caseU = (attr, id, on, montant) => `<label style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer"><input type="checkbox" ${attr}="${id}" ${on?"checked":""} style="width:18px;height:18px;margin:0"><span style="font-size:.72rem;color:${on?"var(--text-mid)":"var(--text-light)"}">${on?euro(r2(montant*FIN.TAUX_URSSAF)):"—"}</span></label>`;
  const tablePaiements = x => {
    const lignes = [
      ...x.recus.map(p => ({ date:p.date, qui:esc(nom(p.cliente_id)||"—"), info:p.mode||"", montant:Number(p.montant), u:declare(p), attr:"data-fin-urs-pay", id:p.id, recu:true })),
      ...x.revPro.map(f => ({ date:f.mois, qui:esc(f.libelle), info:f.note||"", montant:Number(f.montant), u:declare(f), attr:"data-fin-urs-prevu", id:f.id, recu:true })),
      ...x.recusSansCliente.map(f => ({ date:f.mois, qui:esc(f.libelle), info:"", montant:Number(f.montant), u:declare(f), attr:"data-fin-urs-prevu", id:f.id, recu:true })),
      ...x.aRecevoir.map(f => ({ date:f.mois, qui:nomPrevu(f), info:f.note||"", montant:Number(f.montant), u:declare(f), attr:"data-fin-urs-prevu", id:f.id, recu:false, prevu:f })),
    ].sort((a,b)=>String(a.date)<String(b.date)?-1:1);
    if (!lignes.length) return `<p class="isub">Aucun paiement ce mois-ci.</p>`;
    const th = t => `<th style="text-align:left;padding:6px 4px;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-light)">${t}</th>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:.86rem">
      <thead><tr>${th("Paiement")}${th("Montant")}${th("URSSAF")}</tr></thead>
      <tbody>${lignes.map(l => `<tr style="border-top:1px solid var(--line-soft);${l.recu?"":"background:rgba(201,99,88,.05)"}">
        ${td(`<div>${l.recu?"✅":"⏳"} <strong style="font-weight:600">${l.qui}</strong></div><div class="isub" style="font-size:.76rem">${jour(l.date)}${l.info?" · "+esc(l.info):""}${l.recu?"":" · à recevoir"}</div>
             ${l.prevu?`<div style="display:flex;gap:4px;margin-top:4px"><button class="btn-accent" data-fin-recu="${l.id}" style="padding:2px 8px;font-size:.72rem">Reçu</button><button class="btn-ghost" data-fin-edit="${l.id}" style="padding:1px 5px;font-size:.72rem">✏️</button><button class="btn-ghost" data-fin-del="${l.id}" style="padding:1px 5px;font-size:.72rem">🗑</button></div>`:""}`)}
        ${td(`<strong>${euro(l.montant)}</strong>`, "white-space:nowrap")}
        ${td(caseU(l.attr, l.id, l.u, l.montant), "text-align:center;width:70px")}</tr>`).join("")}</tbody>
      <tfoot><tr style="border-top:2px solid var(--line-soft)">
        ${td("<strong>Total</strong>")}${td(`<strong>${euro(x.totalPro)}</strong>`, "white-space:nowrap")}${td(`<strong>${euro(x.urssaf)}</strong>`, "text-align:center;white-space:nowrap")}</tr></tfoot>
    </table>
    <p class="isub" style="margin-top:6px">Case cochée = paiement déclaré → 26 % mis de côté pour l'URSSAF. Décoche si tu ne le déclares pas : tout se recalcule tout de suite.</p>`;
  };

  // ---- 1. L'ESSENTIEL DU MOIS -------------------------------------------------
  const c = calc(now);
  const vir = F.find(f => f.kind === "virement" && ym(f.mois) === now);
  const okMois = c.reste >= 0;
  const blocEssentiel = carte(`
      <table style="width:100%;border-collapse:collapse;font-size:.92rem">
        <tr>${td("🏦 <strong>Virer de Revolut vers CIC</strong><div class='isub'>pour payer tes prélèvements perso</div>")}${td(`<strong style="font-size:1.15rem">${euro(totCIC)}</strong><div style="margin-top:4px">${vir && vir.fait ? `✅ fait <button class="btn-ghost" data-fin-virundo="${vir.id}" style="padding:1px 6px;font-size:.7rem">annuler</button>` : `<button class="btn-accent" data-fin-virok="1" style="padding:3px 9px;font-size:.76rem">C'est fait</button>`}</div>`, "text-align:right;white-space:nowrap")}</tr>
        <tr style="border-top:1px solid var(--line-soft)">${td(`💶 <strong>Il te faut en coaching</strong><div class='isub'>pour tout payer ce mois-ci${c.autres?` (France Travail et autres rentrées déjà comptés : ${euro(c.autres)})`:""}</div>`)}${td(`<strong style="font-size:1.15rem">${euro(c.besoin)}</strong>`, "text-align:right;white-space:nowrap")}</tr>
        <tr style="border-top:1px solid var(--line-soft)">${td("📥 <strong>Tes clientes te paient</strong><div class='isub'>reçu + à recevoir ce mois</div>")}${td(`<strong style="font-size:1.15rem;color:${okMois?vert:rouge}">${euro(c.totalPro)}</strong>`, "text-align:right;white-space:nowrap")}</tr>
        <tr style="border-top:2px solid var(--line-soft)">${td(okMois ? `<strong style="color:${vert}">✅ Ça passe ce mois-ci</strong>` : `<strong style="color:${rouge}">❌ Il manque</strong>`)}${td(`<strong style="font-size:1.15rem;color:${okMois?vert:rouge}">${okMois ? "+"+euro(c.reste) : euro(c.manque)}</strong>`, "text-align:right;white-space:nowrap")}</tr>
      </table>
      ${okMois ? "" : `<div style="margin-top:8px"><strong>🛒 À vendre (une de ces options) :</strong><ul style="margin:4px 0 0 18px;padding:0">${c.aVendre.map(t => `<li>${t}</li>`).join("")}</ul></div>`}
    `, okMois ? vert : rouge);

  // Le mois en un tableau : d'où vient l'argent, où il va.
  const ligneT = (label, val, opt={}) => `<tr style="border-top:${opt.fort?"2px":"1px"} solid var(--line-soft)">${td(opt.fort?`<strong>${label}</strong>`:label)}${td(`<strong style="${opt.color?`color:${opt.color};`:""}${opt.fort?"font-size:1.05rem;":"font-weight:500;"}">${val}</strong>`, "text-align:right;white-space:nowrap")}</tr>`;
  const blocMois = carte(`
      <table style="width:100%;border-collapse:collapse;font-size:.9rem">
        <tr><td colspan="2" style="padding:4px 4px 2px;font-weight:700">💼 Compte pro (Revolut)</td></tr>
        ${ligneT("Payé par tes clientes (reçu + à venir)", "+"+euro(c.totalPro))}
        ${ligneT("URSSAF à mettre de côté (26 % des paiements cochés)", "−"+euro(c.urssaf))}
        ${ligneT(`Abonnements pro (${chPro.map(f=>esc(f.libelle.replace(/\s*\(.*\)/,""))).join(", ")||"aucun"})`, "−"+euro(totPro))}
        ${ligneT("Reste sur le compte pro", euro(c.dispoPro), { fort:true, color: signe(c.dispoPro) })}
        <tr><td colspan="2" style="padding:14px 4px 2px;font-weight:700">🏠 Compte perso (CIC)</td></tr>
        ${c.autres ? ligneT("France Travail, Vinted… (autres rentrées)", "+"+euro(c.autres)) : ""}
        ${ligneT("Virement vers CIC (loyer, crédits, assurances…)", "−"+euro(totCIC))}
        ${ligneT(`Dépenses (essence, courses, Luciana)${c.depenses > depMois(now) ? " — moyenne" : ""}`, "−"+euro(c.depenses))}
        ${ligneT("Il te reste pour vivre", euro(c.reste), { fort:true, color: signe(c.reste) })}
        ${totEpargne ? ligneT(`Si tu mets ${euro(totEpargne)} en épargne`, euro(r2(c.reste - totEpargne)), { color: signe(c.reste - totEpargne) }) : ""}
      </table>
    `);
  const blocPaiementsMois = carte(tablePaiements(c));

  // ---- 2. LES PROCHAINS MOIS (tableau simple) -------------------------------
  const prochains = [1,2,3].map(k => calc(addM(now,k)));
  const th = `style="text-align:left;padding:6px 4px;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-light)"`;
  const blocProchains = carte(`
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.86rem">
        <thead><tr><th ${th}>Mois</th><th ${th}>Déjà prévu</th><th ${th}>Il faut</th><th ${th}>Il manque</th></tr></thead>
        <tbody>${prochains.map(x => `<tr style="border-top:1px solid var(--line-soft)">
          <td style="padding:7px 4px"><strong>${moisSeul(x.m)}</strong></td>
          <td style="padding:7px 4px">${euro(x.totalPro)}</td>
          <td style="padding:7px 4px">${euro(x.besoin)}</td>
          <td style="padding:7px 4px;font-weight:700;color:${x.manque?rouge:vert}">${x.manque?euro(x.manque):"✅ 0 €"}</td></tr>`).join("")}</tbody>
      </table></div>
      ${prochains.filter(x => x.manque).map(x => `<div style="margin-top:8px;font-size:.86rem"><strong>${moisSeul(x.m)} :</strong> vendre ${x.aVendre.join(" <em>ou</em> ")}</div>`).join("")}
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Voir les paiements prévus mois par mois</summary>
        ${prochains.map(x => `<div style="margin-top:12px;font-weight:700">${moisSeul(x.m)}</div>${tablePaiements(x)}`).join("")}
      </details>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"><button class="btn-accent" data-fin-pack="1">🧮 Étaler un pack sur plusieurs mois</button><button class="btn-ghost" data-fin-add="prevu">＋ Ajouter un paiement attendu</button></div>
    `);

  // ---- HISTORIQUE (encaissé coaching, sans déduction) -------------------------
  const hist = [];
  for (let m = "2026-01"; m < now; m = addM(m,1)){ const x = calc(m); if (x.recu) hist.push(x); }
  const blocHist = carte(hist.reverse().map(x => `<details style="padding:4px 0;border-top:1px solid var(--line-soft)">
      <summary style="display:flex;justify-content:space-between;cursor:pointer;list-style:none"><span>${cap(libM(x.m))}</span><strong>${euro(x.recu)}</strong></summary>
      ${tablePaiements(x)}
    </details>`).join("") + `<p class="isub" style="margin-top:6px">Tout ce que les clientes t'ont payé. Touche un mois pour voir qui, quand, et cocher/décocher « URSSAF ».</p>`);

  // ---- GESTION : dépenses, autres rentrées, charges ---------------------------
  const catsDep = ["Essence","Courses","Luciana","Achat revente","Autre"];
  const depCur = deps.filter(f => ym(f.mois) === now).sort((a,b)=>a.mois<b.mois?1:-1);
  const ligneEdit = (f, extra) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line-soft)">
      <span style="flex:1;min-width:0"><strong>${esc(f.libelle)}</strong>${extra?`<span class="isub"> · ${extra}</span>`:""}</span>
      <strong style="white-space:nowrap">${euro(f.montant)}</strong>
      <button class="btn-ghost" data-fin-edit="${f.id}" title="Modifier" style="padding:2px 6px;font-size:.74rem">✏️</button>
      <button class="btn-ghost" data-fin-del="${f.id}" title="Supprimer" style="padding:2px 6px;font-size:.74rem">🗑</button></div>`;
  const blocDep = carte(`
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px">${["⛽ Essence","🛒 Courses","👧 Luciana","🛍 Achat revente","➕ Autre"].map((t,i)=>`<button class="btn-accent" data-fin-dep="${catsDep[i]}" style="padding:6px 11px;font-size:.82rem">${t}</button>`).join("")}</div>
      ${depCur.length ? depCur.map(f => ligneEdit(f, jour(f.mois) + (f.note?" · "+esc(f.note):""))).join("") + L("Total " + moisSeul(now).toLowerCase(), euro(depMois(now)), { top:true })
                      : `<p class="isub">Note chaque plein, chaque course, chaque dépense pour Luciana : un clic, le montant, c'est tout.</p>`}
    `);
  const autresRev = F.filter(f => f.kind === "revenu" && ym(f.mois) >= addM(now,-1)).sort((a,b)=>a.mois<b.mois?1:-1);
  const venteMois = m => sum(F.filter(f => f.kind==="revenu" && /vinted|leboncoin|revente/i.test(f.libelle) && ym(f.mois)===m));
  const achatMois = m => sum(deps.filter(f => f.libelle==="Achat revente" && ym(f.mois)===m));
  const blocAutres = carte(`
      ${(venteMois(now)||achatMois(now)) ? L(`Revente ${moisSeul(now).toLowerCase()} : ventes ${euro(venteMois(now))} − achats ${euro(achatMois(now))}`, euro(r2(venteMois(now)-achatMois(now))), { color: signe(venteMois(now)-achatMois(now)) }) : ""}
      ${autresRev.map(f => ligneEdit(f, moisSeul(ym(f.mois)) + (f.pro?" · coaching (URSSAF)":"") + (f.note?" · "+esc(f.note):""))).join("") || `<p class="isub">Vinted, Leboncoin, LinkedIn… note ici ce qui rentre à côté.</p>`}
      <div style="margin-top:8px"><button class="btn-ghost" data-fin-add="revenu">＋ Autre rentrée</button></div>
    `);
  const blocCharges = carte(`
      <div style="font-weight:700;margin:2px 0">🏠 Prélevé sur CIC (perso)</div>
      ${chCIC.map(f => ligneEdit(f, f.note?esc(f.note):"")).join("")}
      ${L("Total CIC = virement à faire", euro(totCIC), { top:true })}
      <div style="font-weight:700;margin:14px 0 2px">💼 Abonnements pro (Revolut)</div>
      ${chPro.map(f => ligneEdit(f, f.note?esc(f.note):"")).join("") || `<p class="isub">Aucun.</p>`}
      ${L("Total pro", euro(totPro), { top:true })}
      ${chEpargne.length ? `<div style="font-weight:700;margin:14px 0 2px">💰 Épargne</div>${chEpargne.map(f => ligneEdit(f, "")).join("")}` : ""}
      <div style="margin-top:10px"><button class="btn-ghost" data-fin-add="charge">＋ Charge mensuelle</button></div>
    `);

  box.innerHTML = `<div class="section-block" style="margin:14px 0">
    <h2 style="font-size:1.1rem;margin:4px 2px 0">💰 Mes finances <span class="isub" style="font-weight:400">· visible uniquement par toi</span></h2>
    ${titre(`🎯 ${moisSeul(now)} — l'essentiel`)}${blocEssentiel}
    ${titre(`📋 ${moisSeul(now)} — ton mois en un tableau`)}${blocMois}
    ${titre(`💶 ${moisSeul(now)} — les paiements de tes clientes`)}${blocPaiementsMois}
    ${titre("🔮 Les 3 prochains mois")}${blocProchains}
    ${titre("⛽ Mes dépenses du mois")}${blocDep}
    ${titre("🛍 Autres rentrées (France Travail, Vinted, Leboncoin…)")}${blocAutres}
    ${titre("🧾 Mes charges fixes")}${blocCharges}
    ${titre("📊 Ce que j'ai encaissé (coaching)")}${blocHist}
  </div>`;

  // ---- Actions -------------------------------------------------------------
  const byId = id => F.find(f => String(f.id) === String(id));
  const refresh = () => renderFinances();
  const err = e => UI.toast("Oups : " + (UI.errText ? UI.errText(e) : String(e)), "error");
  const clientesOpts = [{value:"",label:"— Aucune —"}].concat(
    (STATE.clientes||[]).filter(x => x.cliente.statut !== "termine")
      .map(x => ({ value:String(x.cliente.id), label:`${x.cliente.prenom} ${x.cliente.nom||""}`.trim() }))
      .sort((a,b)=>a.label.localeCompare(b.label)));
  const moisVal = d => ym(d || today);
  const addMDate = (d, k) => { const [y,mo,da] = d.split("-").map(Number); const x = new Date(Date.UTC(y, mo-1+k, 1)); const fin = new Date(Date.UTC(y, mo+k, 0)).getUTCDate(); x.setUTCDate(Math.min(da, fin)); return x.toISOString().slice(0,10); };

  async function formulaire(kind, f, cat){
    const champs = [];
    if (kind === "depense"){
      champs.push({ name:"libelle", label:"Pour quoi ?", type:"select", value:f?f.libelle:(cat||"Essence"), options:catsDep.map(x=>({value:x,label:x})) });
      champs.push({ name:"montant", label:"Montant (€)", type:"text", required:true, half:true, value:f?f.montant:"", placeholder:"ex. 45,30" });
      champs.push({ name:"date", label:"Date", type:"date", required:true, half:true, value:f?String(f.mois).slice(0,10):today });
      champs.push({ name:"note", label:"Note (facultatif)", value:f?f.note||"":"" });
    } else if (kind === "prevu"){
      champs.push({ name:"cliente_id", label:"Cliente", type:"select", options:clientesOpts, value:f?String(f.cliente_id||""):"" });
      champs.push({ name:"libelle", label:"Pour quoi ?", required:true, value:f?f.libelle:"", placeholder:"Ex. Linda — nouveau pack" });
      champs.push({ name:"montant", label:"Montant (€)", type:"text", required:true, half:true, value:f?f.montant:"", placeholder:"ex. 99,50" });
      champs.push({ name:"date", label:"Date prévue", type:"date", required:true, half:true, value:f?String(f.mois).slice(0,10):today });
      champs.push({ name:"note", label:"Note (facultatif)", value:f?f.note||"":"", placeholder:"Ex. à sa séance, par virement" });
      if (!f) champs.push({ name:"repeter", label:"Tous les mois pendant combien de mois ?", type:"number", value:1, hint:"Ex. 3 pour un parcours de 3 mois payé chaque mois" });
    } else if (kind === "revenu"){
      const src = ["France Travail","Vinted","Leboncoin","LinkedIn","Vente programme en ligne (Stripe)","Autre"];
      champs.push({ name:"libelle", label:"Source", type:"select", value:f?f.libelle:"Vinted", options:src.map(x=>({value:x,label:x})).concat(f&&!src.includes(f.libelle)?[{value:f.libelle,label:f.libelle}]:[]) });
      champs.push({ name:"montant", label:"Montant (€)", type:"text", required:true, half:true, value:f?f.montant:"", placeholder:"ex. 99,50" });
      champs.push({ name:"mois", label:"Mois", type:"month", required:true, half:true, value:moisVal(f&&f.mois) });
      champs.push({ name:"note", label:"Note", value:f?f.note||"":"" });
      champs.push({ name:"pro", label:"C'est du coaching (compte pour l'URSSAF)", type:"checkbox", value:f?f.pro:false });
    } else {
      champs.push({ name:"libelle", label:"Charge", required:true, value:f?f.libelle:"", placeholder:"Ex. Loyer, assurance, abonnement…" });
      champs.push({ name:"montant", label:"Montant par mois (€)", type:"text", required:true, value:f?f.montant:"" });
      champs.push({ name:"note", label:"Note", value:f?f.note||"":"", placeholder:"Ex. le 5 du mois" });
      champs.push({ name:"pro", label:"Prélevée sur mon compte perso CIC (sinon : compte pro Revolut)", type:"checkbox", value:f?f.pro:true });
    }
    const titres = { prevu:"Paiement attendu", revenu:"Autre rentrée", charge:"Charge mensuelle", depense:"Dépense" };
    const v = await UI.form({ title:(f?"Modifier — ":"")+titres[kind], submit:"Enregistrer", fields:champs });
    if (!v) return;
    const montant = Number(String(v.montant).replace(",", "."));
    if (!(montant > 0)) { UI.toast("Montant invalide", "error"); return; }
    const row = { kind, libelle:String(v.libelle||"").trim() || titres[kind], montant: r2(montant), note: v.note || null };
    if (kind === "depense" || kind === "prevu"){ if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date||"")) { UI.toast("Date invalide", "error"); return; } row.mois = v.date; }
    else if (kind === "revenu"){ if (!/^\d{4}-\d{2}$/.test(v.mois||"")) { UI.toast("Mois invalide", "error"); return; } row.mois = v.mois + "-01"; row.pro = !!v.pro; }
    else { row.mensuel = true; row.pro = !!v.pro; }
    if (kind === "prevu") row.cliente_id = v.cliente_id || null;
    try {
      if (f){ const { error } = await sb.from("finances").update(row).eq("id", f.id); if (error) throw error; }
      else {
        const n = kind === "prevu" ? Math.min(24, Math.max(1, parseInt(v.repeter,10) || 1)) : 1;
        const rows = Array.from({length:n}, (_,i) => ({ ...row, mois: kind === "prevu" ? addMDate(row.mois, i) : row.mois }));
        const { error } = await sb.from("finances").insert(rows); if (error) throw error;
      }
      UI.toast("Enregistré ✅"); refresh();
    } catch(e){ err(e); }
  }

  // 🧮 Étaler un pack : prix total − acompte, réparti en N paiements mensuels (le dernier absorbe les centimes).
  async function etalerPack(){
    const v = await UI.form({ title:"🧮 Étaler un pack sur plusieurs mois", submit:"Créer les paiements", fields:[
      { name:"cliente_id", label:"Cliente", type:"select", options:clientesOpts, value:"" },
      { name:"libelle", label:"Nom du pack", required:true, placeholder:"Ex. Pack 12 séances" },
      { name:"total", label:"Prix total du pack (€)", type:"text", required:true, half:true, placeholder:"ex. 650" },
      { name:"acompte", label:"Acompte déjà payé (€)", type:"text", half:true, value:"0" },
      { name:"mois", label:"Sur combien de mois ?", type:"number", required:true, half:true, value:3 },
      { name:"date", label:"Date du 1er paiement", type:"date", required:true, half:true, value:today },
      { name:"note", label:"Comment elle paie", value:"prélèvement GoCardless", placeholder:"Ex. prélèvement GoCardless, virement…" },
    ]});
    if (!v) return;
    const num = x => Number(String(x||"0").replace(",", "."));
    const total = num(v.total), acompte = num(v.acompte), n = Math.min(24, Math.max(1, parseInt(v.mois,10) || 1));
    const reste = r2(total - acompte);
    if (!(total > 0) || !(reste > 0)) { UI.toast("Vérifie le prix et l'acompte", "error"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date||"")) { UI.toast("Date invalide", "error"); return; }
    const base = Math.floor(reste / n * 100) / 100;
    const montants = Array.from({length:n}, (_,i) => i < n-1 ? base : r2(reste - base*(n-1)));
    const ok = await UI.confirm(`${esc(v.libelle)} : ${euro(total)}${acompte?` − acompte ${euro(acompte)}`:""} = ${euro(reste)} → ${n} paiement${n>1?"s":""} de ${euro(montants[0])}${montants[n-1]!==montants[0]?` (le dernier ${euro(montants[n-1])})`:""}, chaque mois à partir du ${jour(v.date)} — on crée ?`);
    if (!ok) return;
    const rows = montants.map((m, i) => ({ kind:"prevu", cliente_id: v.cliente_id || null, libelle: `${String(v.libelle).trim()} (${i+1}/${n})`, montant: m, mois: addMDate(v.date, i), note: v.note || null }));
    try { const { error } = await sb.from("finances").insert(rows); if (error) throw error; UI.toast(`${n} paiement${n>1?"s":""} créé${n>1?"s":""} ✅`); refresh(); }
    catch(e){ err(e); }
  }

  box.onchange = async (e) => {
    const t = e.target; if (!t || t.type !== "checkbox") return;
    const on = t.checked;
    const ligne = t.dataset.finUrsPay ? P.find(p => String(p.id) === t.dataset.finUrsPay) : t.dataset.finUrsPrevu ? byId(t.dataset.finUrsPrevu) : null;
    if (!ligne) return;
    const avant = ligne.urssaf;
    ligne.urssaf = on;
    renderFinances({ F, P });          // recalcul immédiat à l'écran
    try {
      const { error } = t.dataset.finUrsPay
        ? await sb.from("paiements").update({ urssaf: on }).eq("id", ligne.id)
        : await sb.from("finances").update({ urssaf: on }).eq("id", ligne.id);
      if (error) throw error;
    } catch(err2){ ligne.urssaf = avant; renderFinances({ F, P }); err(err2); }
  };

  box.onclick = async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    try {
      if (d.finAdd) return formulaire(d.finAdd);
      if (d.finPack) return etalerPack();
      if (d.finDep) return formulaire("depense", null, d.finDep);
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
          { name:"date", label:"Date", type:"date", required:true, half:true, value:today },
          { name:"mode", label:"Moyen de paiement", type:"select", value:"Virement", options:["Virement","Espèces","GoCardless","Stripe","Chèque"].map(x=>({value:x,label:x})) },
        ]});
        if (!v) return;
        const montant = r2(Number(String(v.montant).replace(",", ".")));
        if (!(montant > 0)) { UI.toast("Montant invalide", "error"); return; }
        // Le paiement va dans la fiche de la cliente (comme une saisie manuelle) → tout reste cohérent.
        const { error } = await sb.from("paiements").insert({ cliente_id:f.cliente_id, date:v.date || today, montant, mode:v.mode, note:f.libelle });
        if (error) throw error;
        if (ym(v.date) !== ym(f.mois)) await sb.from("finances").update({ mois: v.date }).eq("id", f.id);
        UI.toast("Paiement enregistré dans la fiche ✅"); return refresh();
      }
      if (d.finVirok){
        const row = { kind:"virement", libelle:"Virement Revolut → CIC", montant: totCIC, mois: now+"-01", fait:true };
        const { error } = vir ? await sb.from("finances").update({ fait:true, montant: totCIC }).eq("id", vir.id) : await sb.from("finances").insert(row);
        if (error) throw error; UI.toast("Virement noté ✅"); return refresh();
      }
      if (d.finVirundo){ const { error } = await sb.from("finances").update({ fait:false }).eq("id", d.finVirundo); if (error) throw error; return refresh(); }
    } catch(e){ err(e); }
  };
}
