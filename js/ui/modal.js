// ============================================================================
// modal.js — modale de formulaire générique (pour toutes les actions rapides).
// UI.form({ title, fields:[...], submit:'Enregistrer' }) → Promise(values|null)
//   field = { name, label, type, value, options, required, placeholder, half, hint }
//   types : text | textarea | number | date | select | checkbox | hidden | static
// ============================================================================
window.UI = window.UI || {};

UI.form = function (opts) {
  return new Promise((resolve) => {
    const fields = opts.fields || [];
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${opts.title || ""}</h3>
          <button class="modal-x" aria-label="Fermer">✕</button>
        </div>
        <form class="modal-body"></form>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-act="cancel">Annuler</button>
          <button type="submit" class="btn-accent" data-act="ok" form="__none">${opts.submit || "Enregistrer"}</button>
        </div>
      </div>`;
    const form = overlay.querySelector(".modal-body");

    fields.forEach((f) => {
      if (f.type === "hidden") return;
      const wrap = document.createElement("label");
      wrap.className = "field" + (f.half ? " field-half" : "");
      const id = "f_" + f.name;
      let control = "";
      const val = f.value == null ? "" : String(f.value);
      if (f.type === "textarea") {
        control = `<textarea id="${id}" name="${f.name}" rows="3" placeholder="${f.placeholder || ""}">${val}</textarea>`;
      } else if (f.type === "select") {
        const opts2 = (f.options || [])
          .map((o) => `<option value="${o.value}" ${o.value === val ? "selected" : ""}>${o.label}</option>`)
          .join("");
        control = `<select id="${id}" name="${f.name}">${opts2}</select>`;
      } else if (f.type === "checkbox") {
        control = `<input type="checkbox" id="${id}" name="${f.name}" ${f.value ? "checked" : ""}>`;
        wrap.classList.add("field-check");
      } else if (f.type === "static") {
        control = `<div class="field-static">${val}</div>`;
      } else {
        control = `<input type="${f.type || "text"}" id="${id}" name="${f.name}" value="${val}"
                    placeholder="${f.placeholder || ""}" ${f.required ? "required" : ""}>`;
      }
      const hint = f.hint ? `<span class="field-hint">${f.hint}</span>` : "";
      wrap.innerHTML = `<span class="field-label">${f.label || ""}${f.required ? " *" : ""}</span>${control}${hint}`;
      form.appendChild(wrap);
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    // NE PAS auto-focus le 1er champ : sur iPhone ça faisait monter le clavier d'emblée
    // et masquait le formulaire. La coach/cliente tape elle-même dans le champ voulu.
    // Quand un champ prend le focus (clavier iOS qui monte), on le recentre AU-DESSUS du
    // clavier pour qu'il reste visible et que la saisie soit fluide.
    form.addEventListener("focusin", (e) => {
      if (e.target.matches("input,textarea,select")) {
        setTimeout(() => {
          try { e.target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
        }, 300);
      }
    });

    function close(result) {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 180);
      resolve(result);
    }
    function collect() {
      const out = {};
      fields.forEach((f) => {
        if (f.type === "static") return;
        if (f.type === "hidden") { out[f.name] = f.value; return; }
        const el = form.querySelector(`[name="${f.name}"]`);
        if (!el) return;
        if (f.type === "checkbox") out[f.name] = el.checked;
        else if (f.type === "number") out[f.name] = el.value === "" ? null : Number(el.value);
        else out[f.name] = el.value === "" ? null : el.value;
      });
      return out;
    }
    function submit() {
      // validation "required"
      for (const f of fields) {
        if (f.required && f.type !== "checkbox") {
          const el = form.querySelector(`[name="${f.name}"]`);
          if (el && !el.value) { el.focus(); el.classList.add("invalid"); return; }
        }
      }
      close(collect());
    }

    overlay.querySelector(".modal-x").onclick = () => close(null);
    overlay.querySelector('[data-act="cancel"]').onclick = () => close(null);
    overlay.querySelector('[data-act="ok"]').onclick = submit;
    form.onsubmit = (e) => { e.preventDefault(); submit(); };
    overlay.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); submit(); } });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(null); }
    });
  });
};

// Toast de confirmation / d'erreur.
//  • Succès (ok)  : vert, coche, disparaît tout seul (~4,5 s). Toujours visible
//    en bas d'écran (position fixe) → pas besoin de descendre pour vérifier.
//  • Erreur (err) : rouge, RESTE affichée avec une croix pour fermer (on ne rate
//    jamais un échec de sauvegarde). Cliquer dessus la ferme aussi.
UI.toast = function (msg, kind, opts) {
  opts = opts || {};
  kind = kind === "err" ? "err" : "ok";
  // Un seul toast « vivant » à la fois (pas d'empilement).
  document.querySelectorAll(".toast.live").forEach((n) => n.remove());
  // Les messages historiques finissent souvent par « ✓ » : l'icône le porte déjà.
  const text = String(msg == null ? "" : msg).replace(/\s*[✓✔✅]\s*$/, "").replace(/^\s*Erreur\s*:\s*/i, "");
  const t = document.createElement("div");
  t.className = "toast live " + kind;
  t.innerHTML = `<span class="ic">${kind === "err" ? "✕" : "✓"}</span><span class="tx"></span>`
    + (kind === "err" ? `<button type="button" class="toast-x" aria-label="Fermer">✕</button>` : "");
  t.querySelector(".tx").textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  let timer = null;
  const dismiss = () => { if (timer) clearTimeout(timer); t.classList.remove("show"); setTimeout(() => t.remove(), 300); };
  // Durée : succès court, erreur longue (mais fermable à tout moment).
  const dur = opts.duration != null ? opts.duration : (kind === "err" ? 9000 : 4500);
  if (dur) timer = setTimeout(dismiss, dur);
  t.addEventListener("click", dismiss);
  return t;
};

// Traduit une erreur (Supabase / réseau / JS) en message humain pour la coach.
UI.errText = function (e) {
  const raw = (e && (e.message || e.error_description || e.msg)) || (typeof e === "string" ? e : "");
  if (/délai dépassé|ne répond|timeout|Failed to fetch|NetworkError|Load failed/i.test(raw))
    return "Non enregistré — le réseau ne répond pas. Vérifie ta connexion et réessaie.";
  if (/duplicate key|already exists/i.test(raw)) return "Non enregistré — cet élément existe déjà.";
  if (/permission|row-level security|RLS|not allowed/i.test(raw)) return "Non enregistré — accès refusé (droits).";
  return "Non enregistré — " + (raw || "erreur inconnue") + ". Réessaie.";
};

// Confirmation simple
UI.confirm = function (msg) {
  return UI.form({ title: msg, fields: [], submit: "Confirmer" }).then((r) => r !== null);
};
