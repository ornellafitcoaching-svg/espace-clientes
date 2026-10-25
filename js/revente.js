// ============================================================================
// revente.js — Onglet « Achat-revente » de l'espace coach.
// Suivi des achats/reventes (type Vinted) : saisie rapide, stock, ventes, stats.
// Réutilise le client Supabase partagé (window.sb), DB, Calc, UI. Aucune dépendance.
//
// Table : public.achats_revente (RLS is_coach()).
//   Colonnes ÉCRITES : titre*, marque, categorie, taille, etat, source, compte,
//     date_achat, prix_achat (port inclus), prix_vise,
//     statut ('stock'|'enligne'|'vendu'|'invendable'),
//     date_mise_en_ligne, date_vente, prix_vente, frais_vente, notes.
//   Colonnes CALCULÉES par la base (JAMAIS écrites) : marge, jours_vente.
// ============================================================================
(function () {
  "use strict";

  var esc = function (s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  };
  var euro = function (n) { return window.Calc ? Calc.euro(Number(n) || 0) : (Math.round((Number(n) || 0) * 100) / 100) + " €"; };
  var num = function (v) { if (v === "" || v == null) return null; var n = Number(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
  var today = function () { return window.Calc ? Calc.today() : new Date().toISOString().slice(0, 10); };
  var pct = function (n) { return (Math.round((Number(n) || 0) * 10) / 10).toString().replace(".", ",") + " %"; };
  // Jours entre deux dates ISO (positif si d2 après d1).
  var daysBetween = function (d1, d2) {
    if (!d1 || !d2) return 0;
    if (window.Calc && Calc.daysBetween) return Calc.daysBetween(d1, d2);
    return Math.round((new Date(d2) - new Date(d1)) / 86400000);
  };

  var ETATS = ["Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état", "Satisfaisant"];

  var RV = {
    rows: [],
    view: "stock",        // 'stock' | 'ventes' | 'stats'
    ventesFilter: "all",  // 'all' | 'mois' | '30j'
    loaded: false,
    loading: false,
    err: null,
    wired: false,
  };

  // ---- Données -------------------------------------------------------------
  RV.fetch = async function () {
    RV.loading = true; RV.err = null;
    try {
      var res = await window.withTimeout(
        window.sb.from("achats_revente").select("*").order("date_achat", { ascending: false }),
        15000, "Chargement achat-revente"
      );
      if (res.error) throw res.error;
      RV.rows = res.data || [];
      RV.loaded = true;
    } catch (e) {
      RV.err = (window.UI && UI.errText) ? UI.errText(e) : (e && e.message) || "Erreur de chargement";
      console.error("revente fetch", e);
    } finally {
      RV.loading = false;
    }
  };

  // Marge nette d'une pièce vendue (préférer la valeur calculée par la base).
  function margeOf(r) {
    if (r.marge != null && r.marge !== "") return Number(r.marge);
    if (r.statut === "vendu" && r.prix_vente != null)
      return (Number(r.prix_vente) || 0) - (Number(r.prix_achat) || 0) - (Number(r.frais_vente) || 0);
    return null;
  }
  // Jours écoulés pour vendre (préférer la valeur calculée par la base).
  function joursVenteOf(r) {
    if (r.jours_vente != null && r.jours_vente !== "") return Number(r.jours_vente);
    if (r.statut === "vendu" && r.date_achat && r.date_vente) return daysBetween(r.date_achat, r.date_vente);
    return null;
  }
  // Depuis combien de jours une pièce « dort » (en stock / en ligne).
  function joursDort(r) {
    var ref = (r.statut === "enligne" && r.date_mise_en_ligne) ? r.date_mise_en_ligne : r.date_achat;
    if (!ref) return 0;
    return Math.max(0, daysBetween(ref, today()));
  }

  // ---- Rendu principal -----------------------------------------------------
  RV.render = async function () {
    var box = document.getElementById("revente");
    if (!box) return;
    injectCSS();
    RV.wire();
    if (!RV.loaded && !RV.loading) { box.innerHTML = loadingHTML(); await RV.fetch(); }
    if (RV.loading) { box.innerHTML = loadingHTML(); return; }
    if (RV.err) {
      box.innerHTML = '<div class="card" style="border-left:4px solid var(--accent);margin:12px 0">⚠️ ' + esc(RV.err) +
        ' <button class="link" data-rv-act="reload">↻ Réessayer</button></div>';
      return;
    }
    box.innerHTML =
      '<h2 class="page-title" style="font-size:1.5rem;margin:14px 0 2px">Achat-<em>revente</em></h2>' +
      '<p class="page-sub">Suis tes pièces, tes marges et ce qui dort trop longtemps.</p>' +
      saisieHTML() +
      '<div class="chips" style="margin:18px 0 4px">' +
        chip("stock", "📦 Stock") + chip("ventes", "💸 Ventes") + chip("stats", "📊 Stats") +
      '</div>' +
      '<div id="rv-view">' + viewHTML() + '</div>';
    bindLiveMarge();
  };

  function loadingHTML() { return '<p class="page-sub" style="margin-top:20px">Chargement…</p>'; }

  function chip(v, label) {
    return '<button class="chip' + (RV.view === v ? " on" : "") + '" data-rv-view="' + v + '">' + label + "</button>";
  }

  function viewHTML() {
    if (RV.view === "ventes") return ventesHTML();
    if (RV.view === "stats") return statsHTML();
    return stockHTML();
  }

  // ---- 1) Saisie rapide ----------------------------------------------------
  function saisieHTML() {
    var etatOpts = ['<option value="">— état —</option>'].concat(
      ETATS.map(function (e) { return '<option value="' + esc(e) + '">' + esc(e) + "</option>"; })
    ).join("");
    var inp = function (name, ph, type, extra) {
      return '<input class="rv-in" name="' + name + '" placeholder="' + esc(ph) + '"' +
        (type ? ' type="' + type + '"' : "") + (extra || "") + ">";
    };
    return '' +
    '<details class="section-block" id="rv-saisie" open style="margin:6px 0 2px">' +
      '<summary><span class="chev">▸</span>➕ Ajouter une pièce</summary>' +
      '<div class="section-body">' +
        '<form id="rv-form" class="rv-grid" autocomplete="off">' +
          '<label class="rv-f rv-f-2"><span>Titre *</span>' + inp("titre", "Robe Zara fleurie M", "text", " required") + "</label>" +
          '<label class="rv-f"><span>Marque</span>' + inp("marque", "Zara", "text") + "</label>" +
          '<label class="rv-f"><span>Catégorie</span>' + inp("categorie", "Robe, jean, pull…", "text") + "</label>" +
          '<label class="rv-f"><span>Taille</span>' + inp("taille", "M / 38", "text") + "</label>" +
          '<label class="rv-f"><span>État</span><select class="rv-in" name="etat">' + etatOpts + "</select></label>" +
          '<label class="rv-f"><span>Source d\'achat</span>' + inp("source", "Vinted, Emmaüs, vide-grenier…", "text") + "</label>" +
          '<label class="rv-f"><span>Compte de vente</span>' + inp("compte", "Mon compte Vinted…", "text") + "</label>" +
          '<label class="rv-f"><span>Date d\'achat</span>' + inp("date_achat", "", "date", ' value="' + today() + '"') + "</label>" +
          '<label class="rv-f"><span>Prix d\'achat (port inclus) *</span>' + inp("prix_achat", "0", "number", ' step="0.01" min="0" inputmode="decimal" required') + "</label>" +
          '<label class="rv-f"><span>Prix visé</span>' + inp("prix_vise", "0", "number", ' step="0.01" min="0" inputmode="decimal"') + "</label>" +
          '<label class="rv-f rv-f-2 rv-check"><input type="checkbox" name="enligne"><span>Déjà en ligne (met la date du jour)</span></label>' +
          '<label class="rv-f rv-f-2"><span>Notes</span><textarea class="rv-in" name="notes" rows="2" placeholder="Défauts, mesures, remarques…"></textarea></label>' +
          '<div class="rv-f rv-f-2 rv-margeline">Marge visée : <strong id="rv-marge">—</strong></div>' +
          '<div class="rv-f rv-f-2"><button type="submit" class="btn-accent btn-block" data-rv-act="save">Enregistrer la pièce</button></div>' +
        "</form>" +
      "</div>" +
    "</details>";
  }

  function bindLiveMarge() {
    var f = document.getElementById("rv-form");
    if (!f) return;
    var upd = function () {
      var pa = num(f.prix_achat && f.prix_achat.value);
      var pv = num(f.prix_vise && f.prix_vise.value);
      var el = document.getElementById("rv-marge");
      if (!el) return;
      if (pa == null && pv == null) { el.textContent = "—"; el.style.color = ""; return; }
      var m = (pv || 0) - (pa || 0);
      el.textContent = euro(m) + (pa ? " · " + pct(((m) / pa) * 100) + " de retour" : "");
      el.style.color = m > 0 ? "var(--accent)" : (m < 0 ? "#b00" : "");
    };
    f.addEventListener("input", upd);
    upd();
  }

  // ---- 2) Stock ------------------------------------------------------------
  function stockHTML() {
    var stock = RV.rows.filter(function (r) { return r.statut === "stock" || r.statut === "enligne"; });
    if (!stock.length) return '<p class="page-sub">Aucune pièce en stock. Ajoute ta première pièce ci-dessus 👆</p>';
    var immob = stock.reduce(function (s, r) { return s + (Number(r.prix_achat) || 0); }, 0);
    var margeVisee = stock.reduce(function (s, r) {
      return s + ((r.prix_vise != null ? Number(r.prix_vise) : 0) - (Number(r.prix_achat) || 0));
    }, 0);
    var dorment = stock.filter(function (r) { return joursDort(r) >= 30; }).length;
    var tiles = '<div class="summary" style="margin-top:8px">' +
      tile("Pièces en stock", stock.length) +
      tile("Argent immobilisé", euro(immob)) +
      tile("Marge visée", euro(margeVisee)) +
      (dorment ? tile("Dorment ≥ 30 j", dorment, "var(--accent)") : "") +
      "</div>";
    // Tri : les plus anciennes (qui dorment) en haut.
    stock.sort(function (a, b) { return joursDort(b) - joursDort(a); });
    var rowsHTML = stock.map(function (r) {
      var j = joursDort(r);
      var vieille = j >= 30;
      var statutLbl = r.statut === "enligne" ? "en ligne" : "en stock";
      var marVis = (r.prix_vise != null ? Number(r.prix_vise) : 0) - (Number(r.prix_achat) || 0);
      return '<div class="card" style="margin-top:10px;padding:12px 14px' + (vieille ? ";border-left:4px solid var(--accent)" : "") + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
          '<div style="min-width:0">' +
            '<strong>' + esc(r.titre || "—") + "</strong>" +
            (r.marque ? ' <span class="badge badge-type">' + esc(r.marque) + "</span>" : "") +
            '<div class="cl-obj" style="margin-top:3px">' +
              [r.categorie, r.taille, r.etat].filter(Boolean).map(esc).join(" · ") +
              (r.source ? " · acheté sur " + esc(r.source) : "") +
            "</div>" +
            '<div class="cl-line" style="margin-top:5px">' +
              '<span>Achat ' + euro(r.prix_achat) + (r.prix_vise != null ? " → visé " + euro(r.prix_vise) + " (marge " + euro(marVis) + ")" : "") + "</span>" +
            "</div>" +
          "</div>" +
          '<div style="text-align:right;flex:none">' +
            '<div class="' + (vieille ? "dot-alert" : "cl-obj") + '">' + (vieille ? "💤 " : "") + statutLbl + " · " + j + " j</div>" +
            '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
              (r.statut === "stock" ? '<button class="btn-ghost btn-sm" data-rv-act="enligne" data-id="' + r.id + '">🔗 En ligne</button>' : "") +
              '<button class="btn-accent btn-sm" data-rv-act="vendu" data-id="' + r.id + '">✅ Vendu</button>' +
              '<button class="btn-ghost btn-sm" data-rv-act="menu" data-id="' + r.id + '">⋯</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");
    return tiles + rowsHTML;
  }

  // ---- 3) Ventes -----------------------------------------------------------
  function ventesFiltered() {
    var vendus = RV.rows.filter(function (r) { return r.statut === "vendu"; });
    var t = today(), ym = t.slice(0, 7);
    if (RV.ventesFilter === "mois") return vendus.filter(function (r) { return String(r.date_vente || "").slice(0, 7) === ym; });
    if (RV.ventesFilter === "30j") return vendus.filter(function (r) { return r.date_vente && daysBetween(r.date_vente, t) <= 30; });
    return vendus;
  }
  function ventesHTML() {
    var vfc = function (v, label) {
      return '<button class="chip' + (RV.ventesFilter === v ? " on" : "") + '" data-rv-vfilter="' + v + '">' + label + "</button>";
    };
    var list = ventesFiltered().slice().sort(function (a, b) { return String(b.date_vente || "").localeCompare(String(a.date_vente || "")); });
    var head = '<div class="chips" style="margin:4px 0 10px">' + vfc("all", "Tout") + vfc("mois", "Ce mois") + vfc("30j", "30 jours") + "</div>";
    if (!list.length) return head + '<p class="page-sub">Aucune vente sur cette période.</p>';
    var totMarge = 0, totVente = 0;
    list.forEach(function (r) { totMarge += (margeOf(r) || 0); totVente += (Number(r.prix_vente) || 0); });
    var tiles = '<div class="summary" style="margin-bottom:8px">' +
      tile("Ventes", list.length) +
      tile("Encaissé", euro(totVente)) +
      tile("Marge nette", euro(totMarge), totMarge >= 0 ? "var(--accent)" : "#b00") +
      "</div>";
    var rowsHTML = list.map(function (r) {
      var m = margeOf(r), pa = Number(r.prix_achat) || 0;
      var roi = pa ? (m / pa) * 100 : null;
      var jv = joursVenteOf(r);
      return '<div class="card" style="margin-top:8px;padding:11px 14px">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
          '<div style="min-width:0"><strong>' + esc(r.titre || "—") + "</strong>" +
            (r.marque ? ' <span class="badge badge-type">' + esc(r.marque) + "</span>" : "") +
            '<div class="cl-obj" style="margin-top:3px">Acheté ' + euro(r.prix_achat) + " · vendu " + euro(r.prix_vente) +
              (r.frais_vente ? " · frais " + euro(r.frais_vente) : "") +
              (r.date_vente ? " · le " + esc(r.date_vente) : "") + "</div>" +
          "</div>" +
          '<div style="text-align:right;flex:none">' +
            '<div style="font-weight:700;color:' + (m >= 0 ? "var(--accent)" : "#b00") + '">' + euro(m) + "</div>" +
            '<div class="cl-obj">' + (roi != null ? pct(roi) + " · " : "") + (jv != null ? jv + " j pour vendre" : "") + "</div>" +
          "</div>" +
        "</div></div>";
    }).join("");
    return head + tiles + rowsHTML;
  }

  // ---- 4) Stats ------------------------------------------------------------
  function bracket(pa) {
    pa = Number(pa) || 0;
    if (pa <= 10) return "≤ 10 €";
    if (pa <= 20) return "10–20 €";
    if (pa <= 35) return "20–35 €";
    return "+ 35 €";
  }
  function groupTable(titre, vendus, keyFn, order) {
    var g = {};
    vendus.forEach(function (r) {
      var k = keyFn(r); if (k == null || k === "") k = "—";
      (g[k] || (g[k] = { n: 0, invest: 0, marge: 0 }));
      g[k].n++; g[k].invest += (Number(r.prix_achat) || 0); g[k].marge += (margeOf(r) || 0);
    });
    var keys = Object.keys(g);
    if (!keys.length) return "";
    if (order) keys.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    else keys.sort(function (a, b) { return g[b].marge - g[a].marge; });
    var body = keys.map(function (k) {
      var x = g[k], roi = x.invest ? (x.marge / x.invest) * 100 : 0;
      return "<tr><td>" + esc(k) + '</td><td style="text-align:center">' + x.n +
        '</td><td style="text-align:right">' + euro(x.marge) +
        '</td><td style="text-align:right;color:var(--text-light)">' + pct(roi) + "</td></tr>";
    }).join("");
    return '<details class="section-block" style="margin:12px 0"><summary><span class="chev">▸</span>' + esc(titre) + "</summary>" +
      '<div class="section-body"><table class="rv-table"><thead><tr><th>' + esc(titre.replace(/^Par /, "")) +
      '</th><th style="text-align:center">Pièces</th><th style="text-align:right">Marge</th><th style="text-align:right">Retour</th></tr></thead><tbody>' +
      body + "</tbody></table></div></details>";
  }
  function statsHTML() {
    var vendus = RV.rows.filter(function (r) { return r.statut === "vendu"; });
    if (!vendus.length) return '<p class="page-sub">Pas encore de vente : les stats apparaîtront dès ta première pièce vendue.</p>';
    var margeNette = vendus.reduce(function (s, r) { return s + (margeOf(r) || 0); }, 0);
    var invest = vendus.reduce(function (s, r) { return s + (Number(r.prix_achat) || 0); }, 0);
    var moyenne = margeNette / vendus.length;
    var roi = invest ? (margeNette / invest) * 100 : 0;
    var joursVals = vendus.map(joursVenteOf).filter(function (x) { return x != null; });
    var joursMoy = joursVals.length ? Math.round(joursVals.reduce(function (s, x) { return s + x; }, 0) / joursVals.length) : null;
    var tiles = '<div class="summary" style="margin-top:4px">' +
      tile("Marge nette totale", euro(margeNette), margeNette >= 0 ? "var(--accent)" : "#b00") +
      tile("Marge moyenne / pièce", euro(moyenne)) +
      tile("Retour sur achat", pct(roi)) +
      (joursMoy != null ? tile("Jours moyens pour vendre", joursMoy + " j") : "") +
      "</div>";
    return tiles +
      groupTable("Par marque", vendus, function (r) { return r.marque; }) +
      groupTable("Par catégorie", vendus, function (r) { return r.categorie; }) +
      groupTable("Par source d'achat", vendus, function (r) { return r.source; }) +
      groupTable("Par mois", vendus, function (r) { return String(r.date_vente || "—").slice(0, 7); }) +
      groupTable("Par tranche de prix d'achat", vendus, function (r) { return bracket(r.prix_achat); }, ["≤ 10 €", "10–20 €", "20–35 €", "+ 35 €"]);
  }

  function tile(k, v, color) {
    return '<div class="sum-item"><div class="k">' + esc(k) + '</div><div class="v"' + (color ? ' style="color:' + color + '"' : "") + ">" + (typeof v === "string" ? v : esc(v)) + "</div></div>";
  }

  // ---- Actions -------------------------------------------------------------
  RV.save = async function (form) {
    var g = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ""; };
    var titre = g("titre");
    if (!titre) { UI.toast("Le titre est obligatoire", "err"); return; }
    var pa = num(g("prix_achat"));
    if (pa == null) { UI.toast("Indique le prix d'achat", "err"); return; }
    var enligne = form.querySelector('[name="enligne"]') && form.querySelector('[name="enligne"]').checked;
    var row = {
      titre: titre,
      marque: g("marque") || null, categorie: g("categorie") || null, taille: g("taille") || null,
      etat: g("etat") || null, source: g("source") || null, compte: g("compte") || null,
      date_achat: g("date_achat") || today(),
      prix_achat: pa, prix_vise: num(g("prix_vise")),
      statut: enligne ? "enligne" : "stock",
      date_mise_en_ligne: enligne ? today() : null,
      notes: g("notes") || null,
    };
    var btn = form.querySelector('[data-rv-act="save"]');
    if (btn) btn.disabled = true;
    try {
      await window.DB.insert("achats_revente", row);
      UI.toast("Pièce ajoutée ✓");
      RV.view = "stock";
      await RV.fetch();
      await RV.render();
    } catch (e) { console.error(e); UI.toast(UI.errText(e), "err"); if (btn) btn.disabled = false; }
  };

  RV.markEnligne = async function (id) {
    try {
      await window.DB.update("achats_revente", id, { statut: "enligne", date_mise_en_ligne: today() });
      UI.toast("Marquée en ligne ✓");
      await RV.fetch(); await RV.render();
    } catch (e) { console.error(e); UI.toast(UI.errText(e), "err"); }
  };

  RV.markVendu = async function (id) {
    var r = RV.rows.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;
    var v = await UI.form({
      title: "Vendu : " + (r.titre || ""), submit: "Enregistrer la vente",
      fields: [
        { name: "prix_vente", label: "Prix de vente (€)", type: "number", required: true, value: r.prix_vise != null ? r.prix_vise : "" },
        { name: "frais_vente", label: "Frais (commission, port à ta charge…) €", type: "number", half: true, value: "0" },
        { name: "date_vente", label: "Date de vente", type: "date", half: true, value: today() },
      ],
    });
    if (!v) return;
    var pv = num(v.prix_vente);
    if (pv == null) { UI.toast("Indique le prix de vente", "err"); return; }
    try {
      await window.DB.update("achats_revente", id, {
        statut: "vendu", prix_vente: pv, frais_vente: num(v.frais_vente) || 0, date_vente: v.date_vente || today(),
      });
      var marge = pv - (Number(r.prix_achat) || 0) - (num(v.frais_vente) || 0);
      UI.toast("Vendu ✓ Marge : " + euro(marge));
      await RV.fetch(); await RV.render();
    } catch (e) { console.error(e); UI.toast(UI.errText(e), "err"); }
  };

  RV.menu = async function (id) {
    var r = RV.rows.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;
    var opts = [{ value: "invendable", label: "Marquer invendable" }];
    if (r.statut === "enligne") opts.unshift({ value: "stock", label: "Repasser en stock" });
    opts.push({ value: "supprimer", label: "🗑️ Supprimer la pièce" });
    var v = await UI.form({
      title: r.titre || "Pièce", submit: "Appliquer",
      fields: [{ name: "action", label: "Que faire ?", type: "select", options: opts, value: opts[0].value }],
    });
    if (!v || !v.action) return;
    try {
      if (v.action === "supprimer") {
        if (!(await UI.confirm("Supprimer « " + (r.titre || "") + " » ? Cette action est définitive."))) return;
        await window.DB.remove("achats_revente", id);
        UI.toast("Pièce supprimée");
      } else {
        await window.DB.update("achats_revente", id, { statut: v.action });
        UI.toast("Mis à jour ✓");
      }
      await RV.fetch(); await RV.render();
    } catch (e) { console.error(e); UI.toast(UI.errText(e), "err"); }
  };

  // ---- Câblage (événements délégués, une seule fois) -----------------------
  RV.wire = function () {
    if (RV.wired) return; RV.wired = true;
    var box = document.getElementById("revente");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var vb = e.target.closest("[data-rv-view]");
      if (vb) { RV.view = vb.dataset.rvView; RV.render(); return; }
      var vf = e.target.closest("[data-rv-vfilter]");
      if (vf) { RV.ventesFilter = vf.dataset.rvVfilter; var vv = document.getElementById("rv-view"); if (vv) vv.innerHTML = viewHTML(); markChips(); return; }
      var act = e.target.closest("[data-rv-act]");
      if (!act) return;
      var id = act.dataset.id, a = act.dataset.rvAct;
      if (a === "reload") { RV.loaded = false; RV.render(); }
      else if (a === "enligne") RV.markEnligne(id);
      else if (a === "vendu") RV.markVendu(id);
      else if (a === "menu") RV.menu(id);
    });
    box.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "rv-form") { e.preventDefault(); RV.save(e.target); }
    });
  };
  // Re-synchronise l'état visuel des chips de vue sans tout re-rendre.
  function markChips() {
    document.querySelectorAll("#revente [data-rv-view]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.rvView === RV.view);
    });
    document.querySelectorAll("#revente [data-rv-vfilter]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.rvVfilter === RV.ventesFilter);
    });
  }

  // ---- Styles spécifiques (injectés, pour ne pas toucher app.css) ----------
  function injectCSS() {
    if (document.getElementById("rv-css")) return;
    var s = document.createElement("style"); s.id = "rv-css";
    s.textContent =
      "#revente .rv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}" +
      "#revente .rv-f{display:flex;flex-direction:column;gap:5px;min-width:0}" +
      "#revente .rv-f>span{font-size:.75rem;font-weight:600;color:var(--text-light)}" +
      "#revente .rv-f-2{grid-column:1 / -1}" +
      "#revente .rv-in{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--white);font-family:inherit;font-size:.9rem;color:var(--text)}" +
      "#revente .rv-in:focus{outline:none;border-color:var(--accent)}" +
      "#revente textarea.rv-in{resize:vertical}" +
      "#revente .rv-check{flex-direction:row;align-items:center;gap:8px}" +
      "#revente .rv-check span{font-size:.85rem;color:var(--text-mid)}" +
      "#revente .rv-check input{width:18px;height:18px;accent-color:var(--accent)}" +
      "#revente .rv-margeline{font-size:.9rem;color:var(--text-mid)}" +
      "#revente .rv-margeline strong{font-size:1.05rem}" +
      "#revente .rv-table{width:100%;border-collapse:collapse;font-size:.84rem}" +
      "#revente .rv-table th{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}" +
      "#revente .rv-table td{padding:7px 8px;border-bottom:1px solid var(--line-soft)}" +
      "#revente .rv-table tbody tr:last-child td{border-bottom:none}";
    document.head.appendChild(s);
  }

  // ---- Intégration : fonction globale appelée par renderAll() (comme renderFinances) ----
  window.renderRevente = function () { return RV.render(); };
  window.RV = RV;
})();
