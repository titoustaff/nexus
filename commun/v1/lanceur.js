// Briques communes de la suite GolfNexus — v1 : lanceur de modules (https://titoustaff.github.io/nexus/commun/v1/lanceur.js)
// Un clic sur le drapeau (logo du bandeau, .bandeau .logo) ouvre une grille : une pastille par module (modules.json),
// le module ouvert mis en avant, les modules à venir grisés « Bientôt », et un lien vers l'accueil GolfNexus.
// Script classique, chargé après nexus.js. Styles intégrés ci-dessous (indépendants du cache de charte.css).
"use strict";
(() => {
  const ICI = new URL(".", document.currentScript.src);          // …/nexus/commun/v1/
  const RACINE = new URL("../../", ICI);                          // …/nexus/
  const logo = document.querySelector(".bandeau .marque .logo");
  if (!logo) return;
  const style = document.createElement("style");
  style.textContent = `
/* le drapeau garde exactement son aspect : bouton invisible, seulement le curseur main (contour au clavier uniquement) */
.lanceur-btn { all: unset; display: inline-flex; flex: none; cursor: pointer; line-height: 0; border-radius: 12px; }
.lanceur-btn:focus-visible { outline: 2px solid var(--jaune); outline-offset: 3px; }
.lanceur { position: absolute; z-index: 2500; width: min(340px, calc(100vw - 16px)); background: var(--carte); color: var(--texte);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(10, 30, 18, .28); border: 1px solid var(--bord); padding: 14px 12px 10px; }
.lanceur[hidden] { display: none; }
.lc-titre { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--doux); margin: 0 6px 10px; }
.lc-grille { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.lc-module { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px 8px; border-radius: 12px; text-decoration: none; color: inherit; text-align: center; }
a.lc-module:hover, a.lc-module:focus-visible { background: var(--sauge-pale); outline: none; }
.lc-pastille { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: #fff;
  box-shadow: 0 0 0 3px var(--carte), 0 0 0 5px color-mix(in srgb, var(--c) 30%, transparent); }
.lc-pastille svg { width: 26px; height: 26px; }
.lc-module b { font-size: 13px; font-weight: 700; }
.lc-module small { font-size: 11px; color: var(--doux); line-height: 1.2; }
.lc-ici { background: var(--sauge-pale); }
.lc-ici small { color: var(--vert-2); font-weight: 700; }
.lc-bientot .lc-pastille { filter: grayscale(1); opacity: .45; }   /* pas encore ouvert : grisé (l'utilisateur, 07/11) */
.lc-bientot b { color: var(--doux); }
.lc-accueil { display: block; text-align: center; margin: 8px 4px 0; padding: 8px; border-top: 1px solid var(--bord); color: var(--vert-2); font-size: 13px; font-weight: 600; text-decoration: none; }
.lc-accueil:hover { text-decoration: underline; }
`;
  document.head.append(style);
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
    // un module réservé à un rôle (Admin : admin ; Club : coach ou admin) n'apparaît que pour ce rôle (nexus.role, posé par nexusLireProfil)
    const role = typeof nexus !== "undefined" ? nexus.role : null;
    const M = (await charger()).filter((m) => !m.role || [].concat(m.role).includes(role)), ici = actuel();
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
