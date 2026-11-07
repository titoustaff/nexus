// Briques communes de la suite GolfNexus — v1 : lanceur de modules (https://titoustaff.github.io/nexus/commun/v1/lanceur.js)
// Un clic sur le drapeau (logo du bandeau, .bandeau .logo) ouvre une grille : une pastille par module (modules.json),
// le module ouvert mis en avant, les modules à venir grisés « Bientôt », et un lien vers l'accueil GolfNexus.
// Script classique, chargé après nexus.js. Styles : charte.css (« lanceur »).
"use strict";
(() => {
  const ICI = new URL(".", document.currentScript.src);          // …/nexus/commun/v1/
  const RACINE = new URL("../../", ICI);                          // …/nexus/
  const logo = document.querySelector(".bandeau .marque .logo");
  if (!logo) return;
  // le drapeau devient un bouton (même place, même taille)
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "lanceur-btn"; btn.id = "lanceur-btn";
  btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "lanceur");
  btn.title = "Modules GolfNexus"; btn.setAttribute("aria-label", "Ouvrir les modules GolfNexus");
  logo.replaceWith(btn); btn.append(logo);
  const pan = document.createElement("div");
  pan.className = "lanceur"; pan.id = "lanceur"; pan.hidden = true; pan.setAttribute("role", "dialog"); pan.setAttribute("aria-label", "Modules GolfNexus");
  document.body.append(pan);

  const actuel = () => { const m = location.pathname.match(/\/nexus\/([^/]+)\//); return m ? m[1] : ""; };
  let modules = null;
  async function charger() {
    if (modules) return modules;
    try { modules = (await (await fetch(new URL("modules.json", ICI))).json()).modules || []; }
    catch { modules = []; }
    return modules;
  }
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function placer() {   // sous le drapeau, sans sortir de l'écran
    const r = btn.getBoundingClientRect();
    pan.style.top = `${Math.round(r.bottom + window.scrollY + 10)}px`;
    pan.style.left = `${Math.round(Math.max(8, Math.min(r.left + window.scrollX - 8, document.documentElement.clientWidth - pan.offsetWidth - 8)))}px`;
  }
  async function ouvrir(oui, auClavier = false) {
    pan.hidden = !oui; btn.setAttribute("aria-expanded", String(oui));
    if (!oui) return;
    const M = await charger(), ici = actuel();
    pan.innerHTML = `<div class="lc-titre">Modules GolfNexus</div><div class="lc-grille">${M.map((m) => {
      const ouvert = m.etat === "ouvert" && m.adresse, cour = m.id === ici;
      const corps = `<span class="lc-pastille" style="--c:${e(m.couleur)}">${m.icone || ""}</span><b>${e(m.nom)}</b><small>${cour ? "ici" : ouvert ? e(m.verbe) : "Bientôt"}</small>`;
      return ouvert && !cour ? `<a class="lc-module" href="${e(new URL(m.adresse, RACINE).href)}">${corps}</a>`
        : `<span class="lc-module${cour ? " lc-ici" : " lc-bientot"}" ${cour ? 'aria-current="page"' : 'aria-disabled="true"'}>${corps}</span>`;
    }).join("")}</div><a class="lc-accueil" href="${e(RACINE.href)}">⌂ Accueil GolfNexus</a>`;
    placer();
    if (auClavier) pan.querySelector("a")?.focus();   // à la souris : pas de surlignage
  }
  btn.addEventListener("click", (ev) => { ev.stopPropagation(); ouvrir(pan.hidden, ev.detail === 0); });
  document.addEventListener("click", (ev) => { if (!pan.hidden && !pan.contains(ev.target)) ouvrir(false); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !pan.hidden) { ouvrir(false); btn.focus(); } });
  window.addEventListener("resize", () => { if (!pan.hidden) placer(); });
})();
