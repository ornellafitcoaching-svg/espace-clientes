// ============================================================================
// mesures.js — SOURCE UNIQUE pour les mensurations (cliente + coach + questionnaire).
//
// Règle : on mesure TOUJOURS au même endroit que dans le QUESTIONNAIRE DE DÉPART,
// sinon les comparaisons départ → bilan n'ont aucun sens (cf. retour Ornella 10/10/2026 :
// le bilan disait « hanches = le plus large » alors que le départ disait « os du bassin »,
// et « tour de dos » = sous la poitrine au départ mais sous les aisselles au bilan).
//
// + Contrôle de vraisemblance : un écart improbable par rapport au relevé précédent
//   (ex. +10 cm en 4 semaines) est signalé EN ROUGE, à la saisie et dans les historiques.
// ============================================================================
window.Mesures = (function () {
  // Où placer le mètre — IDENTIQUE au questionnaire de départ (référence).
  const HINTS = {
    poids:         "Le matin, à jeun, après les toilettes, avant de manger. Toujours la même balance.",
    tour_cou:      "⭐ Juste sous la pomme d'Adam, mètre bien horizontal (sert à calculer ta masse grasse).",
    poitrine:      "Au plus fort de la poitrine (niveau des mamelons), le mètre passe bien à plat dans le dos.",
    tour_dos:      "Juste sous la poitrine, sur la ligne du soutien-gorge (tout autour, mètre horizontal dans le dos). PAS sous les aisselles.",
    sous_poitrine: "Juste sous la poitrine, sur la ligne du soutien-gorge.",
    tour_taille:   "Au plus fin du ventre (le creux de la taille). Ventre détendu, ne le rentre pas.",
    tour_hanches:  "Au niveau des os du bassin (là où tu poses les mains sur les hanches). PAS sur les fesses.",
    tour_fessiers: "Au point le plus bombé des fesses, pieds joints, mètre horizontal.",
    tour_cuisse:   "10 cm sous le pli de la fesse. Toujours la jambe DROITE.",
    tour_bras:     "Au milieu du bras (entre épaule et coude), biceps détendu. Toujours le bras DROIT.",
    tour_mollet:   "Sur la partie la plus large du mollet. Toujours le mollet DROIT.",
  };

  const NOMS = {
    poids:"Poids", masse_grasse:"Masse grasse", tour_cou:"Tour de cou", poitrine:"Poitrine",
    sous_poitrine:"Sous la poitrine", tour_dos:"Tour de dos (sous la poitrine)", tour_dos_aisselles:"Tour sous les aisselles (ancienne mesure)", tour_taille:"Tour de taille",
    tour_hanches:"Tour de hanches", tour_fessiers:"Tour de fessiers", tour_cuisse:"Tour de cuisse",
    tour_bras:"Tour de bras", tour_mollet:"Tour de mollet",
  };

  // Écart MAXIMUM crédible en 4 semaines (au-delà = presque toujours mètre mal placé / faute de frappe).
  const MAX_4SEM = {
    poids:3, masse_grasse:3, tour_cou:1.5, poitrine:4, sous_poitrine:3, tour_dos:4,
    tour_taille:4, tour_hanches:4, tour_fessiers:4, tour_cuisse:3, tour_bras:2, tour_mollet:2,
  };
  // Si le poids n'a quasiment pas bougé (< 1 kg), un gros tour ne peut pas bouger de plus de 3 cm.
  const GROS_TOURS = ["poitrine","sous_poitrine","tour_dos","tour_taille","tour_hanches","tour_fessiers","tour_cuisse"];
  // Valeurs physiquement possibles (sinon faute de frappe).
  const BORNES = {
    poids:[35,180], masse_grasse:[8,60], tour_cou:[25,55], tour_bras:[18,55], tour_mollet:[25,55],
    tour_cuisse:[35,90], poitrine:[60,160], sous_poitrine:[55,140], tour_dos:[60,150],
    tour_taille:[50,160], tour_hanches:[60,170], tour_fessiers:[65,170],
  };

  const num = (x) => { if (x == null || x === "") return null; const n = Number(String(x).replace(",", ".")); return isFinite(n) ? n : null; };
  const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const r1 = (n) => Math.round(n * 10) / 10;

  // Dernier relevé du même type AVANT une date.
  function precedent(mensurations, type, date, excludeId) {
    return (mensurations || [])
      .filter((m) => m.type === type && m.date < date && m.id !== excludeId && num(m.valeur) != null)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  }

  // Analyse UNE valeur. Renvoie null si OK, sinon { court, long } (texte du message rouge).
  // ctx = { mensurations, date, poids (poids saisi en même temps, facultatif), excludeId }
  function verifier(type, valeur, ctx) {
    const v = num(valeur);
    if (v == null) return null;
    const unite = type === "poids" ? "kg" : type === "masse_grasse" ? "%" : "cm";
    const b = BORNES[type];
    if (b && (v < b[0] || v > b[1])) {
      return { court:"valeur impossible", long:`${v} ${unite} : valeur impossible — faute de frappe ?` };
    }
    const max = MAX_4SEM[type];
    if (!max || !ctx || !ctx.date) return null;
    const prev = precedent(ctx.mensurations, type, ctx.date, ctx.excludeId);
    if (!prev) return null;
    const d = Math.max(1, jours(prev.date, ctx.date));
    let limite = max * Math.min(3, Math.max(1, d / 28));
    // Poids stable → les gros tours ne peuvent pas avoir bougé beaucoup.
    if (GROS_TOURS.includes(type)) {
      const pNow = num(ctx.poids) != null ? num(ctx.poids)
        : (precedent(ctx.mensurations, "poids", ctx.date + "~", ctx.excludeId) || {}).valeur;
      const pPrev = precedent(ctx.mensurations, "poids", prev.date + "~", null);
      if (num(pNow) != null && pPrev && Math.abs(num(pNow) - num(pPrev.valeur)) < 1) limite = Math.min(limite, 3);
    }
    const diff = r1(v - num(prev.valeur));
    if (Math.abs(diff) <= limite) return null;
    const sign = diff > 0 ? "+" : "";
    const quand = d <= 45 ? `en ${Math.max(1, Math.round(d / 7))} semaine${d >= 14 ? "s" : ""}` : `en ${Math.round(d / 30)} mois`;
    return {
      court: `${sign}${diff} ${unite} ${quand} — improbable`,
      long: `${num(prev.valeur)} → ${v} ${unite} (${sign}${diff} ${unite} ${quand}) : pas possible, le mètre n'était sûrement pas au même endroit.`,
    };
  }

  // HTML rouge affiché SOUS le champ pendant la saisie.
  function warnHtml(type, valeur, ctx) {
    const w = verifier(type, valeur, ctx);
    if (!w) return "";
    return `⚠️ ${w.long}<br>👉 Re-mesure exactement à l'endroit indiqué ci-dessous.`;
  }

  // Tous les relevés d'un historique qui paraissent improbables → Map(id|clé → {court,long}).
  function flagsHistorique(mensurations) {
    const out = new Map();
    (mensurations || []).forEach((m) => {
      if (m.type === "masse_grasse" && num(m.valeur) === 0) { out.set(cle(m), { court:"valeur vide (0)", long:"0 % : valeur vide, à supprimer" }); return; }
      const poidsMemeJour = (mensurations || []).find((x) => x.type === "poids" && x.date === m.date);
      const w = verifier(m.type, m.valeur, { mensurations, date:m.date, poids: poidsMemeJour && poidsMemeJour.valeur, excludeId:m.id });
      if (w) out.set(cle(m), w);
    });
    return out;
  }
  function cle(m) { return m.id != null ? String(m.id) : `${m.date}|${m.type}|${m.valeur}`; }

  // Liste des alertes du DERNIER relevé (pour WhatsApp / résumé).
  function alertesSaisie(values, types, ctx) {
    return types.map((t) => ({ t, w: verifier(t, values[t], Object.assign({}, ctx, { poids: values.poids })) }))
      .filter((x) => x.w);
  }

  // Valeur de « hanches » à utiliser pour la masse grasse US Navy (tour le plus large du bassin
  // = le point le plus bombé des fesses). Les hanches se prennent désormais aux os du bassin.
  function hancheNavy(fessiers, hanches) { return num(fessiers) != null ? num(fessiers) : num(hanches); }

  return { HINTS, NOMS, MAX_4SEM, verifier, warnHtml, flagsHistorique, alertesSaisie, cle, hancheNavy, precedent };
})();
