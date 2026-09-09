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

  // ---- Bilans -------------------------------------------------------------
  // dernier bilan = date la plus récente ; prochain = dernier + 28 jours.
  // dernier bilan = date la plus récente ; prochain = dernier + 28 j.
  // Si aucun bilan encore : le prochain se base sur la date de début (+28 j),
  // pour qu'une cliente qui démarre ait quand même une date de prochain bilan.
  bilanStats(bilans, dateDebut) {
    const has = bilans && bilans.length;
    const dernier = has ? [...bilans].sort((a, b) => (a.date < b.date ? 1 : -1))[0].date : null;
    const ancre = dernier || dateDebut || null;
    if (!ancre) return { dernier, prochain: null, joursAvant: null };
    const dt = this.parse(ancre);
    dt.setDate(dt.getDate() + 28);
    const prochain = this.ymd(dt); // heure locale (pas d'UTC → pas de décalage)
    return { dernier, prochain, joursAvant: this.daysFromToday(prochain) };
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

  // ---- Alertes (dashboard) ------------------------------------------------
  // Renvoie la liste d'alertes pour une cliente { dossier léger }.
  alertes(c) {
    const out = [];
    // Bilan rempli par la cliente récemment (≤ 10 j) → à consulter.
    const nouveauBilan = (c.bilans || []).some((x) =>
      x.saisi_par === "cliente" && x.created_at &&
      this.daysFromToday(String(x.created_at).slice(0, 10)) >= -10);
    if (nouveauBilan) out.push({ type: "nouveau_bilan", label: "Nouveau bilan rempli", icon: "🆕" });
    const b = this.bilanStats(c.bilans);
    if (b.joursAvant !== null && b.joursAvant <= 3) {
      out.push({ type: "bilan", label: b.joursAvant < 0 ? "Bilan en retard" : "Bilan à faire", icon: "🔔" });
    }
    const s = this.seancesStats(c.accompagnement, c.seances);
    if (s.prevues > 0 && s.restantes <= 2) {
      out.push({ type: "seances", label: "Séances presque finies", icon: "🏋️" });
    }
    // Point 7 — « prévoir des séances » : il reste beaucoup de séances au forfait
    // (> 2) mais très peu sont réellement programmées à venir (≤ 2). Uniquement pour
    // les accompagnements avec RDV en personne (présentiel / hybride) ; les distancielles
    // n'ont pas de séances programmées (cf. bloc « Sans séance programmée »).
    if (c.cliente && c.cliente.statut === "active") {
      const avecRdv = c.cliente.type === "presentiel" || c.cliente.type === "hybride";
      const today = this.today();
      const programmees = (c.seances || []).filter(x => x.statut === "prevue" && x.date && x.date >= today).length;
      if (avecRdv && s.restantes > 2 && programmees <= 2) {
        out.push({ type: "prevoir_seances", label: "Prévoir des séances", icon: "🗓️" });
      }
    }
    // NB : le bilan de démarrage n'est PAS une alerte automatique — c'est Ornella
    // qui choisit de l'envoyer via le bouton sur la fiche (pas de notif imposée).
    const suivi = this.suiviStats(c.accompagnement);
    if (suivi.joursRestants !== null && suivi.joursRestants <= 14 && suivi.joursRestants >= 0) {
      out.push({ type: "fin", label: "Suivi bientôt terminé", icon: "⏳" });
    }
    if (c.cliente && c.cliente.statut === "a_renouveler") {
      out.push({ type: "renouveler", label: "À renouveler", icon: "🔁" });
    }
    // Programme à envoyer — UNIQUEMENT pour les clientes qui en reçoivent un :
    //   • distanciel / hybride  → programme sportif à envoyer
    //   • nutrition active       → programme nutrition à envoyer
    // Une cliente présentiel (sans nutrition) est coachée en personne : rien à envoyer.
    const type = c.cliente && c.cliente.type;
    const nutritionActive = c.accompagnement && c.accompagnement.nutrition_active;
    const active = c.cliente && c.cliente.statut === "active";
    const besoinSport = type === "distanciel" || type === "hybride";
    const sportEnvoye = (c.programmes || []).some((p) => p.kind === "sportif" && p.envoye);
    if (active && besoinSport && !sportEnvoye) {
      out.push({ type: "programme", label: "Programme sportif à envoyer", icon: "📤" });
    }
    // Nutrition MENSUELLE : rappel ~1 mois après le dernier programme nutrition envoyé
    // (ex. Monya). S'il n'y en a jamais eu → rappel d'envoyer le 1er.
    if (active && nutritionActive) {
      const dates = (c.programmes || [])
        .filter((p) => p.kind === "nutrition")
        .map((p) => p.date_envoi || (p.created_at ? String(p.created_at).slice(0, 10) : null))
        .filter(Boolean)
        .sort();
      if (!dates.length) {
        out.push({ type: "programme", label: "1er programme nutrition à envoyer", icon: "🥗" });
      } else {
        const prochain = this.dateFin(dates[dates.length - 1], 1); // dernier envoi + 1 mois
        const jr = this.daysFromToday(prochain);
        if (jr !== null && jr <= 3) {
          out.push({ type: "nutrition_mensuelle", label: "Programme nutrition du mois à renvoyer", icon: "🥗" });
        }
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
  // Déclenche le téléchargement/ouverture du .ics (iOS ouvre l'app Calendrier).
  downloadSeanceICS(cl, s) {
    const text = this.seanceICS(cl, s);
    const nom = (cl.prenom || "seance").normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "seance";
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "seance-" + nom + "-" + (s.date || "") + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  },

  // ---- Bilan de démarrage (ressenti des premières séances) ----------------
  // Seuil : proposé à la coach dès que la cliente atteint ce nb de séances réalisées.
  // 1 = dès la 1re séance faite (le ressenti des tout débuts est le plus utile).
  SEUIL_BILAN_DEMARRAGE: 1,
  // À demander ? (>= seuil séances réalisées ET aucun bilan de démarrage déjà rempli)
  bilanDemarrageDue(accompagnement, seances, bilansDemarrage) {
    if (bilansDemarrage && bilansDemarrage.length) return false;
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
};
