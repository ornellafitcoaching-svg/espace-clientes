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
  // ---- Packs payés d'avance : l'argent reçu d'un coup est « lissé » sur les mois des séances ----
  // Exemple : pack 1 300 € pour 24 séances à 2/semaine → 12 semaines → environ 3 mois.
  // Le mois du paiement, l'argent (après URSSAF) est mis de côté ; chaque mois tu reprends la part des séances faites.
  const packs = F.filter(f => f.kind === "pack" && f.seances > 0 && f.par_semaine > 0);
  const addJours = (d, n) => { const x = new Date(String(d).slice(0,10)+"T12:00:00Z"); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); };
  const repartition = pk => {            // { "AAAA-MM": nb de séances }
    const out = {}; let reste = Number(pk.seances), w = 0;
    while (reste > 0 && w < 260){ const n = Math.min(Number(pk.par_semaine), reste); const mo = ym(addJours(pk.debut || pk.mois, 7*w)); out[mo] = (out[mo]||0) + n; reste -= n; w++; }
    return out;
  };
  const packNet = pk => r2(Number(pk.montant) * (declare(pk) ? 1 - FIN.TAUX_URSSAF : 1));
  const packMois = pk => { const rep = repartition(pk), net = packNet(pk); const ms = Object.keys(rep).sort(); let deja = 0;
    return ms.map((mo, i) => { const v = i < ms.length-1 ? r2(net * rep[mo] / pk.seances) : r2(net - deja); deja = r2(deja + v); return { m: mo, seances: rep[mo], montant: v }; }); };
  const packAjust = m => {
    let misDeCote = 0, repris = 0;
    packs.forEach(pk => { if (ym(pk.mois) === m) misDeCote += packNet(pk); const x = packMois(pk).find(y => y.m === m); if (x) repris += x.montant; });
    return { misDeCote: r2(misDeCote), repris: r2(repris) };
  };
  const reserveAujourdhui = () => r2(packs.reduce((s, pk) => s + (ym(pk.mois) <= now ? packMois(pk).filter(x => x.m > now).reduce((t,x)=>t+x.montant,0) : 0), 0));

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
    const pa = packAjust(m);
    const reste = r2(dispoPro - totCIC + autres - depenses - pa.misDeCote + pa.repris);
    // Pour t'en sortir : ce qu'il faut encaisser (déclaré) pour que « il te reste » = 0.
    const besoin = Math.max(0, r2((totPro + totCIC + depenses - autres - pa.repris + pa.misDeCote) / (1 - FIN.TAUX_URSSAF)));
    const manque = reste < 0 ? r2(-reste / (1 - FIN.TAUX_URSSAF)) : 0;
    const aVendre = manque ? OFFRES.map(o => `${Math.ceil(manque / o.prix)} ${o.n}${Math.ceil(manque / o.prix) > 1 ? "s" : ""} à ${o.prix} €`.replace("séance à l'unités","séances à l'unité").replace("forfait 1 séance/semaines","forfaits 1 séance/semaine").replace("programme à distances","programmes à distance")) : [];
    return { m, recus, recusSansCliente, revPro, aRecevoir, recu, attendu, totalPro, baseUrssaf, urssaf, dispoPro, autres, depenses, pa, reste, besoin, manque, aVendre };
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
  // L'essentiel : ce qui rentre, ce qui sort, ce qui reste — chaque ligne dit ce qu'elle contient.
  const nomsClientes = [...new Set([...c.recus.map(p => nom(p.cliente_id)), ...c.aRecevoir.map(f => nom(f.cliente_id) || f.libelle)].filter(Boolean))].join(", ");
  const autresDetail = F.filter(f => f.kind==="revenu" && !f.pro && ym(f.mois)===now).map(f => f.libelle).join(", ");
  const entre = r2(c.totalPro + c.autres + c.pa.repris);
  const sort = r2(c.urssaf + totPro + totCIC + c.depenses + c.pa.misDeCote);
  const lg = (label, detail, val, opt={}) => `<tr style="border-top:${opt.fort?"2px":"1px"} solid var(--line-soft)">${td(`${opt.fort?`<strong>${label}</strong>`:label}${detail?`<div class="isub" style="font-size:.76rem">${detail}</div>`:""}`)}${td(`<strong style="white-space:nowrap;${opt.color?`color:${opt.color};`:""}${opt.fort?"font-size:1.1rem;":"font-weight:500;"}">${val}</strong>`, "text-align:right")}</tr>`;
  const blocEssentiel = carte(`
      <table style="width:100%;border-collapse:collapse;font-size:.92rem">
        <tr><td colspan="2" style="padding:2px 4px 4px;font-weight:700;color:${vert}">📥 Ce qui rentre en ${moisSeul(now).toLowerCase()}</td></tr>
        ${lg("Tes clientes", `${euro(c.recu)} déjà reçus + ${euro(c.attendu)} à recevoir${nomsClientes?" · "+esc(nomsClientes):""}`, "+"+euro(c.totalPro))}
        ${c.autres ? lg("Autres rentrées", esc(autresDetail), "+"+euro(c.autres)) : ""}
        ${c.pa.repris ? lg("Ta part des packs payés d'avance", "", "+"+euro(c.pa.repris)) : ""}
        ${lg("Total qui rentre", "", euro(entre), { fort:true })}
        <tr><td colspan="2" style="padding:14px 4px 4px;font-weight:700;color:${rouge}">📤 Ce qui sort</td></tr>
        ${lg("URSSAF à mettre de côté", "26 % des paiements de tes clientes", "−"+euro(c.urssaf))}
        ${lg("Abonnements pro", chPro.map(f=>esc(f.libelle.replace(/\s*\(.*\)/,""))).join(", "), "−"+euro(totPro))}
        ${lg("Tes prélèvements perso (CIC)", "loyer, crédits, assurances, voiture… = le virement à faire", "−"+euro(totCIC))}
        ${lg("Tes dépenses", c.depenses > depMois(now) ? "essence, courses, Luciana (moyenne de tes mois)" : "essence, courses, Luciana (ce que tu as noté)", "−"+euro(c.depenses))}
        ${c.pa.misDeCote ? lg("Pack reçu, mis de côté pour les mois suivants", "", "−"+euro(c.pa.misDeCote)) : ""}
        ${lg("Total qui sort", "", euro(sort), { fort:true })}
        ${lg(okMois ? "✅ Il te reste" : "❌ Il te manque", okMois ? "ce mois-ci, une fois tout payé" : "pour tout payer ce mois-ci", okMois ? euro(c.reste) : euro(-c.reste), { fort:true, color: okMois ? vert : rouge })}
      </table>
      ${okMois ? "" : `<div style="margin-top:8px"><strong>🛒 Pour combler, vends une de ces options :</strong><ul style="margin:4px 0 0 18px;padding:0">${c.aVendre.map(t => `<li>${t}</li>`).join("")}</ul></div>`}
      <div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(201,99,88,.07);display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div>🏦 <strong>Virement à faire : Revolut → CIC</strong><div class="isub">pour payer tes prélèvements perso</div></div>
        <div style="text-align:right"><strong style="font-size:1.1rem">${euro(totCIC)}</strong><div style="margin-top:4px">${vir && vir.fait ? `✅ fait <button class="btn-ghost" data-fin-virundo="${vir.id}" style="padding:1px 6px;font-size:.7rem">annuler</button>` : `<button class="btn-accent" data-fin-virok="1" style="padding:3px 9px;font-size:.76rem">C'est fait</button>`}</div></div>
      </div>
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
        ${c.pa.misDeCote ? ligneT("📦 Pack reçu ce mois : mis de côté pour les mois des séances", "−"+euro(c.pa.misDeCote)) : ""}
        ${c.pa.repris ? ligneT("📦 Ta part des packs pour ce mois (séances faites)", "+"+euro(c.pa.repris)) : ""}
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
        <thead><tr><th ${th}>Mois</th><th ${th}>Clientes (prévu)</th><th ${th}>Autres rentrées</th><th ${th}>Reste ou manque</th></tr></thead>
        <tbody>${prochains.map(x => `<tr style="border-top:1px solid var(--line-soft)">
          <td style="padding:7px 4px"><strong>${moisSeul(x.m)}</strong></td>
          <td style="padding:7px 4px">${euro(x.totalPro)}</td>
          <td style="padding:7px 4px">${x.autres?euro(x.autres):"—"}</td>
          <td style="padding:7px 4px;font-weight:700;color:${x.reste<0?rouge:vert}">${x.reste<0?"❌ manque "+euro(-x.reste):"✅ reste "+euro(x.reste)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${prochains.filter(x => x.manque).map(x => `<div style="margin-top:8px;font-size:.86rem"><strong>${moisSeul(x.m)} :</strong> vendre ${x.aVendre.join(" <em>ou</em> ")}</div>`).join("")}
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Voir les paiements prévus mois par mois</summary>
        ${prochains.map(x => `<div style="margin-top:12px;font-weight:700">${moisSeul(x.m)}</div>${tablePaiements(x)}`).join("")}
      </details>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"><button class="btn-ghost" data-fin-add="prevu">＋ Ajouter un paiement attendu</button></div>
    `);

  // ---- PACKS PAYÉS D'AVANCE --------------------------------------------------
  const blocPacks = carte(`
      <p style="margin:0 0 8px">Quand une cliente te paie un gros pack d'un coup, cet argent doit te faire vivre <strong>pendant tous les mois des séances</strong>, pas seulement le mois où il arrive. Ici, chaque pack est réparti mois par mois.</p>
      ${packs.length ? packs.map(pk => { const lm = packMois(pk); return `<div style="border-top:1px solid var(--line-soft);padding:8px 0">
          <div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(pk.cliente_id ? nom(pk.cliente_id)+" — " : "")}${esc(pk.libelle)}</strong><strong>${euro(pk.montant)}</strong></div>
          <div class="isub">Payé le ${jour(pk.mois)} · ${pk.seances} séances à ${pk.par_semaine}/semaine · ${euro(r2(pk.montant/pk.seances))} la séance${declare(pk)?" · URSSAF "+euro(r2(pk.montant*FIN.TAUX_URSSAF))+" gardée tout de suite":""}</div>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-top:4px">${lm.map(x => `<tr style="border-top:1px solid var(--line-soft);${x.m===now?"font-weight:700":""}"><td style="padding:4px">${moisSeul(x.m)} ${x.m.slice(0,4)}</td><td style="padding:4px">${x.seances} séance${x.seances>1?"s":""}</td><td style="padding:4px;text-align:right">${euro(x.montant)}</td></tr>`).join("")}</table>
          <div style="display:flex;gap:6px;margin-top:6px"><button class="btn-ghost" data-fin-pack-edit="${pk.id}" style="padding:2px 8px;font-size:.74rem">✏️ Modifier</button><button class="btn-ghost" data-fin-del="${pk.id}" style="padding:2px 8px;font-size:.74rem">🗑</button></div></div>`; }).join("")
        + L("Encore de côté aujourd'hui (pour les mois à venir)", euro(reserveAujourdhui()), { top:true })
        : `<p class="isub">Aucun pack enregistré.</p>`}
      <div style="margin-top:8px"><button class="btn-accent" data-fin-pack="1">🧮 Répartir un pack payé d'avance</button></div>
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
    ${titre(`💶 ${moisSeul(now)} — les paiements de tes clientes`)}${blocPaiementsMois}
    ${titre("🔮 Les 3 prochains mois")}${blocProchains}
    ${titre("📦 Packs payés d'avance")}${blocPacks}
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

  // 🧮 Répartir un pack payé d'avance (enregistre la répartition ; peut aussi noter le paiement dans la fiche).
  async function repartirPack(pk){
    const v = await UI.form({ title: pk ? "Modifier le pack" : "📦 Répartir un pack payé d'avance", submit: pk ? "Enregistrer" : "Voir la répartition", fields:[
      { name:"cliente_id", label:"Cliente", type:"select", options:clientesOpts, value: pk ? String(pk.cliente_id||"") : "" },
      { name:"libelle", label:"Nom du pack", required:true, value: pk ? pk.libelle : "", placeholder:"Ex. Pack 24 séances" },
      { name:"montant", label:"Prix payé (€)", type:"text", required:true, half:true, value: pk ? pk.montant : "", placeholder:"ex. 1300" },
      { name:"mois", label:"Payé le", type:"date", required:true, half:true, value: pk ? String(pk.mois).slice(0,10) : today },
      { name:"seances", label:"Nombre de séances", type:"number", required:true, half:true, value: pk ? pk.seances : 24 },
      { name:"par_semaine", label:"Séances par semaine", type:"number", required:true, half:true, value: pk ? pk.par_semaine : 2 },
      { name:"debut", label:"Date de la 1re séance", type:"date", required:true, value: pk ? String(pk.debut||pk.mois).slice(0,10) : today },
      { name:"urssaf", label:"Déclaré à l'URSSAF (26 % mis de côté)", type:"checkbox", value: pk ? declare(pk) : true },
      ...(pk ? [] : [{ name:"noter", label:"Noter aussi le paiement dans sa fiche (seulement s'il n'y est pas déjà : virement, espèces)", type:"checkbox", value:false }]),
    ]});
    if (!v) return;
    const row = { kind:"pack", cliente_id: v.cliente_id || null, libelle: String(v.libelle).trim(), montant: r2(Number(String(v.montant).replace(",", "."))),
      mois: v.mois, debut: v.debut || v.mois, seances: parseInt(v.seances,10), par_semaine: Number(String(v.par_semaine).replace(",", ".")), urssaf: !!v.urssaf };
    if (!(row.montant > 0) || !(row.seances > 0) || !(row.par_semaine > 0)) { UI.toast("Vérifie le prix, les séances et le rythme", "error"); return; }
    const lignes = packMois(row);
    const ok = await UI.confirm(`<div style="font-weight:400;font-size:.9rem;text-align:left">
      <strong>${esc(row.libelle)} — ${euro(row.montant)}</strong><br>${row.seances} séances à ${row.par_semaine}/semaine = ${euro(r2(row.montant/row.seances))} la séance, sur ${lignes.length} mois.<br>
      ${row.urssaf ? `URSSAF à garder tout de suite : ${euro(r2(row.montant*FIN.TAUX_URSSAF))}.<br>` : ""}
      <table style="width:100%;margin-top:8px;border-collapse:collapse">${lignes.map(x => `<tr style="border-top:1px solid #eee"><td style="padding:4px 0">${moisSeul(x.m)} ${x.m.slice(0,4)}</td><td>${x.seances} séance${x.seances>1?"s":""}</td><td style="text-align:right"><strong>${euro(x.montant)}</strong></td></tr>`).join("")}</table>
      <div style="margin-top:6px">= ce que tu peux te verser chaque mois. Le reste reste de côté.</div></div>`);
    if (!ok) return;
    try {
      if (pk){ const { error } = await sb.from("finances").update(row).eq("id", pk.id); if (error) throw error; }
      else {
        const { error } = await sb.from("finances").insert(row); if (error) throw error;
        if (v.noter && row.cliente_id){ const r = await sb.from("paiements").insert({ cliente_id: row.cliente_id, date: row.mois, montant: row.montant, mode: "Virement", note: row.libelle, urssaf: row.urssaf }); if (r.error) throw r.error; }
      }
      UI.toast("Pack enregistré ✅"); refresh();
    } catch(e){ err(e); }
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
      if (d.finPack) return repartirPack();
      if (d.finPackEdit){ const pk = byId(d.finPackEdit); if (pk) return repartirPack(pk); return; }
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
