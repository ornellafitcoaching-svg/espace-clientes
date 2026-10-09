// ============================================================================
// calc.js — calculs dérivés (jamais stockés) + formatage.
// ============================================================================
window.Calc = {
  // ---- Dates --------------------------------------------------------------
  // 'YYYY-MM-DD' en heure LOCALE (jamais UTC, pour éviter les décalages d'un jour).
  ymd(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
  today() {
    return this.ymd(new Date()); // date locale, pas UTC
  },
  parse(d) {
    return d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : null;
  },
  fmt(d) {
    if (!d) return "—";
    const dt = this.parse(d);
    return dt ? dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  },
  fmtShort(d) {
    if (!d) return "—";
    const dt = this.parse(d);
    return dt ? dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";
  },
  // Avec le jour de la semaine : "lun. 7 sept." (pour les séances / RDV).
  fmtJour(d) {
    if (!d) return "—";
    const dt = this.parse(d);
    return dt ? dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "—";
  },
  // Date + heure d'un timestamp complet (ex. connexion) : "lun. 4 sept. à 10h24" (heure locale).
  fmtDateHeure(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    const jour = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const h = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
    return jour + " à " + h;
  },
  // Heure "09:30" ou "09:30:00" → "9h30" (et "09:00" → "9h"). Vide si absente.
  fmtHeure(h) {
    if (!h) return "";
    const m = String(h).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "";
    const hh = parseInt(m[1], 10);
    return m[2] === "00" ? hh + "h" : hh + "h" + m[2];
  },
  daysBetween(a, b) {
    const da = this.parse(a), db = this.parse(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  },
  daysFromToday(d) {
    return this.daysBetween(this.today(), d);
  },

  // ---- Séances ------------------------------------------------------------
  seancesStats(accompagnement, seances) {
    const prevues = (accompagnement && accompagnement.seances_prevues) || 0;
    // Report initial (séances déjà faites au CRM, dates inconnues) + séances réelles cochées.
    const init = (accompagnement && accompagnement.seances_faites_init) || 0;
    const realisees = init + (seances || []).filter((s) => s.statut === "realisee").length;
    const restantes = Math.max(0, prevues - realisees);
    const pct = prevues > 0 ? Math.round((realisees / prevues) * 100) : 0;
    return { prevues, realisees, restantes, pct };
  },

  // Fin ESTIMÉE d'un pack présentiel : au rythme actuel, quand les séances restantes
  // seront-elles écoulées ? fin ≈ aujourd'hui + (restantes ÷ rythme/semaine).
  // Rythme déduit : 1) des séances réalisées depuis le début, 2) sinon des séances
  // programmées à venir (écart moyen), 3) sinon 1/semaine par défaut. null si rien à estimer.
  finEstimeeSeances(accompagnement, seances) {
    const st = this.seancesStats(accompagnement, seances);
    if (!st.prevues || st.restantes <= 0) return null;
    let rythme = null; // séances par semaine
    const deb = accompagnement && accompagnement.date_debut;
    if (deb && st.realisees > 0) {
      const jours = this.daysBetween(deb, this.today());
      if (jours && jours >= 7) rythme = st.realisees / (jours / 7);
    }
    if (!rythme || rythme <= 0) {
      const up = (seances || []).filter((s) => s.statut === "prevue" && s.date && s.date >= this.today())
        .map((s) => s.date).sort();
      if (up.length >= 2) {
        const span = this.daysBetween(up[0], up[up.length - 1]);
        if (span > 0) rythme = (up.length - 1) / (span / 7);
      }
    }
    if (!rythme || rythme <= 0) rythme = 1;
    const d = this.parse(this.today());
    d.setDate(d.getDate() + Math.ceil((st.restantes / rythme) * 7));
    return this.ymd(d);
  },

  // ---- Bilans -------------------------------------------------------------
  // dernier bilan = date la plus récente ; prochain = dernier + 28 jours.
  // dernier bilan = date la plus récente ; prochain = dernier + 28 j.
  // Si aucun bilan encore : le prochain se base sur la date de début (+28 j),
  // pour qu'une cliente qui démarre ait quand même une date de prochain bilan.
  // Date du questionnaire de démarrage = le « premier bilan » (point de départ des 4 semaines).
  // On prend la plus ANCIENNE date de la liste (le questionnaire est rempli une fois).
  // Date EFFECTIVE d'un bilan / questionnaire : sa date, ou le jour où la CLIENTE l'a
  // envoyé si c'est plus récent (created_at). Une date saisie dans le passé par erreur
  // ne laisse donc plus un faux « bilan en retard » côté coach.
  dateEffective(x) {
    if (!x) return null;
    let d = x.date || null;
    if (x.created_at && (x.saisi_par === "cliente" || !x.saisi_par)) {
      const c = String(x.created_at).slice(0, 10);
      if (!d || c > d) d = c;
    }
    return d;
  },
  // Dernier point fait HORS bilan mensuel (questionnaire de démarrage, bilan de démarrage…) :
  // date la plus RÉCENTE sur toutes les listes passées. Remplir l'un d'eux compte comme
  // un bilan → le compte à rebours des 4 semaines repart de là.
  demarrageDate(...lists) {
    const dates = lists.flatMap(l => (l || []).map(x => this.dateEffective(x))).filter(Boolean);
    return dates.length ? dates.sort()[dates.length - 1] : null;
  },
  // Dernière prise de mesures faite par la CLIENTE = son « check-in » (gardé pour compatibilité).
  checkinClienteDate(mensurations) {
    const dates = (mensurations || []).filter(m => m && m.saisi_par === "cliente" && m.date).map(m => m.date);
    return dates.length ? dates.slice().sort().slice(-1)[0] : null;
  },
  bilanStats(bilans, dateDebut, dateDemarrage) {
    const dates = (bilans || []).map(x => this.dateEffective(x)).filter(Boolean).sort();
    const dernierPeriodique = dates.length ? dates[dates.length - 1] : null;
    // Dernier bilan = le plus RÉCENT entre bilan mensuel et questionnaire / bilan de démarrage
    // (avant : le questionnaire était ignoré dès qu'un ancien bilan existait → faux retard).
    const dernier = [dernierPeriodique, dateDemarrage].filter(Boolean).sort().pop() || null;
    const ancre = dernier || dateDebut || null;
    if (!ancre) return { dernier, prochain: null, joursAvant: null };
    const dt = this.parse(ancre);
    dt.setDate(dt.getDate() + 28);
    const prochain = this.ymd(dt); // heure locale (pas d'UTC → pas de décalage)
    return { dernier, prochain, joursAvant: this.daysFromToday(prochain) };
  },

  // ===== SOURCE UNIQUE de l'état « bilan » d'une cliente (coach, fiche, espace cliente) =====
  // Accepte le dossier du dashboard (questionnaireInitial / bilansDemarrage) ou le dossier
  // complet (questionnaire_initial / bilans_demarrage). Compte comme un « point bilan » :
  //   • un bilan mensuel,  • le questionnaire de démarrage,  • le bilan de démarrage,
  //   • des mensurations saisies par ELLE (check-in ; pas celles relevées par la coach).
  // Le plus récent relance le compte à rebours de 4 semaines. Aucun point → date de début.
  // Renvoie { dernier, prochain, joursAvant, source, parElle, statut }
  //   statut = "retard" | "bientot" (≤ 7 j) | "ajour" | null (pas démarrée).
  BILAN_SOURCES: { bilan: "bilan", questionnaire: "questionnaire de démarrage", demarrage: "bilan de démarrage", mensurations: "mensurations" },
  bilanEtat(c) {
    if (!c) return { dernier: null, prochain: null, joursAvant: null, source: null, parElle: false, statut: null };
    const lists = {
      bilan: c.bilans || [],
      questionnaire: c.questionnaireInitial || c.questionnaire_initial || [],
      demarrage: c.bilansDemarrage || c.bilans_demarrage || [],
      // Mensurations : seules celles saisies par la CLIENTE valent check-in (pas celles
      // relevées par la coach en présentiel).
      mensurations: (c.mensurations || []).filter(m => m && m.saisi_par === "cliente"),
    };
    let best = null;
    Object.keys(lists).forEach(src => lists[src].forEach(x => {
      const d = this.dateEffective(x);
      // À date égale, on préfère afficher « bilan » (ordre des clés).
      if (d && (!best || d > best.d)) best = { d, src, parElle: x.saisi_par === "cliente" };
    }));
    const ac = c.accompagnement;
    const b = this.bilanStats([], ac && ac.date_debut, best ? best.d : null);
    const j = b.joursAvant;
    const statut = j === null ? null : j < 0 ? "retard" : j <= 7 ? "bientot" : "ajour";
    return { ...b, source: best ? best.src : null, parElle: !!(best && best.parElle), statut };
  },

  // Date de fin prévisionnelle = date de début + nb de mois (null si incomplet).
  dateFin(dateDebut, nbMois) {
    if (!dateDebut || !nbMois) return null;
    const d = this.parse(dateDebut);
    if (!d) return null;
    d.setMonth(d.getMonth() + Number(nbMois));
    return this.ymd(d);
  },

  // ---- Suivi (durée / fin) ------------------------------------------------
  suiviStats(accompagnement) {
    if (!accompagnement) return { joursRestants: null, pctTemps: null };
    const { date_debut, date_fin } = accompagnement;
    const joursRestants = date_fin ? this.daysFromToday(date_fin) : null;
    let pctTemps = null;
    if (date_debut && date_fin) {
      const total = this.daysBetween(date_debut, date_fin) || 1;
      const ecoule = this.daysBetween(date_debut, this.today());
      pctTemps = Math.min(100, Math.max(0, Math.round((ecoule / total) * 100)));
    }
    return { joursRestants, pctTemps };
  },

  // ---- Mensurations : évolution départ → dernière --------------------------
  mensuEvolution(mensurations, type) {
    const list = (mensurations || [])
      .filter((m) => m.type === type)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!list.length) return null;
    const depart = list[0], derniere = list[list.length - 1];
    const diff = derniere.valeur - depart.valeur;
    const pct = depart.valeur ? Math.round((diff / depart.valeur) * 1000) / 10 : null;
    return {
      type,
      unite: derniere.unite || depart.unite || "",
      depart: depart.valeur,
      derniere: derniere.valeur,
      diff: Math.round(diff * 10) / 10,
      pct,
      points: list,
    };
  },
  mensuTypes(mensurations) {
    return [...new Set((mensurations || []).map((m) => m.type))];
  },
  // Sens FAVORABLE d'une mesure (pour colorer les variations) :
  //   "moins" = perdre est positif (poids, masse grasse, taille…) → baisse en vert, hausse en rouge
  //   "plus"  = gagner est positif (muscles : bras, cuisse, mollet, fessiers) → hausse en vert
  //   absent  = neutre (poitrine, dos, cou, hanches : dépend de l'objectif) → gris, sans jugement
  MESURE_SENS: {
    poids: "moins", masse_grasse: "moins", tour_taille: "moins", sous_poitrine: "moins",
    tour_bras: "plus", tour_cuisse: "plus", tour_mollet: "plus", tour_fessiers: "plus",
  },
  // Classe couleur d'une variation : "good" (vert), "bad" (rouge) ou "neutral" (gris).
  // Une hausse de muscle n'est donc plus affichée en rouge. cf. retour Ornella 08/09.
  mensuTone(type, diff) {
    if (!diff) return "neutral";
    const sens = this.MESURE_SENS[type];
    if (!sens) return "neutral";
    const favorable = (sens === "moins" && diff < 0) || (sens === "plus" && diff > 0);
    return favorable ? "good" : "bad";
  },

  // ---- Programmes envoyés (sportif / nutrition) ---------------------------
  // État d'envoi d'un type de programme pour une cliente. Mutualisé entre les
  // alertes du dashboard et la section « Programmes à envoyer ».
  //   kind = "sportif"  → concerne les distanciel / hybride (séances à faire seule).
  //   kind = "nutrition" → concerne les clientes avec suivi nutrition actif.
  // Renvoie null si la cliente n'est pas concernée par ce type de programme, sinon :
  //   { kind, jamais, dernier, prochain, joursAvant, statut }
  //   statut = "jamais" | "retard" | "bientot" (échéance ≤ 3 j) | "ajour".
  // L'échéance = date_fin saisie sur le dernier programme (« Fin du programme » /
  // « prochaine échéance »), sinon repli sur « dernier envoi + 1 mois ».
  programmeStatus(c, kind) {
    const cl = c.cliente, ac = c.accompagnement;
    // Cas particulier : une cliente PRÉSENTIEL peut suivre un vrai programme salle
    // structuré (ex. Sophie) qu'on renouvelle tous les mois. On ne l'inclut QUE si elle
    // a déjà un programme sportif envoyé AVEC une date de fin (= programme daté, voulu) —
    // sinon les présentiel « coachés en direct » restent exclus comme avant.
    const presentielSportif = kind === "sportif" && cl && cl.type === "presentiel"
      && (c.programmes || []).some(p => p.kind === "sportif" && p.envoye && p.date_fin);
    const concerne = kind === "sportif"
      ? !!(cl && (cl.type === "distanciel" || cl.type === "hybride")) || presentielSportif
      : !!(ac && ac.nutrition_active);
    if (!concerne) return null;
    const progs = (c.programmes || []).filter((p) => p.kind === kind && p.envoye);
    if (!progs.length) {
      return { kind, jamais: true, dernier: null, prochain: null, joursAvant: null, statut: "jamais" };
    }
    const d = progs.slice().sort((a, b) =>
      ((a.date_envoi || a.created_at || "") < (b.date_envoi || b.created_at || "") ? 1 : -1))[0];
    const dernier = d.date_envoi || (d.created_at ? String(d.created_at).slice(0, 10) : null);
    const prochain = d.date_fin || this.dateFin(dernier, 1);
    const joursAvant = prochain ? this.daysFromToday(prochain) : null;
    let statut = "ajour";
    if (joursAvant !== null && joursAvant < 0) statut = "retard";
    else if (joursAvant !== null && joursAvant <= 3) statut = "bientot";
    return { kind, jamais: false, dernier, prochain, joursAvant, statut };
  },

  // ---- Argent : combien cette cliente doit-elle ? ------------------------
  // Priorité au « montant dû » saisi à la main (accompagnements.montant_du) ;
  // sinon on retombe sur le reste du forfait (prix − paiements reçus).
  // Renvoie 0 si rien n'est dû (ou pas d'info).
  detteCliente(c) {
    const ac = c && c.accompagnement; if (!ac) return 0;
    const du = ac.montant_du;
    if (du != null && du !== "" && Number(du) > 0.009) return Math.round(Number(du) * 100) / 100;
    if (ac.prix != null && ac.prix !== "") {
      const enc = (c.paiements || []).reduce((s, p) => s + (Number(p.montant) || 0), 0);
      const r = Math.round((Number(ac.prix) - enc) * 100) / 100;
      return r > 0.009 ? r : 0;
    }
    return 0;
  },

  // ---- Alertes (dashboard) ------------------------------------------------
  // Renvoie la liste d'alertes pour une cliente { dossier léger }.
  alertes(c) {
    const out = [];
    // Bilan rempli par la cliente récemment (≤ 10 j) → à consulter.
    // Bilans remplis par la cliente récemment (≤ 10 j) → notif qui reste affichée avec la DATE.
    const bilansCliente = (c.bilans || []).filter((x) =>
      x.saisi_par === "cliente" && x.created_at &&
      this.daysFromToday(String(x.created_at).slice(0, 10)) >= -10);
    if (bilansCliente.length) {
      const dernier = bilansCliente.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      const jour = String(dernier.created_at).slice(0, 10);
      out.push({ type: "nouveau_bilan", label: "Nouveau bilan rempli", icon: "🆕", date: jour });
    }
    // Questionnaire de démarrage (le « 1er bilan complet ») rempli par la cliente récemment
    // (≤ 14 j) → notif importante qui reste affichée avec la DATE.
    const qiCliente = (c.questionnaireInitial || []).filter((x) =>
      (x.saisi_par === "cliente" || !x.saisi_par) && x.created_at &&
      this.daysFromToday(String(x.created_at).slice(0, 10)) >= -14);
    if (qiCliente.length) {
      const dernier = qiCliente.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      out.push({ type: "nouveau_questionnaire", label: "Questionnaire de démarrage rempli", icon: "🆕", date: String(dernier.created_at).slice(0, 10) });
    }
    // Bilan de DÉMARRAGE (ressenti des 1res séances) rempli par la cliente récemment (≤ 14 j).
    // Avant, aucune notif : Ornella ne voyait pas qu'il avait été rempli.
    const bdCliente = (c.bilansDemarrage || []).filter((x) =>
      (x.saisi_par === "cliente" || !x.saisi_par) && x.created_at &&
      this.daysFromToday(String(x.created_at).slice(0, 10)) >= -14);
    if (bdCliente.length) {
      const dernier = bdCliente.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      out.push({ type: "nouveau_bilan_demarrage", label: "Bilan de démarrage rempli", icon: "🆕", date: String(dernier.created_at).slice(0, 10) });
    }
    // Questionnaire ALIMENTAIRE (bilan nutrition) rempli par la cliente récemment (≤ 14 j).
    const qnCliente = (c.questionnaireNutrition || []).filter((x) =>
      (x.saisi_par === "cliente" || !x.saisi_par) && x.created_at &&
      this.daysFromToday(String(x.created_at).slice(0, 10)) >= -14);
    if (qnCliente.length) {
      const dernier = qnCliente.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      out.push({ type: "nouveau_questionnaire_nutrition", label: "Questionnaire alimentaire rempli", icon: "🥗", date: String(dernier.created_at).slice(0, 10) });
    }
    // Mensurations saisies par la CLIENTE récemment (≤ 10 j) → à consulter côté coach.
    // On n'affiche PAS ce badge si un « nouveau bilan » OU un questionnaire est déjà signalé :
    // ils contiennent déjà ces mensurations, inutile de notifier deux fois le même moment.
    if (!bilansCliente.length && !qiCliente.length) {
      const mensuCliente = (c.mensurations || []).filter((x) =>
        x.saisi_par === "cliente" && x.created_at &&
        this.daysFromToday(String(x.created_at).slice(0, 10)) >= -10);
      if (mensuCliente.length) {
        const dernier = mensuCliente.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        const jour = String(dernier.created_at).slice(0, 10);
        out.push({ type: "nouvelle_mensuration", label: "Nouvelles mensurations", icon: "🆕", date: jour });
      }
    }
    // Cliente EN PAUSE (ex. blessée) : on ne la harcèle pas. On garde les notifs de
    // CONSULTATION ci-dessus (elle a rempli un bilan / des mensurations) mais on coupe
    // TOUTES les relances « à faire » (bilan, séances, fin de suivi, programmes…).
    const enPause = c.cliente && c.cliente.statut === "en_pause";
    if (enPause) return out;
    // Cliente au statut « Terminé » : suivi clôturé (en attente d'un éventuel
    // renouvellement) → plus AUCUNE relance « à faire » (bilan, séances, programmes…).
    // On garde uniquement les notifs de CONSULTATION collectées plus haut.
    const estTermine = c.cliente && c.cliente.statut === "termine";
    if (estTermine) return out;
    const ac = c.accompagnement || null;
    const suivi = this.suiviStats(ac);
    const dateFin = ac && ac.date_fin ? ac.date_fin : null;
    const statut = c.cliente ? c.cliente.statut : null;
    const active = statut === "active";
    // FIN DE PARCOURS : soit la date de fin est dépassée (cliente encore active), soit elle
    // est explicitement marquée « à renouveler ». On bascule en logique « fin » et on coupe
    // les rappels récurrents qui n'ont plus de sens (bilan des 4 sem, renvoi de programme,
    // séances). Une cliente finie appelle UN bilan de fin + une décision renouveler/clôturer,
    // chacun avec son message WhatsApp dédié.
    const dateFinPassee = suivi.joursRestants !== null && suivi.joursRestants < 0;
    const termine = (active && dateFinPassee) || statut === "a_renouveler";
    if (termine) {
      // Bilan de FIN : une seule fois, tant qu'aucun bilan n'est enregistré depuis la date
      // de fin (uniquement si la date de fin est connue).
      const dernierPoint = this.bilanEtat(c).dernier;
      const bilanDeFinFait = !!(dernierPoint && dateFin && dernierPoint >= dateFin);
      if (dateFin && !bilanDeFinFait) out.push({ type: "bilan_fin", label: "Bilan de fin à faire", icon: "🏁" });
      out.push({ type: "fin_termine", label: dateFin ? ("Suivi terminé le " + this.fmt(dateFin) + " → à renouveler") : "Suivi à renouveler", icon: "⏳" });
      return out;
    }
    // Suivi sur le point de finir (moins d'une semaine) : on ne réclame plus de NOUVEAU
    // programme (il dépasserait la fin du suivi) — la bonne action c'est renouveler/clôturer.
    const finProche = suivi.joursRestants !== null && suivi.joursRestants < 7;
    const b = this.bilanEtat(c);
    // Même seuil que la liste « Bilan à faire » du dashboard (retard ou ≤ 7 j) → compteurs cohérents.
    if (b.statut === "retard" || b.statut === "bientot") {
      out.push({ type: "bilan", label: b.joursAvant < 0 ? "Bilan en retard" : "Bilan à faire", icon: "🔔" });
    }
    const s = this.seancesStats(ac, c.seances);
    // Séances réellement programmées à venir (RDV pas encore passés).
    const today = this.today();
    const programmees = (c.seances || []).filter(x => x.statut === "prevue" && x.date && x.date >= today).length;
    // « Presque finies » = il reste peu de séances au forfait ET il en reste à
    // PROGRAMMER (le CTA est « Programmer »). On l'affiche donc seulement s'il reste
    // des séances non encore calées. Si tout ce qui reste est déjà programmé (ex. un
    // hybride 2 séances dont la dernière est déjà prévue), aucune action → pas d'alerte.
    // Restriction restantes < prevues : évite l'alerte absurde d'un forfait à 0 séance faite (ex. 0/2).
    if (s.prevues > 0 && s.restantes <= 2 && s.restantes < s.prevues && programmees < s.restantes) {
      out.push({ type: "seances", label: "Séances presque finies", icon: "🏋️" });
    }
    // Point 7 — « prévoir des séances » : il reste beaucoup de séances au forfait
    // (> 2) mais très peu sont réellement programmées à venir (≤ 2). Uniquement pour
    // les accompagnements avec RDV en personne (présentiel / hybride) ; les distancielles
    // n'ont pas de séances programmées (cf. bloc « Sans séance programmée »).
    if (active) {
      const avecRdv = c.cliente.type === "presentiel" || c.cliente.type === "hybride";
      if (avecRdv && s.restantes > 2 && programmees <= 2) {
        out.push({ type: "prevoir_seances", label: "Prévoir des séances", icon: "🗓️" });
      }
      // Adresse manquante pour une cliente vue en personne : sans elle, l'événement
      // agenda Apple (fichier .ics) n'a pas de lieu → on invite à la renseigner.
      if (avecRdv && !(c.cliente.adresse && String(c.cliente.adresse).trim())) {
        out.push({ type: "adresse", label: "Adresse à renseigner (pour l'agenda)", icon: "📍" });
      }
    }
    // NB : le bilan de démarrage n'est PAS une alerte automatique — c'est Ornella
    // qui choisit de l'envoyer via le bouton sur la fiche (pas de notif imposée).
    if (suivi.joursRestants !== null && suivi.joursRestants <= 14 && suivi.joursRestants >= 0) {
      out.push({ type: "fin", label: "Suivi bientôt terminé", icon: "⏳" });
    }
    // (Le statut « à renouveler » est traité plus haut en fin de parcours.)
    // Programmes à envoyer / renouveler — UNIQUEMENT pour les clientes concernées :
    //   • distanciel / hybride  → programme de SÉANCE (celles à faire entre les présentiels
    //                              pour les hybrides, ou à distance pour les distancielles) ;
    //   • nutrition active       → programme NUTRITION.
    // Désormais RÉCURRENT (pas seulement le 1er) : dès qu'un programme arrive à échéance
    // (date_fin saisie, sinon dernier envoi + 1 mois), on rappelle de renvoyer le suivant.
    // Une cliente présentiel sans nutrition est coachée en personne : rien à envoyer.
    // Et si le suivi finit dans moins d'une semaine, on ne réclame plus de programme.
    if (active && !finProche) {
      const ps = this.programmeStatus(c, "sportif");
      if (ps) {
        const presSport = c.cliente && c.cliente.type === "presentiel";
        // Présentiel (ex. Sophie) : on ne réclame jamais un 1er programme (pas de "jamais"
        // ici car exige déjà un programme daté), mais on rappelle de le RENOUVELER à échéance,
        // calée sur la fin du programme (≈ toutes les 4 semaines, après le bilan).
        if (ps.jamais) {
          if (!presSport) out.push({ type: "programme", label: "Programme de séance à envoyer", icon: "📤" });
        } else if (ps.statut === "retard" || ps.statut === "bientot") {
          out.push(presSport
            ? { type: "programme", label: "Programme salle à mettre à jour (après le bilan)", icon: "🏋️" }
            : { type: "programme", label: "Programme de séance à renvoyer", icon: "📤" });
        }
      }
      const pn = this.programmeStatus(c, "nutrition");
      if (pn) {
        if (pn.jamais) out.push({ type: "nutrition_mensuelle", label: "1er programme nutrition à envoyer", icon: "🥗" });
        else if (pn.statut === "retard" || pn.statut === "bientot")
          out.push({ type: "nutrition_mensuelle", label: "Programme nutrition à renouveler", icon: "🥗" });
      }
    }
    return out;
  },

  // ---- WhatsApp / liens espace (partagés coach + fiche) -------------------
  // Normalise un numéro FR en international sans "+" (06…→336…, gère +33/0033/espaces).
  normalizeFrPhone(tel) {
    let d = String(tel || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "33" + d.slice(1);
    return d;
  },
  // Lien WhatsApp pré-rempli vers un numéro (null si pas de numéro).
  waHref(tel, text) {
    const num = this.normalizeFrPhone(tel);
    if (!num) return null;
    return "https://wa.me/" + num + "?text=" + encodeURIComponent(text);
  },
  // Lien de connexion 1 clic à l'espace cliente (avec son code si fourni).
  espaceLink(code) {
    return code
      ? "https://espace.ornellafitcoaching.com/espace.html?code=" + encodeURIComponent(code)
      : "https://espace.ornellafitcoaching.com";
  },
  // Message « demande de bilan » pré-rempli (tutoiement selon cl.tutoiement).
  bilanMsg(cl, retard) {
    const lien = this.espaceLink(cl.access_code);
    const quand = retard ? "(il est un peu en retard, pas de souci !)" : "(on en fait un toutes les 4 semaines)";
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 C'est le moment de faire ton bilan " + quand
        + " 📊\n\nTu peux le remplir en 2 min directement dans ton espace (connexion en 1 clic) : " + lien
        + "\n\nÇa me permet de suivre ta progression et d'ajuster ton programme 💪";
    }
    return "Bonjour " + cl.prenom + " 😊 C'est le moment de faire votre bilan " + quand
      + " 📊\n\nVous pouvez le remplir en 2 min directement dans votre espace (connexion en 1 clic) : " + lien
      + "\n\nCela me permet de suivre votre progression et d'ajuster votre programme 💪";
  },
  // Message « BILAN DE FIN » (clôture d'accompagnement) — cohérent avec une fin, pas le récurrent.
  bilanFinMsg(cl) {
    const lien = this.espaceLink(cl.access_code);
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 On arrive au bout de ton accompagnement 🎉\n\n"
        + "J'aimerais qu'on fasse ton *bilan de fin* pour mesurer tout le chemin parcouru depuis le début 📊 "
        + "Tu peux le remplir en 2 min dans ton espace : " + lien
        + "\n\nJ'ai hâte de voir tes résultats — on fera le point ensemble sur la suite 💪";
    }
    return "Bonjour " + cl.prenom + " 😊 Nous arrivons au terme de votre accompagnement 🎉\n\n"
      + "J'aimerais faire votre *bilan de fin* pour mesurer le chemin parcouru depuis le début 📊 "
      + "Vous pouvez le remplir en 2 min dans votre espace : " + lien
      + "\n\nNous ferons le point ensemble sur vos résultats et la suite 💪";
  },
  // Message « RENOUVELLEMENT » — proposer de continuer à la fin de l'accompagnement.
  renouvellementMsg(cl) {
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Ton accompagnement touche à sa fin, et j'ai adoré bosser avec toi 💚\n\n"
        + "Est-ce que tu veux qu'on continue l'aventure ensemble et qu'on reparte sur un nouveau cycle ? "
        + "Dis-moi ce que tu en penses, je te prépare la suite adaptée à tes objectifs 💪";
    }
    return "Bonjour " + cl.prenom + " 😊 Votre accompagnement touche à sa fin, et j'ai adoré travailler avec vous 💚\n\n"
      + "Souhaitez-vous continuer et repartir sur un nouveau cycle ? "
      + "Dites-moi ce que vous en pensez, je vous prépare la suite adaptée à vos objectifs 💪";
  },
  // Message « rappel de séance » pré-rempli (tutoiement selon cl.tutoiement).
  seanceRappelMsg(cl, date, type, heure) {
    const h = this.fmtHeure(heure);
    const quand = this.fmt(date) + (h ? " à " + h : "") + (type ? " (" + type + ")" : "");
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Petit rappel : on a séance prévue le " + quand
        + " 💪 Hâte de te voir ! Si tu as besoin de décaler, dis-le-moi 🙂";
    }
    return "Bonjour " + cl.prenom + " 😊 Petit rappel : nous avons séance prévue le " + quand
      + " 💪 Au plaisir de vous voir ! Si vous avez besoin de décaler, dites-le-moi 🙂";
  },
  // Confirmation d'une séance programmée / déplacée par la coach → à envoyer à la cliente.
  seanceConfirmMsg(cl, s) {
    const h = this.fmtHeure(s && s.heure);
    const quand = this.fmtJour(s && s.date) + (h ? " à " + h : "") + (s && s.type ? " (" + s.type + ")" : "");
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 C'est noté : ta séance est bien programmée le " + quand
        + " 💪 On se voit là-bas ! Si tu as un empêchement, préviens-moi 🙂";
    }
    return "Bonjour " + cl.prenom + " 😊 C'est noté : votre séance est bien programmée le " + quand
      + " 💪 On se voit là-bas ! Si vous avez un empêchement, prévenez-moi 🙂";
  },
  // Message d'ANNULATION d'une séance (WhatsApp) — tu/vous selon la cliente.
  seanceAnnulMsg(cl, s) {
    const h = this.fmtHeure(s && s.heure);
    const quand = this.fmtJour(s && s.date) + (h ? " à " + h : "");
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Je dois annuler ta séance du " + quand
        + ". Je te propose un nouveau créneau très vite, désolée pour le contretemps 🙏";
    }
    return "Bonjour " + cl.prenom + " 😊 Je dois annuler votre séance du " + quand
      + ". Je vous propose un nouveau créneau très vite, désolée pour le contretemps 🙏";
  },
  // Récap de TOUTES les séances à venir d'une cliente (WhatsApp) + décompte fait/restant + invite à modif.
  recapSeancesMsg(cl, seances, accompagnement) {
    const today = this.today();
    const list = (seances || [])
      .filter(s => s.statut === "prevue" && s.date && s.date >= today)
      .sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : ((a.heure||"99") < (b.heure||"99") ? -1 : 1));
    const lignes = list.map(s => {
      const h = this.fmtHeure(s.heure);
      return "• " + this.fmtJour(s.date) + (h ? " à " + h : "") + (s.type ? " — " + s.type : "");
    }).join("\n");
    // Décompte forfait : X faites · Y restantes (uniquement si un forfait est renseigné).
    const st = this.seancesStats(accompagnement, seances);
    const pluri = n => (n > 1 ? "s" : "");
    const compte = st.prevues
      ? "✅ " + st.realisees + " séance" + pluri(st.realisees) + " faite" + pluri(st.realisees)
        + " · ⏳ " + st.restantes + " restante" + pluri(st.restantes)
        + " sur ton forfait de " + st.prevues + "\n\n"
      : "";
    const compteVous = st.prevues
      ? "✅ " + st.realisees + " séance" + pluri(st.realisees) + " faite" + pluri(st.realisees)
        + " · ⏳ " + st.restantes + " restante" + pluri(st.restantes)
        + " sur votre forfait de " + st.prevues + "\n\n"
      : "";
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Voici le récap de tes prochaines séances :\n\n"
        + compte
        + (lignes || "(aucune séance programmée pour le moment)")
        + "\n\nSi tu as besoin de modifier ou décaler une séance, réponds-moi ici et on s'arrange 🙂 💪";
    }
    return "Bonjour " + cl.prenom + " 😊 Voici le récap de vos prochaines séances :\n\n"
      + compteVous
      + (lignes || "(aucune séance programmée pour le moment)")
      + "\n\nSi vous avez besoin de modifier ou décaler une séance, répondez-moi ici et on s'arrange 🙂 💪";
  },
  // Message « invitation à l'espace » pré-rempli (tutoiement selon cl.tutoiement).
  accessInviteMsg(cl) {
    const lien = this.espaceLink(cl.access_code);
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Voici ton espace personnel de suivi ✨ Tu y retrouves tes séances "
        + "à venir (avec les horaires), tes bilans, tes mensurations, ton évolution et tes programmes.\n\n"
        + "👉 Ton accès en 1 clic : " + lien
        + "\n\nN'hésite pas si tu as la moindre question. Belle journée ! 💪";
    }
    return "Bonjour " + cl.prenom + " 😊 J'ai le plaisir de vous présenter votre espace personnel de suivi ✨ "
      + "Vous y retrouvez vos séances à venir (avec les horaires), vos bilans, vos mensurations, votre évolution "
      + "et vos programmes.\n\n👉 Votre accès en 1 clic : " + lien
      + "\n\nN'hésitez pas si vous avez la moindre question. Belle journée ! 💪";
  },

  // Message « demander une mesure manquante » (ex. tour de cou pour l'IMG), tu/vous.
  // label = nom lisible de la mesure ; hint = consigne de placement (facultatif).
  demandeMesureMsg(cl, label, hint) {
    const lien = this.espaceLink(cl.access_code);
    const l = String(label || "").toLowerCase();
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Il me manque une mesure pour compléter ton suivi : ton " + l + " 📏"
        + (hint ? "\n📍 " + hint : "")
        + "\n\nTu peux me l'envoyer par retour de message, ou l'ajouter toi-même dans ton espace (rubrique Mensurations) : " + lien
        + "\n\nMerci ma belle 💛";
    }
    return "Bonjour " + cl.prenom + " 😊 Il me manque une mesure pour compléter votre suivi : votre " + l + " 📏"
      + (hint ? "\n📍 " + hint : "")
      + "\n\nVous pouvez me l'envoyer par retour de message, ou l'ajouter vous-même dans votre espace (rubrique Mensurations) : " + lien
      + "\n\nMerci à vous 💛";
  },

  // Récap mensurations pour WhatsApp : pour chaque mesure, départ → dernière + variation
  // (ex. « Tour de taille : 80 → 79 cm (−1 cm) 👏 »), avec un clin d'œil quand c'est favorable.
  recapMensurationsMsg(cl, mensurations) {
    // Ordre lisible : poids/masse grasse d'abord, puis les tours.
    const ordre = ["poids","masse_grasse","tour_taille","tour_hanches","tour_fessiers","tour_cuisse",
      "tour_bras","tour_mollet","poitrine","sous_poitrine","tour_dos","tour_cou"];
    const types = this.mensuTypes(mensurations).sort((a,b)=>{
      const ia=ordre.indexOf(a), ib=ordre.indexOf(b);
      return (ia<0?99:ia)-(ib<0?99:ib);
    });
    const lignes = [];
    types.forEach(t => {
      const ev = this.mensuEvolution(mensurations, t);
      if (!ev) return;
      const label = t.replace(/_/g, " ");
      if (ev.points.length < 2) {
        lignes.push("• " + label + " : " + ev.derniere + ev.unite);
      } else {
        const sign = ev.diff > 0 ? "+" : "";
        const emo = this.mensuTone(t, ev.diff) === "good" ? " 👏" : "";
        lignes.push("• " + label + " : " + ev.depart + ev.unite + " → " + ev.derniere + ev.unite
          + " (" + sign + ev.diff + " " + ev.unite + ")" + emo);
      }
    });
    const corps = lignes.length ? lignes.join("\n") : "(aucune mesure enregistrée pour l'instant)";
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Voici le récap de tes mensurations 📏\n\n" + corps
        + "\n\nBravo pour ta progression, on continue comme ça 💪💛";
    }
    return "Bonjour " + cl.prenom + " 😊 Voici le récap de vos mensurations 📏\n\n" + corps
      + "\n\nBravo pour votre progression, on continue comme ça 💪💛";
  },

  // Message « demander un relevé COMPLET de mensurations » (toutes les mesures), tu/vous.
  demandeReleveCompletMsg(cl) {
    const lien = this.espaceLink(cl.access_code);
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 C'est le moment de refaire tes mensurations complètes 📏 "
        + "(poids, tour de taille, hanches, cuisses, bras… tout ce que tu suis).\n\n"
        + "Prends-les tranquillement et entre-les directement dans ton espace — les repères « où placer le mètre » "
        + "sont dans l'app (bouton « Comment bien me mesurer ? ») : " + lien
        + "\n\nÇa me permet de suivre ta progression et d'ajuster ton programme 💪💛";
    }
    return "Bonjour " + cl.prenom + " 😊 C'est le moment de refaire vos mensurations complètes 📏 "
      + "(poids, tour de taille, hanches, cuisses, bras… tout ce que vous suivez).\n\n"
      + "Prenez-les tranquillement et entrez-les directement dans votre espace — les repères « où placer le mètre » "
      + "sont dans l'app (bouton « Comment bien me mesurer ? ») : " + lien
      + "\n\nCela me permet de suivre votre progression et d'ajuster votre programme 💪💛";
  },

  // ---- Agenda Apple (.ics) ------------------------------------------------
  // Génère un événement iCalendar pour UNE séance, avec deux rappels :
  //   • 1 h avant la séance (pour ne pas l'oublier) ;
  //   • ~2 h après le début (« pense à la marquer faite »).
  // Séance sans heure → événement « journée entière » avec rappels le matin (9 h)
  // et en fin de journée (20 h). Ouvre l'app Calendrier sur iPhone/Mac.
  icsEsc(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  },
  _pad2(n) { return String(n).padStart(2, "0"); },
  // "2026-09-08" → "20260908"
  icsDay(dateStr) { return String(dateStr || "").replace(/-/g, ""); },
  // "2026-09-08" + "09:30" → "20260908T093000" (heure locale flottante)
  icsDateTime(dateStr, heure) {
    const day = this.icsDay(dateStr);
    const m = String(heure || "").match(/^(\d{1,2}):(\d{2})/);
    const hh = m ? this._pad2(m[1]) : "09";
    const mm = m ? m[2] : "00";
    return `${day}T${hh}${mm}00`;
  },
  // Décale "20260908T093000" de +minutes → même format.
  icsAddMinutes(dt, minutes) {
    const y = +dt.slice(0, 4), mo = +dt.slice(4, 6) - 1, d = +dt.slice(6, 8);
    const h = +dt.slice(9, 11), mi = +dt.slice(11, 13);
    const date = new Date(y, mo, d, h, mi + Number(minutes || 0), 0);
    return `${date.getFullYear()}${this._pad2(date.getMonth() + 1)}${this._pad2(date.getDate())}`
      + `T${this._pad2(date.getHours())}${this._pad2(date.getMinutes())}00`;
  },
  // Texte iCalendar complet pour une séance d'une cliente.
  seanceICS(cl, s) {
    const nom = [cl.prenom, cl.nom].filter(Boolean).join(" ").trim() || "Cliente";
    const type = s.type ? " — " + s.type : "";
    const summary = this.icsEsc("🏋️ " + nom + type);
    const rappelFaite = this.icsEsc("Séance " + (cl.prenom || "") + " : pense à la marquer faite dans ton espace coach.");
    const loc = cl.adresse ? "LOCATION:" + this.icsEsc(cl.adresse) + "\r\n" : "";
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const uid = "seance-" + (s.id || Math.random().toString(36).slice(2)) + "@ornellafitcoaching";
    let dtLines, alarms;
    if (s.heure) {
      const start = this.icsDateTime(s.date, s.heure);
      const end = this.icsAddMinutes(start, s.duree ? Number(s.duree) : 60);
      dtLines = `DTSTART:${start}\r\nDTEND:${end}`;
      alarms =
        `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nDESCRIPTION:${summary}\r\nEND:VALARM\r\n`
        + `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT2H\r\nDESCRIPTION:${rappelFaite}\r\nEND:VALARM\r\n`;
    } else {
      const day = this.icsDay(s.date);
      const dt = new Date(this.parse(s.date)); dt.setDate(dt.getDate() + 1);
      const next = `${dt.getFullYear()}${this._pad2(dt.getMonth() + 1)}${this._pad2(dt.getDate())}`;
      dtLines = `DTSTART;VALUE=DATE:${day}\r\nDTEND;VALUE=DATE:${next}`;
      alarms =
        `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT9H\r\nDESCRIPTION:${summary}\r\nEND:VALARM\r\n`
        + `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT20H\r\nDESCRIPTION:${rappelFaite}\r\nEND:VALARM\r\n`;
    }
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ornella Fit Coaching//Espace Coach//FR",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + uid, "DTSTAMP:" + stamp, dtLines,
      "SUMMARY:" + summary, loc.replace(/\r\n$/, ""),
      "DESCRIPTION:" + summary, alarms.replace(/\r\n$/, ""), "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
  },
  // Déclenche l'ouverture/téléchargement du .ics.
  // iOS (surtout l'app installée / PWA en mode standalone) NE SUPPORTE PAS le
  // téléchargement blob avec l'attribut `download` : le fichier ne s'ouvre jamais et
  // rien n'arrive dans Calendrier. On ouvre donc le .ics via une URL `data:` que iOS
  // reconnaît → feuille système « Ajouter au calendrier ». Sur desktop/Android on garde
  // le téléchargement classique. Renvoie true si un mécanisme a été déclenché.
  // Flux .ics d'UNE cliente (fonction Supabase agenda-ics, clé = son code d'accès).
  agendaFeedUrl(code) {
    const base = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || "";
    return code && base ? base + "/functions/v1/agenda-ics?code=" + encodeURIComponent(code) : "";
  },
  isIOS() {
    return /iP(hone|od|ad)/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },
  downloadSeanceICS(cl, s) {
    const text = this.seanceICS(cl, s);
    const nom = (cl.prenom || "seance").normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "seance";
    if (this.isIOS()) { this.offerICS(text, "Séance " + (cl.prenom || "")); return true; }
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "seance-" + nom + "-" + (s.date || "") + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    return true;
  },

  // Plusieurs séances (d'une ou plusieurs clientes) dans UN seul fichier .ics.
  // items = [{ cl, s }]. UID stables (seance-<id>) → ré-ajouter met à jour, pas de doublon.
  seancesICS(items) {
    const ev = (items || []).map(({ cl, s }) => {
      const t = this.seanceICS(cl, s);
      return t.slice(t.indexOf("BEGIN:VEVENT"), t.indexOf("END:VEVENT") + "END:VEVENT".length);
    });
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ornella Fit Coaching//Espace Coach//FR",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH"].concat(ev, ["END:VCALENDAR"]).join("\r\n");
  },
  // iPhone : ni data: ni blob ne s'ouvrent de façon fiable (surtout depuis l'app installée).
  // On dépose le .ics dans le stockage Supabase (bucket « photos », dossier coach « agenda/ »,
  // droits coach déjà en place) et on donne un VRAI lien https (text/calendar) : Safari
  // ouvre alors « Ajouter au calendrier ». Le lien est un bouton → vrai geste utilisateur.
  async offerICS(text, titre) {
    const UIx = window.UI;
    try {
      if (UIx) UIx.toast("Préparation de l'agenda…");
      const path = "agenda/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".ics";
      const file = new Blob([text], { type: "text/calendar;charset=utf-8" });
      const up = await window.sb.storage.from("photos").upload(path, file, { contentType: "text/calendar;charset=utf-8", upsert: true });
      if (up.error) throw up.error;
      const sg = await window.sb.storage.from("photos").createSignedUrl(path, 3600);
      if (sg.error || !sg.data || !sg.data.signedUrl) throw (sg.error || new Error("lien indisponible"));
      const n = (text.match(/BEGIN:VEVENT/g) || []).length;
      if (UIx) await UIx.form({ title: "📅 " + (titre || "Agenda"), submit: "Fermer", fields: [
        { name: "_ics", type: "static", value: `<div style="display:flex;flex-direction:column;gap:10px">
          <a class="btn-accent" href="${sg.data.signedUrl}" target="_blank" rel="noopener" style="text-align:center">📅 Ouvrir dans Calendrier (${n} séance${n > 1 ? "s" : ""})</a>
          <div class="isub" style="color:var(--text-mid)">Puis touche <b>« Ajouter »</b> (ou « Ajouter tout »). Déjà ajoutées ? Elles sont mises à jour, pas en double.</div></div>` }] });
      else window.open(sg.data.signedUrl, "_blank");
    } catch (e) {
      console.error(e);
      if (UIx) UIx.toast("Agenda : " + ((e && e.message) || e) + " — réessaie", "err");
    }
    return true;
  },

  // ---- Rappel « prochain programme à envoyer » dans l'agenda de LA COACH -------
  // Événement journée entière sur la date d'échéance (« prochain le X ») pour ne pas
  // oublier d'(r)envoyer le programme d'entraînement / nutrition d'une cliente
  // distanciel / hybride / nutrition. UID stable par cliente+type → re-télécharger
  // après avoir changé la date REMPLACE l'événement (pas de doublon). 2 alarmes :
  // la veille à 9h + le jour même à 9h.
  programmeICS(cl, kind, dateEcheance) {
    const nom = [cl.prenom, cl.nom].filter(Boolean).join(" ").trim() || "Cliente";
    const quoi = kind === "nutrition" ? "nutrition" : "entraînement";
    const summary = this.icsEsc("📤 Programme " + quoi + " de " + (cl.prenom || nom) + " à envoyer");
    const desc = this.icsEsc("Prépare et envoie le programme " + quoi + " de " + nom + " (espace coach).");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const uid = "prog-" + kind + "-" + (cl.id || Math.random().toString(36).slice(2)) + "@ornellafitcoaching";
    const day = this.icsDay(dateEcheance);
    const dt = new Date(this.parse(dateEcheance)); dt.setDate(dt.getDate() + 1);
    const next = `${dt.getFullYear()}${this._pad2(dt.getMonth() + 1)}${this._pad2(dt.getDate())}`;
    const alarms =
      `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15H\r\nDESCRIPTION:${summary}\r\nEND:VALARM\r\n`
      + `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT9H\r\nDESCRIPTION:${summary}\r\nEND:VALARM`;
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ornella Fit Coaching//Espace Coach//FR",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + uid, "DTSTAMP:" + stamp,
      `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
      "SUMMARY:" + summary, "DESCRIPTION:" + desc, alarms, "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  },
  downloadProgrammeICS(cl, kind, dateEcheance) {
    if (!dateEcheance) return false;
    const text = this.programmeICS(cl, kind, dateEcheance);
    const nom = (cl.prenom || "prog").normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "prog";
    if (this.isIOS()) { this.offerICS(text, "Rappel programme " + (cl.prenom || "")); return true; }
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "programme-" + kind + "-" + nom + "-" + (dateEcheance || "") + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    return true;
  },

  // ---- Programme : fichier joint (PDF / image) stocké dans le commentaire -----
  progFile(c) { const m = String(c || "").match(/\[fichier:([^\]]+)\]/); return m ? m[1] : null; },
  progStrip(c) { return String(c || "").replace(/\s*\[fichier:[^\]]+\]/g, "").trim(); },
  progLink(c) { const m = this.progStrip(c).match(/https?:\/\/[^\s]+/); return m ? m[0] : null; },

  // ---- Programmer plusieurs séances d'un coup (liste collée) ---------------
  // 1 ligne = 1 séance. Ex. « Lundi 28 septembre : 12 H45 », « Jeudi 1er octobre : 18h30 »,
  // « 09/10 13:45 ». Lignes « complète / indisponible / annulé / off » ignorées.
  // Année : celle de ref ; si la date est passée de plus de 30 j, année suivante.
  parseSeancesListe(text, ref) {
    const MOIS = { janv:1, janvier:1, fevr:2, fevrier:2, mars:3, avr:4, avril:4, mai:5, juin:6, juil:7, juillet:7,
      aout:8, sept:9, septembre:9, oct:10, octobre:10, nov:11, novembre:11, dec:12, decembre:12 };
    const today = ref ? new Date(ref + "T12:00:00") : new Date();
    const out = [];
    String(text || "").split(/\r?\n/).forEach(raw => {
      const line = raw.trim(); if (!line) return;
      const n = line.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let d = null, mo = null, y = null;
      let m = n.match(/\b(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+(\d{4}))?/);
      if (m && MOIS[m[2]]) { d = +m[1]; mo = MOIS[m[2]]; y = m[3] ? +m[3] : null; }
      else if ((m = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) { d = +m[1]; mo = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; }
      if (!d || !mo || mo > 12 || d > 31) { out.push({ raw: line, skip: "date non reconnue" }); return; }
      if (!y) {
        y = today.getFullYear();
        const cand = new Date(y, mo - 1, d, 12);
        if (cand < new Date(today.getTime() - 30 * 864e5)) y++;
      }
      const dt = new Date(y, mo - 1, d, 12);
      if (dt.getMonth() !== mo - 1) { out.push({ raw: line, skip: "date impossible" }); return; }
      const date = `${y}-${this._pad2(mo)}-${this._pad2(d)}`;
      const OFF = [[/complet/, "complète"], [/indispo/, "indisponible"], [/annul/, "annulée"], [/\boff\b/, "off"], [/pas de seance/, "pas de séance"], [/ferme/, "fermé"]];
      const off = OFF.find(o => o[0].test(n));
      if (off) { out.push({ raw: line, date, skip: off[1] }); return; }
      // Heure : on enlève d'abord la date pour ne pas prendre « 28 » pour une heure.
      const rest = n.replace(m[0], " ");
      const h = rest.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
      let heure = null;
      if (h && +h[1] < 24 && (!h[2] || +h[2] < 60)) heure = this._pad2(+h[1]) + ":" + (h[2] || "00");
      out.push({ raw: line, date, heure, doute: /\?/.test(line) });
    });
    return out;
  },

  // ---- Bilan de démarrage (ressenti des premières séances) ----------------
  // Seuil : proposé à la coach dès que la cliente atteint ce nb de séances réalisées.
  // 1 = dès la 1re séance faite (le ressenti des tout débuts est le plus utile).
  SEUIL_BILAN_DEMARRAGE: 1,
  // À demander ? (>= seuil séances réalisées ET aucun bilan de démarrage déjà rempli)
  // ---- Questionnaires / bilans de départ : UNIQUEMENT pour les nouvelles clientes -------
  // (mis en place à partir d'Anne ; les clientes d'avant les ont déjà faits hors de l'espace).
  // Nouvelle = fiche créée à partir de cette date. Côté coach, la date est avancée à la
  // création de la fiche d'Anne si elle est plus ancienne (initNouvellesDepuis).
  NOUVELLES_DEPUIS_DEFAUT: "2026-09-24",
  _nouvellesDepuis: null,
  nouvellesDepuis() {
    return this._nouvellesDepuis || (window.APP_CONFIG && window.APP_CONFIG.NOUVELLES_CLIENTES_DEPUIS) || this.NOUVELLES_DEPUIS_DEFAUT;
  },
  async initNouvellesDepuis() {
    try {
      const { data } = await window.sb.from("clientes").select("created_at").ilike("prenom", "anne")
        .order("created_at", { ascending: true }).limit(1);
      const d = data && data[0] && String(data[0].created_at || "").slice(0, 10);
      if (d && d < this.nouvellesDepuis()) this._nouvellesDepuis = d;
    } catch (e) { console.error(e); }
  },
  estNouvelle(cl) { return !!cl && String(cl.created_at || "").slice(0, 10) >= this.nouvellesDepuis(); },
  bilanDemarrageDue(accompagnement, seances, bilansDemarrage, cl) {
    if (bilansDemarrage && bilansDemarrage.length) return false;
    if (cl && !this.estNouvelle(cl)) return false;   // anciennes clientes : pas concernées
    const s = this.seancesStats(accompagnement, seances);
    return s.realisees >= this.SEUIL_BILAN_DEMARRAGE;
  },
  // Message « demande de bilan de démarrage » pré-rempli (tutoiement selon cl.tutoiement).
  bilanDemarrageMsg(cl) {
    const lien = this.espaceLink(cl.access_code);
    if (cl.tutoiement) {
      return "Coucou " + cl.prenom + " 🌸 Tu as déjà quelques séances derrière toi, bravo ! 💪\n\n"
        + "J'aimerais faire un petit point sur ton ressenti (douleurs/courbatures, intensité, récupération, "
        + "ce que tu aimes ou pas) pour ajuster au mieux tes séances.\n\nÇa prend 2 min, directement dans ton espace "
        + "(connexion en 1 clic) : " + lien + "\n\nMerci ma belle 💛";
    }
    return "Bonjour " + cl.prenom + " 😊 Vous avez déjà quelques séances derrière vous, bravo ! 💪\n\n"
      + "J'aimerais faire un point sur votre ressenti (douleurs/courbatures, intensité, récupération, "
      + "ce que vous aimez ou pas) pour ajuster au mieux vos séances.\n\nCela prend 2 min, directement dans votre espace "
      + "(connexion en 1 clic) : " + lien + "\n\nMerci à vous 💛";
  },
  labelIntensiteBilan(v) {
    return { trop_facile: "Trop facile", adaptee: "Bien adaptée", trop_dure: "Un peu trop dure" }[v] || v || "—";
  },
  labelRecup(v) {
    return { bonne: "Bonne", moyenne: "Moyenne", difficile: "Difficile" }[v] || v || "—";
  },
  labelSeancesOk(v) {
    return { oui: "Oui, tout va bien", a_ajuster: "Ça va, à ajuster", non: "Non, pas trop" }[v] || v || "—";
  },
  labelFrequenceOk(v) {
    return { bonne: "Parfaite", trop: "Trop", pas_assez: "Pas assez" }[v] || v || "—";
  },

  // ---- Âge / IMC ----------------------------------------------------------
  age(dateNaissance) {
    if (!dateNaissance) return null;
    const d = this.parse(dateNaissance);
    if (!d) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a;
  },
  imc(poidsKg, tailleCm) {
    if (!poidsKg || !tailleCm) return null;
    const m = tailleCm / 100;
    return Math.round((poidsKg / (m * m)) * 10) / 10;
  },
  // Masse grasse estimée — méthode US Navy (femme), au mètre ruban, tout en cm.
  // Nécessite : tour de taille, tour de hanches, tour de cou et la taille (hauteur).
  // Renvoie un % arrondi à 0,1, ou null si une mesure manque / résultat aberrant.
  masseGrasseNavy(tourTaille, tourHanches, tourCou, tailleCm) {
    const w = Number(tourTaille), h = Number(tourHanches), n = Number(tourCou), ht = Number(tailleCm);
    if (!w || !h || !n || !ht) return null;
    const denom = w + h - n;
    if (denom <= 0) return null;
    const bf = 495 / (1.29579 - 0.35004 * Math.log10(denom) + 0.22100 * Math.log10(ht)) - 450;
    if (!isFinite(bf) || bf < 3 || bf > 65) return null;
    return Math.round(bf * 10) / 10;
  },
  // Dernier poids connu (dernier bilan avec poids, sinon dernière mensuration 'poids')
  dernierPoids(bilans, mensurations) {
    const b = (bilans || []).filter((x) => x.poids != null).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (b.length) return b[0].poids;
    const m = (mensurations || []).filter((x) => x.type === "poids").sort((a, b) => (a.date < b.date ? 1 : -1));
    return m.length ? m[0].valeur : null;
  },

  // ---- Paiements ----------------------------------------------------------
  paiementsStats(paiements, accompagnement) {
    const list = paiements || [];
    const total = list.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const dernier = list.length
      ? [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
      : null;
    const prix = accompagnement && accompagnement.prix != null ? Number(accompagnement.prix) : null;
    const reste = prix != null ? Math.round((prix - total) * 100) / 100 : null;
    return { total: Math.round(total * 100) / 100, dernier, prix, reste };
  },
  euro(n) {
    if (n == null) return "—";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  },

  // ---- Libellés -----------------------------------------------------------
  labelType(t) {
    return { presentiel: "Présentiel", distanciel: "Distanciel", hybride: "Hybride" }[t] || t;
  },
  labelStatut(s) {
    return {
      active: "Active", a_demarrer: "À démarrer", en_pause: "En pause",
      termine: "Terminé", a_renouveler: "À renouveler",
    }[s] || s;
  },

  // ---- Questionnaire de démarrage (le "premier bilan") --------------------
  // Reprend le Google Form d'accueil, version ludique : sections + choix (select) + emojis.
  // {section} = titre de section ; sinon {id, q, type?, options?}. Réponses en jsonb {id: valeur}.
  QI_V1: [
    { section:"🌿 Ton mode de vie" },
    { id:"entrainement_freq", q:"Combien de fois par semaine veux-tu t’entraîner ? 🗓️", type:"number" },
    { id:"age", q:"Quel âge as-tu ? 🎂", type:"number" },
    { id:"rythme_vie", q:"Ton rythme de vie actuel ?", type:"select", options:["Calme 😌","Variable 🔄","Rapide ⚡","Stressant 😰"] },
    { id:"travail_posture", q:"Au travail, tu es plutôt :", type:"select", options:["Assise la majorité du temps 🪑","Souvent debout 🧍","En mouvement (marche, déplacements) 🚶","Physiquement active (port de charges) 💪"] },
    { id:"journees", q:"Tes journées sont plutôt :", type:"select", options:["Régulières","Variables selon les jours"] },
    { id:"grossesses", q:"Grossesses ? (combien · rééducation périnéale · diastasis connu) 🤰", type:"textarea" },

    { section:"😴 Sommeil & énergie" },
    { id:"sommeil_heures", q:"Tu dors combien d’heures par nuit ? 🛏️" },
    { id:"reveil_fatigue", q:"Tu te réveilles fatiguée le matin ?", type:"select", options:["Oui","Non"] },
    { id:"sommeil_reparateur", q:"Ton sommeil est réparateur ?", type:"select", options:["Oui","Non"] },
    { id:"fatigue_soir", q:"Fatigue en fin de journée ? De quel type ?", type:"select", options:["Non, ça va","Physique 💪","Mentale / nerveuse 🧠","Les deux"] },
    { id:"fatigue_frequente", q:"Tu te sens souvent fatiguée / sans énergie ?", type:"select", options:["Oui","Non"] },
    { id:"energie_actuelle", q:"Ton niveau d’énergie actuel ? (1 à 10) ⚡", type:"number" },
    { id:"cafe", q:"Café / boissons énergisantes ? Combien par jour ? ☕" },

    { section:"🩺 Ta santé" },
    { id:"antecedents", q:"Antécédents médicaux importants à connaître ? 🩺", type:"textarea" },
    { id:"traitement", q:"Traitement ou suivi en cours ? Si oui, lequel ? 💊", type:"textarea" },
    { id:"douleurs_effort", q:"Déjà ressenti des gênes / douleurs à l’effort ?", type:"select", options:["Non","Oui"] },
    { id:"amenagements", q:"Besoin d’aménagements spécifiques en séance ?", type:"textarea" },
    { id:"tabac", q:"Tu fumes ? (depuis quand · combien par jour) 🚬" },
    { id:"alcool", q:"Et côté alcool ? (juste pour adapter mes conseils, aucun jugement 🙂)", type:"select", options:["Jamais","Rarement","De temps en temps","Régulièrement"] },
    { id:"complements", q:"Tu prends des compléments alimentaires ? Lesquels ?" },

    { section:"🍽️ Ta nutrition" },
    { id:"appetit", q:"Ton appétit est plutôt :", type:"select", options:["Stable","Variable","Parfois absent"] },
    { id:"envies", q:"Des envies de sucre / salé quand tu es fatiguée ?", type:"select", options:["Non","Oui, du sucre 🍫","Oui, du salé 🧀","Les deux"] },
    { id:"petit_dej", q:"Tu prends un petit-déjeuner ? 🍳", type:"select", options:["Oui","Non"] },
    { id:"petit_dej_quoi", q:"Si oui, quoi en général ?" },
    { id:"journee_repas", q:"Décris une journée type de repas 🍽️", type:"textarea" },
    { id:"grignotage", q:"Tu grignotes entre les repas ?", type:"select", options:["Non","Oui"] },
    { id:"regime", q:"Déjà testé une méthode / un régime alimentaire ?", type:"textarea" },

    { section:"🎯 Tes objectifs & ta motivation" },
    { id:"ressenti_corps", q:"Comment tu te sens dans ton corps en ce moment ? 💭", type:"textarea" },
    { id:"objectifs", q:"Tes objectifs principaux avec ce coaching ? 🎯", type:"textarea" },
    { id:"objectifs_pourquoi", q:"Pourquoi c’est important pour toi aujourd’hui ?", type:"textarea" },
    { id:"zone_prio", q:"Quelle zone du corps prioriser, pour quel objectif ?", type:"textarea" },
    { id:"court_terme", q:"Ce que tu aimerais constater à court terme ?", type:"textarea" },
    { id:"long_terme", q:"Ton grand objectif à long terme (forme / santé / résultats) ?", type:"textarea" },
    { id:"pourquoi_moi", q:"Qu’est-ce qui t’a donné envie de commencer avec moi ? 💬", type:"textarea" },
    { id:"motivation", q:"À quel point es-tu motivée à reprendre le sport ? (1 à 10) 🔥", type:"number" },
    { id:"freins", q:"Qu’est-ce qui t’a freinée jusqu’ici ?", type:"textarea" },
    { id:"attentes_coach", q:"Qu’attends-tu le plus de moi en tant que coach ?", type:"textarea" },
    { id:"evenement", q:"Un événement / une période qui te motive particulièrement ? 📅", type:"textarea" },
    { id:"sport_passe", q:"Déjà pratiqué une activité sportive ? Laquelle ? 🏃‍♀️", type:"textarea" },
    { id:"pref_seances", q:"Tu préfères des séances plutôt :", type:"select", options:["Douces et progressives 🌱","Dynamiques mais sans impact 💫","Intenses et challengeantes 🔥"] },

    { section:"📏 Tes mensurations de départ" },
    { id:"taille", q:"Taille (cm) 📏", type:"number" },
    { id:"poids", q:"Poids actuel (kg) ⚖️", type:"number" },
    { id:"tour_taille", q:"Tour de taille — le plus fin du ventre (cm)", type:"number" },
    { id:"tour_hanches", q:"Tour de hanches — os du bassin (cm)", type:"number" },
    { id:"tour_fesses", q:"Tour de fesses — point le plus bombé (cm)", type:"number" },
    { id:"tour_cuisse", q:"Tour de cuisse — 10 cm sous le pli fessier (cm)", type:"number" },
    { id:"tour_poitrine", q:"Tour de poitrine — avec dos (cm)", type:"number" },
    { id:"tour_dos", q:"Tour de dos — juste sous la poitrine (cm)", type:"number" },
    { id:"tour_bras", q:"Tour de bras — milieu du biceps détendu (cm)", type:"number" },
    { id:"photos_depart", q:"Tu veux m’envoyer tes photos de départ ? 📸", type:"select", options:["Oui 📸","Non","Plus tard","Sans montrer mon visage","Je ne sais pas encore"] },

    { section:"🏋️ Ton entraînement" },
    { id:"lieu_entrainement", q:"Tu t’entraînes :", type:"select", options:["À domicile 🏠","En salle 🏋️","Les deux"] },
    { id:"materiel", q:"Quel matériel as-tu ? (pour les programmes distanciels)", type:"textarea" },
    { id:"depuis_quand", q:"Depuis combien de temps tu t’entraînes ? (si tu t’entraînes)" },
    { id:"creneaux", q:"Tes jours / créneaux horaires préférés ? ⏰", type:"textarea" },
    { id:"retours_technique", q:"Prête à envoyer des retours (photos/vidéos) pour corriger ta technique ?", type:"select", options:["Oui","À voir","Non pour le moment"] },
    { id:"type_accompagnement", q:"Quel type d’accompagnement souhaites-tu ?", type:"select", options:["Coaching présentiel (à domicile)","Coaching hybride","Coaching à distance"] },
  ],

  // Questionnaire ALIMENTAIRE de départ (« bilan nutrition ») — rempli UNE FOIS,
  // séparé du questionnaire de démarrage. Objectif : allergies (à ne surtout pas
  // manquer), habitudes, goûts et contraintes pour un plan nutrition sur-mesure.
  QN_V1: [
    { section:"🎯 Ton objectif nutrition" },
    { id:"obj_nutrition", q:"Ton objectif principal côté alimentation ? 🎯", type:"select", options:["Perte de poids","Perdre du gras & me tonifier","Prise de muscle","Rééquilibrage & santé","Plus d’énergie au quotidien","Gérer une contrainte médicale"] },
    { id:"poids_actuel", q:"Ton poids actuel (kg) ⚖️", type:"number" },
    { id:"poids_objectif", q:"Ton poids qui te ferait te sentir bien (kg) ✨", type:"number" },

    { section:"🚫 Allergies & intolérances (important)" },
    { id:"allergies", q:"As-tu des allergies alimentaires ? ⚠️", type:"select", options:["Non, aucune","Oui (je précise juste en dessous)"] },
    { id:"allergies_detail", q:"Si oui, lesquelles ? (arachide, fruits à coque, œuf, lait, gluten, fruits de mer, soja…)", type:"textarea" },
    { id:"intolerances", q:"Des intolérances ?", type:"select", options:["Aucune","Lactose","Gluten","Plusieurs / autre (je précise)"] },
    { id:"intolerances_detail", q:"Précise ton intolérance si besoin", type:"text" },
    { id:"aliments_interdits", q:"Des aliments interdits pour raison médicale ou religieuse ? 🚫", type:"textarea" },

    { section:"🍽️ Tes habitudes alimentaires" },
    { id:"nb_repas", q:"Combien de repas par jour en général ?", type:"select", options:["1","2","3","4 et +","Ça varie"] },
    { id:"horaires_reguliers", q:"Tes horaires de repas sont plutôt :", type:"select", options:["Réguliers","Variables","Décalés (travail de nuit, etc.)"] },
    { id:"petit_dej_nutri", q:"Tu prends un petit-déjeuner ? 🍳", type:"select", options:["Oui, tous les jours","Parfois","Jamais"] },
    { id:"grignotage_nutri", q:"Tu grignotes entre les repas ?", type:"select", options:["Non","Parfois","Souvent","Surtout le soir 🌙"] },
    { id:"cuisine_maison", q:"Tu manges plutôt :", type:"select", options:["Cuisine maison","Un peu des deux","Plats préparés & livraison surtout"] },
    { id:"temps_cuisine", q:"Combien de temps tu peux consacrer à cuisiner ? ⏱️", type:"select", options:["J’ai le temps","Un peu","Très peu → il me faut rapide"] },
    { id:"budget_courses", q:"Ton budget courses est plutôt :", type:"select", options:["Serré","Moyen","Confortable"] },

    { section:"😋 Tes goûts" },
    { id:"aliments_aimes", q:"Les aliments que tu adores 😍", type:"textarea" },
    { id:"aliments_detestes", q:"Ceux que tu ne mangeras JAMAIS 🚫", type:"textarea" },
    { id:"legumes_ok", q:"Ton rapport aux légumes 🥦", type:"select", options:["J’adore","Quelques-uns seulement","Peu","Pas du tout"] },
    { id:"proteines_pref", q:"Tes sources de protéines préférées :", type:"select", options:["Viande","Poisson","Œufs","Végétal (tofu, légumineuses)","Un peu de tout"] },
    { id:"sucre_sale", q:"Tu es plutôt :", type:"select", options:["Sucré 🍫","Salé 🧀","Les deux"] },

    { section:"🥤 Boissons & alimentation actuelle" },
    { id:"regime_particulier", q:"Tu suis un régime particulier ?", type:"select", options:["Aucun","Végétarien","Végan","Sans porc","Halal","Casher","Autre (je précise)"] },
    { id:"regime_detail", q:"Précise ton régime si « autre »", type:"text" },
    { id:"eau_jour", q:"Tu bois combien d’eau par jour ? 💧", type:"select", options:["Moins de 0,5 L","~1 L","~1,5 L","2 L et +"] },
    { id:"boissons_sucrees", q:"Sodas / jus sucrés ?", type:"select", options:["Jamais","Parfois","Souvent"] },
    { id:"alcool_nutri", q:"Alcool 🍷", type:"select", options:["Jamais","Occasionnel","Régulier"] },
    { id:"fast_food", q:"Fast-food / à emporter ?", type:"select", options:["Jamais","~1 fois/semaine","Plusieurs fois/semaine"] },

    { section:"🩺 Digestion & santé" },
    { id:"digestion", q:"Ta digestion est plutôt :", type:"select", options:["Bonne","Ballonnements","Transit difficile","Variable"] },
    { id:"pathologies_nutri", q:"À prendre en compte : diabète, cholestérol, tension, thyroïde… ? 🩺", type:"textarea" },
    { id:"grossesse_allaitement", q:"Concernée en ce moment par :", type:"select", options:["Non concernée","Grossesse 🤰","Allaitement 🤱"] },
    { id:"complements_nutri", q:"Compléments alimentaires pris en ce moment ?", type:"text" },

    { section:"📅 Ton programme idéal" },
    { id:"nb_repas_souhaite", q:"Tu préfères un plan à :", type:"select", options:["3 repas","3 repas + 1 collation","2 repas","Peu importe, à toi de voir"] },
    { id:"snacks_ok", q:"Les collations, tu en veux ?", type:"select", options:["Oui j’aime les collations","Non merci"] },
    { id:"recettes", q:"Côté recettes :", type:"select", options:["Oui, donne-moi des idées recettes","Juste des repères simples"] },
    { id:"contraintes_nutri", q:"Contraintes à connaître ? (travail décalé, déplacements, cantine, famille…) 📌", type:"textarea" },
  ],

  // ==========================================================================
  // QUESTIONNAIRE V2 (oct. 2026) — UN SEUL questionnaire de démarrage, par étapes,
  // surtout des cases à cocher, qui S'ADAPTE à la cliente (Calc.qiItems) :
  //   QI = tronc commun (toutes) + QE si elle s'entraîne seule + QN si nutrition.
  // Tout est enregistré dans questionnaire_initial ; la partie nutrition est AUSSI
  // copiée dans questionnaire_nutrition (le plan nutrition s'appuie dessus).
  // QN reste utilisable seul si la nutrition est prise plus tard.
  // Ids utilisés ailleurs CONSERVÉS : objectifs, objectifs_pourquoi, taille, poids, tour_*.
  // Anciennes réponses (V1) toujours lisibles : voir Calc.qRows().
  // ==========================================================================
  QI: [
    { section:"👋 Faisons connaissance", intro:"Quelques questions rapides, surtout à cocher. Tu peux t’arrêter et reprendre plus tard : tout est sauvegardé." },
    { id:"sexe", q:"Tu es :", hint:"Pour les calculs (besoins caloriques)", type:"choice", req:true, options:["Une femme","Un homme"] },
    { id:"age", q:"Quel âge as-tu ? 🎂", type:"number", req:true },
    { id:"rythme_vie", q:"Ton rythme de vie en ce moment ?", type:"choice", options:["Calme 😌","Variable 🔄","Rapide ⚡","Stressant 😰"] },
    { id:"travail_posture", q:"Dans ta journée, tu es plutôt :", type:"choice", options:["Assise 🪑","Debout 🧍","En mouvement 🚶","Physique (port de charges) 💪","Ça dépend des jours"] },
    { id:"pas_jour", q:"Combien de pas par jour, environ ? 🚶‍♀️", hint:"Regarde ton téléphone ou ta montre si tu peux", type:"choice", options:["Moins de 5 000","5 000 à 8 000","8 000 à 10 000","Plus de 10 000","Je ne sais pas"] },
    { id:"entrainement_freq", q:"Combien de séances par semaine te paraît réaliste ? 🗓️", type:"choice", options:["1","2","3","4","5 et +"] },
    { id:"creneaux", q:"Tes créneaux préférés ⏰", hint:"Plusieurs choix possibles", type:"multi", options:["Tôt le matin","Matinée","Midi","Après-midi","Soir","Week-end"] },

    { section:"🩺 Ton corps & ta santé", intro:"Uniquement ce qui m’aide à adapter tes séances et à ne jamais te blesser. Tu réponds seulement à ce que tu veux." },
    { id:"douleurs_zones", q:"As-tu des douleurs ou des zones fragiles ?", type:"multi", req:true, options:["Aucune","Bas du dos","Haut du dos / nuque","Épaules","Genoux","Hanches","Poignets","Chevilles"] },
    { id:"douleurs_detail", q:"Dis-m’en un peu plus 🩹", hint:"Depuis quand ? Quels mouvements te font mal ? Un diagnostic (hernie, tendinite…) ?", type:"textarea", ph:"ex. bas du dos depuis 2 ans, ça tire quand je me penche en avant", show:{ id:"douleurs_zones", not:["Aucune"] } },
    { id:"antecedents", q:"Quelque chose qui peut jouer sur l’effort ?", type:"multi", other:true, options:["Rien de particulier","Tension","Asthme","Problème cardiaque","Diabète","Thyroïde","Opération il y a moins d’1 an","Vertiges / malaises"] },
    { id:"traitement", q:"Un traitement qui peut jouer sur l’effort ? (facultatif) 💊", type:"text", ph:"ex. bêtabloquant, Ventoline…" },
    { id:"complements", q:"Tu prends des compléments ? (facultatif)", type:"text", ph:"ex. fer, magnésium, protéines, créatine…" },
    { id:"grossesses", q:"Tu as eu des enfants ? 👶", type:"choice", options:["Non","Oui, 1","Oui, 2","Oui, 3 et +","Je suis enceinte"] },
    { id:"postpartum", q:"Pour protéger ton ventre et ton périnée, tu es concernée par :", hint:"Seulement si tu es à l’aise d’en parler", type:"multi", show:{ id:"grossesses", is:["Oui, 1","Oui, 2","Oui, 3 et +"] }, options:["Rien de particulier","Bébé de moins d’1 an","Rééducation du périnée faite","Rééducation pas faite","Diastasis (écart des abdos)","Petites fuites à l’effort","Césarienne"] },
    { id:"tabac", q:"Tu fumes ? 🚬", type:"choice", options:["Non","Un peu","Oui, régulièrement","J’ai arrêté"] },
    { id:"alcool", q:"L’alcool, c’est plutôt : (aucun jugement 🙂)", type:"choice", options:["Jamais","Rarement","Le week-end","Régulièrement"] },

    { section:"😴 Sommeil, énergie & habitudes" },
    { id:"sommeil_heures", q:"Tu dors combien d’heures par nuit ? 🛏️", type:"choice", options:["Moins de 5 h","5–6 h","6–7 h","7–8 h","Plus de 8 h"] },
    { id:"sommeil_reparateur", q:"Ton sommeil est réparateur ?", type:"choice", options:["Oui","Moyen","Non"] },
    { id:"energie_actuelle", q:"Ton niveau d’énergie au quotidien ⚡", type:"scale", lo:"à plat", hi:"au top" },
    { id:"stress", q:"Ton niveau de stress 😮‍💨", type:"scale", lo:"zen", hi:"débordée" },
    { id:"grignotage", q:"Tu grignotes entre les repas ?", type:"choice", options:["Non","Parfois","Souvent","Surtout le soir 🌙"] },
    { id:"envies", q:"Des envies quand tu es fatiguée ?", type:"choice", options:["Non","Sucré 🍫","Salé 🧀","Les deux"] },

    { section:"🎯 Tes objectifs" },
    { id:"objectifs", q:"Qu’est-ce que tu veux changer ? 🎯", hint:"Coche tout ce qui compte pour toi", type:"multi", req:true, other:true, options:["Perdre du poids","Ventre plus plat","Fessiers galbés","Me tonifier","Prendre du muscle","Retrouver mon corps après bébé","Plus d’énergie","Soulager mon dos / mes douleurs","Reprendre confiance en moi"] },
    { id:"ressenti_corps", q:"Comment tu te sens dans ton corps en ce moment ? 💭", type:"textarea", ph:"Avec tes mots, il n’y a pas de mauvaise réponse" },
    { id:"objectifs_pourquoi", q:"Pourquoi c’est important pour toi aujourd’hui ?", type:"textarea", ph:"C’est ce qui m’aidera le plus à te motiver les jours difficiles" },
    { id:"evenement", q:"Un événement qui te motive ? 📅 (facultatif)", type:"text", ph:"mariage, vacances, anniversaire…" },
    { id:"motivation", q:"Ta motivation en ce moment 🔥", type:"scale", lo:"bof", hi:"à fond" },
    { id:"freins", q:"Qu’est-ce qui t’a freinée jusqu’ici ?", type:"multi", options:["Le manque de temps","La motivation qui retombe","Je ne savais pas quoi faire","Les enfants / la famille","La fatigue","Des douleurs","Pas de résultats","Le budget"] },
    { id:"attentes_coach", q:"Ce que tu attends le plus de moi 💬", type:"multi", options:["Un programme clair","Être motivée et suivie","Corriger ma technique","Des conseils nutrition","Ne pas me blesser","Des résultats visibles"] },
    { id:"sport_passe", q:"Le sport et toi, jusqu’ici :", type:"choice", options:["Jamais vraiment","Il y a longtemps","De temps en temps","Régulièrement"] },
    { id:"deja_essaye", q:"Qu’as-tu déjà essayé, et pourquoi ça n’a pas marché ? (facultatif)", type:"textarea", ph:"ex. salle de sport abandonnée au bout de 2 mois, régime trop strict…" },
    { id:"pourquoi_moi", q:"Qu’est-ce qui t’a donné envie de commencer avec moi ? 💬 (facultatif)", type:"textarea" },
    { id:"pref_seances", q:"Tu préfères des séances plutôt :", type:"choice", options:["Douces et progressives 🌱","Dynamiques sans sauts 💫","Intenses et challengeantes 🔥"] },

    { section:"📏 Tes mensurations de départ", intro:"Taille et poids sont indispensables pour calculer tes besoins. Pour les tours : mètre ruban, le matin à jeun si possible. Pas de mètre ? Laisse vide, on les prendra ensemble." },
    { id:"taille", q:"Taille (cm) 📏", type:"number", req:true },
    { id:"poids", q:"Poids actuel (kg) ⚖️", type:"number", req:true },
    { id:"tour_taille", q:"Tour de taille (cm)", hint:"Au plus fin du ventre", type:"number" },
    { id:"tour_hanches", q:"Tour de hanches (cm)", hint:"Au niveau des os du bassin", type:"number" },
    { id:"tour_fesses", q:"Tour de fesses (cm)", hint:"Au point le plus bombé", type:"number" },
    { id:"tour_cuisse", q:"Tour de cuisse (cm)", hint:"10 cm sous le pli de la fesse", type:"number" },
    { id:"tour_bras", q:"Tour de bras (cm)", hint:"Milieu du bras, détendu", type:"number" },
    { id:"tour_cou", q:"Tour de cou (cm) ⭐", hint:"Indispensable pour calculer ta masse grasse. Juste sous la pomme d’Adam, mètre bien horizontal.", type:"number" },
    { id:"tour_poitrine", q:"Tour de poitrine (cm)", hint:"Avec le dos, au plus fort de la poitrine", type:"number" },
    { id:"tour_dos", q:"Tour sous la poitrine (cm)", hint:"Juste sous la poitrine", type:"number" },
    { id:"photos_depart", q:"Tu veux m’envoyer tes photos de départ ? 📸", type:"choice", options:["Oui","Sans mon visage","Plus tard","Non"] },
  ],

  // Partie ENTRAÎNEMENT — ajoutée au questionnaire si elle s'entraîne SEULE.
  QE: [
    { section:"🏠 Où et quand tu t’entraînes", intro:"Pour construire un programme que tu peux vraiment faire, chez toi ou en salle." },
    { id:"lieu_entrainement", q:"Tu vas t’entraîner :", type:"choice", req:true, options:["À la maison 🏠","En salle 🏋️","Dehors 🌳","Un peu de tout"] },
    { id:"salle", q:"Quelle salle ? (facultatif)", type:"text", ph:"ex. Basic-Fit Massy", show:{ id:"lieu_entrainement", is:["En salle 🏋️","Un peu de tout"] } },
    { id:"jours_semaine", q:"Combien de séances seule par semaine ?", type:"choice", req:true, options:["2","3","4","5 et +"] },
    { id:"duree_seance", q:"Combien de temps par séance ? ⏱️", type:"choice", req:true, options:["20 min","30 min","45 min","1 h et +"] },
    { id:"moment", q:"Plutôt à quel moment ?", type:"choice", options:["Matin","Midi","Soir","Ça varie"] },
    { id:"contraintes_maison", q:"Des contraintes à la maison ?", type:"multi", show:{ id:"lieu_entrainement", is:["À la maison 🏠","Un peu de tout"] }, options:["Aucune","Pas de sauts (voisins, bruit)","Peu de place","Les enfants autour","Pas de matériel du tout"] },

    { section:"🏋️ Ton matériel" },
    { id:"materiel", q:"Ce que tu as à disposition", hint:"Coche tout ce que tu as", type:"multi", req:true, other:true, options:["Rien (poids du corps)","Tapis","Élastiques / bandes","Mini-bands","Haltères","Kettlebell","Barre + disques","Banc","Swiss ball","Corde à sauter","Step / box","Barre de traction","Vélo / tapis de course / rameur"] },
    { id:"poids_charges", q:"Quels poids pour tes haltères / kettlebell ?", type:"text", ph:"ex. 2 × 4 kg, kettlebell 8 kg", show:{ id:"materiel", is:["Haltères","Kettlebell","Barre + disques"] } },
    { id:"machines_salle", q:"En salle, tu sais utiliser :", type:"multi", show:{ id:"lieu_entrainement", is:["En salle 🏋️","Un peu de tout"] }, options:["Presse à cuisses","Machine à fessiers / hip thrust","Poulies","Smith machine","Leg curl / leg extension","Rack + barre","Cardio (tapis, vélo, elliptique)","Pas encore les machines"] },

    { section:"📈 Ton niveau" },
    { id:"niveau", q:"Tu dirais que tu es :", type:"choice", req:true, options:["Débutante (je commence ou je reprends)","Intermédiaire (je m’entraîne un peu)","Confirmée (régulière depuis 1 an et +)"] },
    { id:"exos_maitrises", q:"Les exercices que tu sais déjà faire ✅", type:"multi", options:["Squat","Fentes","Pont fessier / hip thrust","Soulevé de terre","Pompes (même sur les genoux)","Gainage / planche","Rowing","Développé épaules","Burpees","Aucun pour l’instant"] },
    { id:"exos_difficiles", q:"Ce qui est difficile ou inconfortable pour toi 😬", type:"multi", other:true, options:["Rien de particulier","Les pompes","Le squat (genoux, équilibre)","Les fentes","Le gainage","Les sauts / burpees","Les abdos (la nuque tire)","Les tractions","Rester longtemps au sol"] },
    { id:"cardio", q:"Ton cardio :", type:"choice", options:["Je m’essouffle vite","Ça va","J’ai une bonne endurance"] },
    { id:"seance_marquante", q:"Une séance ou un sport que tu as adoré… ou détesté ? Pourquoi ? (facultatif)", type:"textarea" },

    { section:"💛 Ce que tu aimes & ton suivi" },
    { id:"aime", q:"Ce que tu aimes faire 😍", type:"multi", options:["Le renforcement musculaire","Le cardio / HIIT","Les circuits rapides","Pilates / gainage","Soulever lourd","Les séances courtes et efficaces","Varier souvent"] },
    { id:"aime_pas", q:"Ce que tu n’aimes pas 🙅‍♀️", type:"multi", options:["Rien, je suis ouverte","Les sauts","Le cardio","Les abdos","Les pompes","Les séances longues","Les exercices au sol"] },
    { id:"zones_prio", q:"Les zones à travailler en priorité 🎯", type:"multi", options:["Ventre","Fessiers","Cuisses","Bras","Dos / posture","Silhouette globale"] },

    { id:"videos_ok", q:"Tu pourras m’envoyer des vidéos de tes exercices pour que je corrige ta technique ?", type:"choice", options:["Oui 👍","De temps en temps","Pas pour le moment"] },
    { id:"commentaire", q:"Autre chose à me dire ? (facultatif)", type:"textarea" },
  ],

  QN: [
    { section:"🎯 Ton objectif", intro:"Pour un plan nutrition 100 % à ton goût, sans régime frustrant." },
    { id:"obj_nutrition", q:"Ton objectif côté alimentation 🎯", type:"choice", req:true, options:["Perte de poids","Perdre du gras & me tonifier","Prise de muscle","Rééquilibrage & santé","Plus d’énergie","Gérer une contrainte médicale"] },
    { id:"poids_actuel", q:"Ton poids actuel (kg) ⚖️", type:"number" },
    { id:"poids_objectif", q:"Le poids où tu te sentirais bien (kg, facultatif) ✨", type:"number" },

    { section:"⚠️ Allergies & intolérances", intro:"Très important : je ne mettrai jamais ces aliments dans ton plan." },
    { id:"allergies", q:"Allergies alimentaires", type:"multi", req:true, other:true, options:["Aucune","Arachide","Fruits à coque","Œuf","Lait","Gluten","Poisson / fruits de mer","Soja","Sésame"] },
    { id:"intolerances", q:"Intolérances", type:"multi", req:true, other:true, options:["Aucune","Lactose","Gluten","FODMAP / fructose"] },
    { id:"regime_particulier", q:"Tu manges :", type:"multi", other:true, options:["De tout","Sans porc","Halal","Casher","Végétarien","Végan","Sans viande rouge"] },

    { section:"🍽️ Tes habitudes" },
    { id:"nb_repas", q:"Combien de repas par jour ?", type:"choice", options:["1","2","3","4 et +","Ça varie"] },
    { id:"petit_dej_nutri", q:"Le petit-déjeuner 🍳", type:"choice", options:["Tous les jours","Parfois","Jamais"] },
    { id:"horaires_reguliers", q:"Tes horaires de repas :", type:"choice", options:["Réguliers","Variables","Décalés (travail de nuit…)"] },
    { id:"grignotage_nutri", q:"Le grignotage :", type:"choice", options:["Non","Parfois","Souvent","Surtout le soir 🌙"] },
    { id:"cuisine_maison", q:"Tu manges plutôt :", type:"choice", options:["Fait maison","Un peu des deux","Plats préparés / livraison"] },
    { id:"temps_cuisine", q:"Temps pour cuisiner ⏱️", type:"choice", options:["J’ai le temps","Un peu","Très peu, il me faut du rapide"] },
    { id:"budget_courses", q:"Budget courses", type:"choice", options:["Serré","Moyen","Confortable"] },
    { id:"journee_repas", q:"Décris-moi une journée type de repas 🍽️", hint:"Ce que tu manges vraiment, pas ce que tu « devrais » manger 😉", type:"textarea", ph:"Matin : café + tartines · Midi : sandwich · 16 h : biscuits · Soir : pâtes…" },

    { section:"😋 Tes goûts & boissons" },
    { id:"proteines_pref", q:"Tes protéines préférées", type:"multi", options:["Poulet / dinde","Bœuf","Poisson","Thon / sardines","Œufs","Fromage blanc / skyr","Tofu","Lentilles / pois chiches"] },
    { id:"feculents_pref", q:"Tes féculents préférés", type:"multi", options:["Riz","Pâtes","Pommes de terre","Patate douce","Pain","Quinoa / boulgour","Semoule","Légumineuses"] },
    { id:"legumes_ok", q:"Les légumes et toi 🥦", type:"choice", options:["J’adore","Quelques-uns seulement","Peu","Pas du tout"] },
    { id:"sucre_sale", q:"Tu es plutôt :", type:"choice", options:["Sucré 🍫","Salé 🧀","Les deux"] },
    { id:"aliments_detestes", q:"Les aliments que tu ne mangeras JAMAIS 🚫", type:"text", ph:"ex. champignons, brocolis…" },
    { id:"aliments_aimes", q:"Tes plats ou aliments préférés 😍 (facultatif)", type:"text" },

    { id:"eau_jour", q:"L’eau, par jour 💧", type:"choice", options:["Moins de 0,5 L","~1 L","~1,5 L","2 L et +"] },
    { id:"boissons_sucrees", q:"Sodas / jus sucrés", type:"choice", options:["Jamais","Parfois","Souvent"] },
    { id:"alcool_nutri", q:"Alcool 🍷", type:"choice", options:["Jamais","Occasionnel","Régulier"] },
    { id:"fast_food", q:"Fast-food / à emporter", type:"choice", options:["Jamais","~1 fois / semaine","Plusieurs fois / semaine"] },

    { section:"🩺 Digestion & santé" },
    { id:"digestion", q:"Ta digestion", type:"multi", options:["Bonne","Ballonnements","Constipation","Transit rapide","Reflux / brûlures"] },
    { id:"pathologies_nutri", q:"À prendre en compte", type:"multi", other:true, options:["Rien","Diabète","Cholestérol","Tension","Thyroïde","SOPK","Anémie / carences"] },
    { id:"grossesse_allaitement", q:"En ce moment :", hint:"Tes besoins ne sont pas les mêmes", type:"choice", options:["Non concernée","Grossesse 🤰","Allaitement 🤱"] },

    { section:"📅 Ton plan idéal" },
    { id:"nb_repas_souhaite", q:"Tu préfères un plan à :", type:"choice", options:["3 repas","3 repas + 1 collation","2 repas","À toi de voir"] },
    { id:"recettes", q:"Côté recettes :", type:"choice", options:["Donne-moi des idées recettes","Juste des repères simples"] },
    { id:"contraintes_nutri", q:"Tes contraintes 📌", type:"multi", other:true, options:["Aucune","Repas au travail / cantine","Horaires décalés","Je cuisine pour la famille","Déplacements fréquents","Souvent au restaurant"] },
  ],

  // Construit LE questionnaire adapté à la cliente (un seul pour elle, une seule fiche pour la coach).
  //   opts.qe → ajoute la partie entraînement · opts.qn → ajoute la partie nutrition
  qiItems(opts) {
    opts = opts || {};
    let items = this.QI.slice();
    if (opts.qe) items = items.concat(this.QE);
    if (opts.qn) items = items.concat(this.QN.filter((it) => it.id !== "poids_actuel"));  // poids déjà demandé
    return items;
  },
  // Qui reçoit la partie ENTRAÎNEMENT ? Toutes celles qui s'entraînent SEULES :
  // distanciel, hybride, ou présentiel avec un programme en plus des séances
  // (programme sportif déjà créé, ou formule qui mentionne programme / boost / autonomie).
  needsQE(cl, ac, programmes) {
    const t = cl && cl.type;
    if (t === "distanciel" || t === "hybride") return true;
    if ((programmes || []).some((p) => p.kind === "sportif")) return true;
    return /programme|boost|autonom/i.test(String((ac && ac.formule) || ""));
  },
  // Lignes à afficher (coach / cliente) : questions actuelles + anciennes réponses V1
  // encore présentes (jamais de donnée cachée). kind : "QI" | "QE" | "QN".
  qRows(kind, reponses) {
    const rep = reponses || {};
    // Le questionnaire de démarrage peut contenir les parties entraînement + nutrition.
    const cur = kind === "QI" ? this.QI.concat(this.QE, this.QN) : (this[kind] || []);
    const legacy = this[kind + "_V1"] || [];
    const out = []; const seen = {};
    cur.forEach((it) => {
      if (it.section) { out.push({ section: it.section }); return; }
      if (!it.id) return;
      seen[it.id] = 1;
      const v = rep[it.id];
      if (v == null || String(v).trim() === "") return;
      out.push({ id: it.id, q: it.q, val: String(v) });
    });
    const extra = [];
    legacy.forEach((it) => {
      if (!it.id || seen[it.id]) return;
      seen[it.id] = 1;
      const v = rep[it.id];
      if (v == null || String(v).trim() === "") return;
      extra.push({ id: it.id, q: it.q, val: String(v) });
    });
    Object.keys(rep).forEach((k) => { if (!seen[k] && rep[k] != null && String(rep[k]).trim() !== "") extra.push({ id: k, q: k.replace(/_/g, " "), val: String(rep[k]) }); });
    if (extra.length) { out.push({ section: "📎 Autres réponses" }); out.push.apply(out, extra); }
    // Retire les titres de section sans réponse en dessous.
    return out.filter((r, i) => !r.section || (out[i + 1] && !out[i + 1].section));
  },
  // Points d'attention à mettre en avant côté coach (allergies, douleurs, santé).
  qAlertes(reponses) {
    const r = reponses || {}; const out = [];
    const neg = /^(aucune?|rien|non|rien de particulier|de tout)$/i;
    const pick = (id, label, icon) => {
      const v = r[id]; if (v == null || String(v).trim() === "") return;
      const items = String(v).split(/,\s*/).filter((x) => x && !neg.test(x.trim()));
      if (items.length) out.push({ icon, label, val: items.join(", ") });
    };
    pick("allergies", "Allergies", "⚠️"); pick("allergies_detail", "Allergies", "⚠️");
    pick("intolerances", "Intolérances", "⚠️");
    pick("douleurs_zones", "Douleurs / zones fragiles", "🚨"); pick("exos_difficiles", "Difficile pour elle", "😬");
    pick("antecedents", "Santé", "🩺"); pick("pathologies_nutri", "Santé", "🩺"); pick("postpartum", "Post-partum", "🤱");
    pick("douleurs_detail", "Précisions douleurs", "🩹"); pick("traitement", "Traitement", "💊");
    if (r.grossesses === "Enceinte actuellement" || r.grossesses === "Je suis enceinte" || /Grossesse/.test(r.grossesse_allaitement || "")) out.push({ icon: "🤰", label: "Enceinte", val: "à adapter" });
    return out;
  },
};
