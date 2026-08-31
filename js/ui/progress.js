// ============================================================================
// progress.js + chart.js (regroupés) — rendus visuels sans dépendance.
// ============================================================================
window.UI = window.UI || {};

// Barre de progression (retourne du HTML)
UI.progressBar = function (pct, label) {
  const p = Math.min(100, Math.max(0, Math.round(pct || 0)));
  return `
    <div class="progress">
      <div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div>
      <div class="progress-meta"><span>${label || ""}</span><strong>${p} %</strong></div>
    </div>`;
};

// Mini graphique linéaire SVG (points = [{date, valeur}]) — pour poids/mensurations
UI.lineChart = function (points, opts) {
  opts = opts || {};
  const w = opts.w || 320, h = opts.h || 110, pad = 22;
  if (!points || points.length === 0) return `<div class="chart-empty">Pas encore de données</div>`;
  if (points.length === 1) {
    return `<div class="chart-single">${points[0].valeur}${opts.unite || ""}
            <span>${window.Calc.fmtShort(points[0].date)}</span></div>`;
  }
  const vals = points.map((p) => p.valeur);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const x = (i) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.valeur).toFixed(1)}`).join(" ");
  const area = `${d} L${x(n - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.valeur).toFixed(1)}" r="3"/>`)
    .join("");
  return `
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
      <path class="chart-area" d="${area}"/>
      <path class="chart-line" d="${d}"/>
      ${dots}
      <text class="chart-lbl" x="${pad}" y="12">${max}${opts.unite || ""}</text>
      <text class="chart-lbl" x="${pad}" y="${h - 4}">${min}${opts.unite || ""}</text>
    </svg>`;
};
