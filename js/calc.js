// ============================================================================
// calc.js — calculs dérivés (jamais stockés) + formatage.
// ============================================================================
window.Calc = {
  // ---- Dates --------------------------------------------------------------
  today() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
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
    const realisees = (seances || []).filter((s) => s.statut === "realisee").length;
    const restantes = Math.max(0, prevues - realisees);
    const pct = prevues > 0 ? Math.round((realisees / prevues) * 100) : 0;
    return { prevues, realisees, restantes, pct };
  },

  // ---- Bilans -------------------------------------------------------------
  // dernier bilan = date la plus récente ; prochain = dernier + 28 jours.
  bilanStats(bilans) {
    if (!bilans || !bilans.length) return { dernier: null, prochain: null, joursAvant: null };
    const trie = [...bilans].sort((a, b) => (a.date < b.date ? 1 : -1));
    const dernier = trie[0].date;
    const dt = this.parse(dernier);
    dt.setDate(dt.getDate() + 28);
    const prochain = dt.toISOString().slice(0, 10);
    return { dernier, prochain, joursAvant: this.daysFromToday(prochain) };
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
    const besoinSport = type === "distanciel" || type === "hybride";
    const sportEnvoye = (c.programmes || []).some((p) => p.kind === "sportif" && p.envoye);
    const nutEnvoye = (c.programmes || []).some((p) => p.kind === "nutrition" && p.envoye);
    const aEnvoyer = (besoinSport && !sportEnvoye) || (nutritionActive && !nutEnvoye);
    if (c.cliente && c.cliente.statut === "active" && aEnvoyer) {
      out.push({ type: "programme", label: "Programme à envoyer", icon: "📤" });
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
