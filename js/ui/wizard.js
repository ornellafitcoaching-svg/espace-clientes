// ============================================================================
// wizard.js — questionnaire PAR ÉTAPES pour la cliente (mobile d'abord).
// UI.wizard({ title, items, draftKey, submit }) → Promise(reponses | null)
//
// items = format Calc.QI / QE / QN :
//   { section:"🌿 Titre", intro? }            → début d'une étape
//   { id, q, type, options?, hint?, req?, show? }
//   types : choice (1 réponse, gros boutons) · multi (cases à cocher) · scale (1→10)
//           number · text · textarea · select (= choice, rétro-compat)
//   multi/choice + other:true → champ « Autre / précise » sous les options.
//   show : { id:"allergies", is:[...] }  ou  { id:"x", not:[...] } → question conditionnelle.
//
// Réponses : { id: valeur } — multi stocké en TEXTE « A, B, C » (lisible partout,
// compatible avec l'affichage existant côté coach). Brouillon auto (localStorage)
// → la cliente peut fermer et reprendre plus tard sans rien perdre.
// ============================================================================
window.UI = window.UI || {};

(function () {
  const CSS = `
.wz-ov{position:fixed;inset:0;z-index:200;background:rgba(30,22,22,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .18s}
.wz-ov.open{opacity:1}
.wz{background:var(--cream);width:100%;max-width:560px;height:94vh;max-height:94vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;transform:translateY(30px);transition:transform .2s}
.wz-ov.open .wz{transform:translateY(0)}
@media(min-width:700px){.wz-ov{align-items:center}.wz{border-radius:22px;height:88vh}}
.wz-head{flex:none;padding:16px 20px 10px}
.wz-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.wz-title{font-family:'Cormorant Garamond',serif;font-size:1.25rem;font-weight:700;line-height:1.1}
.wz-x{background:none;border:none;font-size:1rem;color:var(--text-light);width:32px;height:32px;border-radius:50%}
.wz-step{font-size:.72rem;color:var(--text-light);margin-top:8px;display:flex;justify-content:space-between}
.wz-bar{height:6px;background:var(--line);border-radius:6px;margin-top:6px;overflow:hidden}
.wz-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--accent));border-radius:6px;transition:width .25s}
.wz-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px 20px 18px}
.wz-sec{font-weight:800;color:var(--accent);font-size:1.12rem;margin:6px 0 4px}
.wz-intro{font-size:.84rem;color:var(--text-mid);margin-bottom:10px}
.wz-q{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:13px 14px;margin-top:12px}
.wz-q.err{border-color:var(--danger);box-shadow:0 0 0 2px rgba(192,86,75,.15)}
.wz-l{font-weight:600;font-size:.93rem;line-height:1.35}
.wz-l .req{color:var(--accent)}
.wz-h{font-size:.76rem;color:var(--text-light);margin-top:3px}
.wz-opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.wz-o{border:1.5px solid var(--sand);background:var(--cream);color:var(--text);border-radius:40px;padding:9px 14px;font-size:.86rem;line-height:1.2;text-align:left;transition:.12s}
.wz-o.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.wz-o.multi.on::before{content:"✓ "}
.wz-scale{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin-top:10px}
.wz-scale .wz-o{padding:9px 0;text-align:center;border-radius:10px}
.wz-scl{display:flex;justify-content:space-between;font-size:.7rem;color:var(--text-light);margin-top:4px}
.wz-in{width:100%;margin-top:9px;border:1.5px solid var(--sand);border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;background:var(--cream)}
.wz-in:focus{outline:none;border-color:var(--accent);background:#fff}
textarea.wz-in{min-height:76px;resize:vertical}
.wz-foot{flex:none;display:flex;gap:10px;padding:12px 20px calc(16px + env(safe-area-inset-bottom));border-top:1px solid var(--line-soft);background:var(--cream)}
.wz-foot .btn-ghost{flex:none}
.wz-foot .btn-accent{flex:1;justify-content:center}
.wz-saved{font-size:.7rem;color:var(--ok);text-align:center;padding-top:6px;min-height:1em}
`;
  function injectCss() {
    if (document.getElementById("wz-css")) return;
    const s = document.createElement("style"); s.id = "wz-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (_) {} };

  // Découpe la liste en étapes (une étape = une section).
  function toSteps(items) {
    const steps = [];
    let cur = null;
    (items || []).forEach((it) => {
      if (it.section) { cur = { title: it.section, intro: it.intro || "", qs: [] }; steps.push(cur); return; }
      if (!it.id) return;
      if (!cur) { cur = { title: "", intro: "", qs: [] }; steps.push(cur); }
      cur.qs.push(it);
    });
    return steps.filter((s) => s.qs.length);
  }
  // Valeur « multi » interne = tableau ; stockée en texte « A, B ».
  function isVisible(q, st) {
    if (!q.show) return true;
    const v = st[q.show.id];
    const vals = Array.isArray(v) ? v : (v == null || v === "" ? [] : [String(v)]);
    if (q.show.is) return vals.some((x) => q.show.is.includes(x));
    if (q.show.not) return vals.length > 0 && !vals.every((x) => q.show.not.includes(x));
    return true;
  }
  function isEmpty(v) { return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ""); }

  window.UI.wizard = function (opts) {
    injectCss();
    const steps = toSteps(opts.items);
    const draftKey = opts.draftKey ? "wz_draft_" + opts.draftKey : null;
    const draft = (draftKey && lsGet(draftKey)) || {};
    const st = Object.assign({}, draft.v || {});      // réponses en cours
    let idx = Math.min(draft.step || 0, Math.max(steps.length - 1, 0));

    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "wz-ov";
      ov.innerHTML = `<div class="wz" role="dialog" aria-modal="true">
        <div class="wz-head"><div class="wz-top"><div class="wz-title">${esc(opts.title || "")}</div>
          <button class="wz-x" aria-label="Fermer">✕</button></div>
          <div class="wz-step"><span class="wz-st"></span><span class="wz-pc"></span></div>
          <div class="wz-bar"><i></i></div></div>
        <div class="wz-body"></div>
        <div class="wz-foot"><button type="button" class="btn-ghost wz-prev">←</button>
          <button type="button" class="btn-accent wz-next">Suivant →</button></div>
      </div>`;
      const body = ov.querySelector(".wz-body");
      const save = () => { if (draftKey) lsSet(draftKey, { v: st, step: idx, t: Date.now() }); };

      function renderStep() {
        const s = steps[idx];
        ov.querySelector(".wz-st").textContent = `Étape ${idx + 1} sur ${steps.length}`;
        const left = steps.length - idx - 1;
        ov.querySelector(".wz-pc").textContent = left === 0 ? "Dernière étape 🎉" : (left === 1 ? "Encore 1 étape" : "Encore " + left + " étapes");
        ov.querySelector(".wz-bar i").style.width = Math.max(4, Math.round(((idx + 1) / steps.length) * 100)) + "%";
        ov.querySelector(".wz-prev").style.visibility = idx === 0 ? "hidden" : "visible";
        ov.querySelector(".wz-next").innerHTML = idx === steps.length - 1 ? esc(opts.submit || "Envoyer") + " ✓" : "Suivant →";
        let h = `<div class="wz-sec">${esc(s.title)}</div>` + (s.intro ? `<div class="wz-intro">${esc(s.intro)}</div>` : "");
        s.qs.forEach((q) => {
          if (!isVisible(q, st)) return;
          const v = st[q.id];
          const type = q.type === "select" ? "choice" : (q.type || "text");
          let ctl = "";
          if (type === "choice" || type === "multi") {
            const arr = type === "multi" ? (Array.isArray(v) ? v : []) : null;
            ctl = `<div class="wz-opts">` + (q.options || []).map((o) => {
              const on = type === "multi" ? arr.includes(o) : v === o;
              return `<button type="button" class="wz-o ${type === "multi" ? "multi" : ""} ${on ? "on" : ""}" data-q="${esc(q.id)}" data-v="${esc(o)}" data-t="${type}">${esc(o)}</button>`;
            }).join("") + `</div>`;
            if (q.other) ctl += `<input class="wz-in" data-q="${esc(q.id)}__autre" placeholder="${esc(q.otherLabel || "Autre / je précise…")}" value="${esc(st[q.id + "__autre"] || "")}">`;
          } else if (type === "scale") {
            const min = q.min || 1, max = q.max || 10;
            let b = ""; for (let i = min; i <= max; i++) b += `<button type="button" class="wz-o ${String(v) === String(i) ? "on" : ""}" data-q="${esc(q.id)}" data-v="${i}" data-t="scale">${i}</button>`;
            ctl = `<div class="wz-scale">${b}</div>` + (q.lo || q.hi ? `<div class="wz-scl"><span>${esc(q.lo || "")}</span><span>${esc(q.hi || "")}</span></div>` : "");
          } else if (type === "textarea") {
            ctl = `<textarea class="wz-in" data-q="${esc(q.id)}" placeholder="${esc(q.ph || "")}">${esc(v || "")}</textarea>`;
          } else {
            ctl = `<input class="wz-in" data-q="${esc(q.id)}" ${type === "number" ? 'inputmode="decimal"' : ""} placeholder="${esc(q.ph || "")}" value="${esc(v == null ? "" : v)}">`;
          }
          h += `<div class="wz-q" data-box="${esc(q.id)}"><div class="wz-l">${esc(q.q)}${q.req ? ' <span class="req">*</span>' : ""}</div>${q.hint ? `<div class="wz-h">${esc(q.hint)}</div>` : ""}${ctl}</div>`;
        });
        h += `<div class="wz-saved"></div>`;
        body.innerHTML = h;
        body.scrollTop = 0;
      }

      body.addEventListener("click", (e) => {
        const b = e.target.closest(".wz-o"); if (!b) return;
        const id = b.dataset.q, val = b.dataset.v, t = b.dataset.t;
        if (t === "multi") {
          const arr = Array.isArray(st[id]) ? st[id].slice() : [];
          const i = arr.indexOf(val);
          // Une option « Aucun / Rien / Non » exclut les autres (et inversement).
          const exclusive = /^(aucun|aucune|rien|non|pas de |je n.?ai pas)/i;
          if (i >= 0) arr.splice(i, 1);
          else if (exclusive.test(val)) { arr.length = 0; arr.push(val); }
          else { for (let k = arr.length - 1; k >= 0; k--) if (exclusive.test(arr[k])) arr.splice(k, 1); arr.push(val); }
          st[id] = arr;
        } else {
          st[id] = (st[id] === val && t !== "scale") ? "" : val;   // re-tap = désélection
        }
        save(); renderStep();
      });
      body.addEventListener("input", (e) => {
        const el = e.target.closest(".wz-in"); if (!el) return;
        st[el.dataset.q] = el.value; save();
        const sv = body.querySelector(".wz-saved"); if (sv) sv.textContent = "Brouillon enregistré ✓";
      });
      body.addEventListener("focusin", (e) => {
        if (e.target.matches(".wz-in")) setTimeout(() => { try { e.target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }, 300);
      });

      function validateStep() {
        const s = steps[idx]; let first = null;
        s.qs.forEach((q) => {
          if (!q.req || !isVisible(q, st)) return;
          const box = body.querySelector(`[data-box="${CSS_ESC(q.id)}"]`);
          if (isEmpty(st[q.id])) { if (box) box.classList.add("err"); if (!first) first = box; }
          else if (box) box.classList.remove("err");
        });
        if (first) { try { first.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} return false; }
        return true;
      }
      function CSS_ESC(s) { return String(s).replace(/"/g, '\\"'); }

      function finish() {
        const out = {};
        steps.forEach((s) => s.qs.forEach((q) => {
          if (!isVisible(q, st)) return;
          let v = st[q.id];
          if (Array.isArray(v)) {
            v = v.slice();
            const autre = (st[q.id + "__autre"] || "").trim();
            if (autre) v.push(autre);
            v = v.join(", ");
          } else if (q.other) {
            const autre = (st[q.id + "__autre"] || "").trim();
            if (autre) v = v ? v + " — " + autre : autre;
          }
          if (isEmpty(v)) return;
          out[q.id] = typeof v === "string" ? v.trim() : v;
        }));
        return out;
      }
      function close(res, keepDraft) {
        if (!keepDraft && draftKey) lsDel(draftKey);
        ov.classList.remove("open");
        setTimeout(() => ov.remove(), 200);
        resolve(res);
      }
      ov.querySelector(".wz-x").onclick = () => close(null, true);
      ov.querySelector(".wz-prev").onclick = () => { if (idx > 0) { idx--; save(); renderStep(); } };
      ov.querySelector(".wz-next").onclick = () => {
        if (!validateStep()) return;
        if (idx < steps.length - 1) { idx++; save(); renderStep(); return; }
        // Le brouillon n'est effacé qu'après envoi réussi (opts.onDone) — sinon on le garde.
        const res = finish();
        ov.classList.remove("open"); setTimeout(() => ov.remove(), 200);
        resolve(Object.assign(res, { __clearDraft: () => draftKey && lsDel(draftKey) }));
      };
      document.body.appendChild(ov);
      renderStep();
      requestAnimationFrame(() => ov.classList.add("open"));
    });
  };
  // Pour l'affichage (coach / cliente) : la question telle qu'elle est stockée.
  window.UI.wizardSteps = toSteps;
})();
