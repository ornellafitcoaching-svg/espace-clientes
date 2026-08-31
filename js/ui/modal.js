// ============================================================================
// modal.js — modale de formulaire générique (pour toutes les actions rapides).
// UI.form({ title, fields:[...], submit:'Enregistrer' }) → Promise(values|null)
//   field = { name, label, type, value, options, required, placeholder, half }
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
      wrap.innerHTML = `<span class="field-label">${f.label || ""}${f.required ? " *" : ""}</span>${control}`;
      form.appendChild(wrap);
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    const first = form.querySelector("input,textarea,select");
    if (first) setTimeout(() => first.focus(), 60);

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

// Petit toast de confirmation
UI.toast = function (msg, kind) {
  const t = document.createElement("div");
  t.className = "toast " + (kind || "ok");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
};

// Confirmation simple
UI.confirm = function (msg) {
  return UI.form({ title: msg, fields: [], submit: "Confirmer" }).then((r) => r !== null);
};
