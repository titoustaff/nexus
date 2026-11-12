/* GolfNexus · Carte — « Mon sac » (12/11/2026)
   Le joueur compose son sac (14 clubs au plus, règle 4.1b) et donne sa portée moyenne pour chaque club.
   Le sac sert à la saisie coup par coup : boutons de club du volet (couleur par famille) et club deviné d'après la distance.
   Rangé dans profils.fiche.sac (champ existant, enregistré par Compte.setFiche) : le joueur le retrouve sur tous ses appareils.
   Format : [{ c: "Fer 7", d: 140 }, …] dans l'ordre du catalogue. */
const SAC = (() => {
  // catalogue : nom, famille, portée par défaut (m, joueur moyen)
  const CATALOGUE = [
    ["Driver", "bois", 210], ["Bois 2", "bois", 200], ["Bois 3", "bois", 190], ["Bois 4", "bois", 182], ["Bois 5", "bois", 175],
    ["Bois 7", "bois", 165], ["Bois 9", "bois", 155], ["Bois 11", "bois", 145],
    ["Hybride 2", "hybride", 180], ["Hybride 3", "hybride", 170], ["Hybride 4", "hybride", 160], ["Hybride 5", "hybride", 150],
    ["Hybride 6", "hybride", 140], ["Hybride 7", "hybride", 130],
    ["Fer 1", "fer", 185], ["Fer 2", "fer", 175], ["Fer 3", "fer", 165], ["Fer 4", "fer", 155], ["Fer 5", "fer", 145],
    ["Fer 6", "fer", 135], ["Fer 7", "fer", 125], ["Fer 8", "fer", 115], ["Fer 9", "fer", 105],
    ["PW", "wedge", 95], ["GW", "wedge", 80], ["SW", "wedge", 65], ["LW", "wedge", 50],
    ["46°", "wedge", 95], ["48°", "wedge", 90], ["50°", "wedge", 82], ["52°", "wedge", 75], ["54°", "wedge", 68],
    ["56°", "wedge", 62], ["58°", "wedge", 55], ["60°", "wedge", 48], ["62°", "wedge", 42], ["64°", "wedge", 36],
    ["Chipper", "putter", 25], ["Putter", "putter", 0],
  ];
  const FAMILLES = { bois: "Bois", hybride: "Hybrides", fer: "Fers", wedge: "Wedges", putter: "Putter et chipper" };
  const DEFAUT = ["Driver", "Bois 3", "Hybride 4", "Fer 5", "Fer 6", "Fer 7", "Fer 8", "Fer 9", "PW", "GW", "SW", "Putter"];
  const MAX = 14;
  const parNom = Object.fromEntries(CATALOGUE.map(([c, f, d], i) => [c, { c, f, d, i }]));

  // famille d'un nom de club, y compris les anciens noms de l'essai (« Bois », « Fer 5-6 », « Hybride »)
  function famille(nom) {
    if (parNom[nom]) return parNom[nom].f;
    const n = String(nom || "").toLowerCase();
    return n.startsWith("driver") || n.startsWith("bois") ? "bois" : n.startsWith("hyb") ? "hybride" : n.startsWith("fer") ? "fer"
      : n === "putter" || n === "chipper" ? "putter" : /^(pw|gw|aw|sw|lw|wedge|\d\d°)/.test(n) ? "wedge" : "fer";
  }
  // le sac du joueur : [{c, d}] trié comme le catalogue (sac par défaut s'il n'en a pas encore composé)
  function sac() {
    const s = (typeof Compte !== "undefined" && Array.isArray(Compte.fiche?.sac) && Compte.fiche.sac.length) ? Compte.fiche.sac
      : DEFAUT.map((c) => ({ c, d: parNom[c].d }));
    return s.filter((x) => x && x.c).map((x) => ({ c: x.c, d: +x.d || parNom[x.c]?.d || 0 }))
      .sort((a, b) => (parNom[a.c]?.i ?? 99) - (parNom[b.c]?.i ?? 99));
  }
  const noms = () => sac().map((x) => x.c);
  // club le plus probable pour un coup de m mètres : celui dont la portée est la plus proche (putter sur le green)
  function pour(m, surGreen) {
    const S = sac();
    if (surGreen) return "Putter";
    const L = S.filter((x) => x.c !== "Putter" && x.d > 0);
    if (!L.length) return "";
    return L.reduce((b, x) => (Math.abs(x.d - m) < Math.abs(b.d - m) ? x : b)).c;
  }
  // boutons de club (volet du coup) : couleur par famille ; un club hors sac déjà choisi reste affiché
  function boutons(attrs, choisi) {
    const L = noms(); if (choisi && !L.includes(choisi)) L.push(choisi);
    return L.map((x) => `<button type="button" class="cl cl-${famille(x)}" ${attrs} data-val="${esc(x)}" aria-pressed="${x === choisi}">${esc(x)}</button>`).join("");
  }

  // ---------------------------------------------------------------- écran « Mon sac »
  let note = "";
  function enregistrer(S) { Compte.setFiche({ sac: S }); }
  function rendre() {
    const z = document.getElementById("sac-contenu"); if (!z) return;
    const perso = Array.isArray(Compte.fiche?.sac) && Compte.fiche.sac.length, S = perso ? sac() : [], dans = new Set(S.map((x) => x.c));
    const enCours = typeof etat !== "undefined" && etat.partie && !etat.vue;
    z.innerHTML = `
      ${enCours ? `<p><button type="button" class="lien" data-ecran="saisie">← Retour à la partie</button></p>` : ""}
      <div class="bloc">
        <p class="meta">Compose ton sac : touche un club dans « Tous les clubs » pour l'ajouter, touche-le à nouveau pour le retirer (${MAX} clubs au plus).
          Ton sac sert à la saisie coup par coup : boutons de club et club deviné d'après la distance.${perso ? "" : " <b>Ton sac n'est pas encore composé</b> : en attendant, la saisie propose un sac type."}</p>
      </div>
      <div class="bloc">
        <h3>Dans mon sac <span class="sac-compte"><b>${S.length}</b> / ${MAX} clubs</span></h3>
        ${note ? `<p class="sac-note">${esc(note)}</p>` : ""}
        ${S.length ? `<div class="sa-choix cpc-puces" role="group" aria-label="Mon sac">${S.map((x) =>
          `<button type="button" class="cl cl-${famille(x.c)}" data-sac-club="${esc(x.c)}" aria-pressed="true" title="Retirer du sac">${esc(x.c)} ✕</button>`).join("")}</div>`
          : `<p class="sac-vide">Ton sac est vide : touche les clubs ci-dessous pour les ajouter${perso ? "" : `, ou <button type="button" class="lien" data-sac-defaut>pars du sac type (12 clubs)</button>`}.</p>`}
      </div>
      <div class="bloc">
        <h3>Tous les clubs</h3>
        ${Object.entries(FAMILLES).map(([f, titre]) => `<h3 class="sac-fam">${titre}</h3>
          <div class="sa-choix cpc-puces" role="group" aria-label="${titre}">${CATALOGUE.filter((x) => x[1] === f).map(([c]) =>
            `<button type="button" class="cl cl-${f}" data-sac-club="${esc(c)}" aria-pressed="${dans.has(c)}">${esc(c)}</button>`).join("")}</div>`).join("")}
      </div>
      <div class="bloc">
        <h3>Portée de mes clubs</h3>${S.length ? "" : `<p class="meta">Ajoute des clubs ci-dessus pour régler leur portée.</p>`}
        <p class="meta">Distance moyenne de ton coup plein, roule comprise. Corrige-la : le club deviné sera plus juste.</p>
        <div class="sac-portees">${S.filter((x) => x.c !== "Putter").map((x) => `<label class="sac-portee"><span class="cl-pt cl-${famille(x.c)}" aria-hidden="true"></span>${esc(x.c)}
          <input type="number" inputmode="numeric" min="10" max="350" step="5" value="${x.d}" data-sac-portee="${esc(x.c)}" aria-label="Portée ${esc(x.c)} en mètres"> m</label>`).join("")}</div>
      </div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sac-club],[data-sac-defaut]"); if (!b) return;
    let S = Array.isArray(Compte.fiche?.sac) && Compte.fiche.sac.length ? sac() : []; note = "";
    if (b.dataset.sacDefaut != null) S = DEFAUT.map((c) => ({ c, d: parNom[c].d }));
    else {
      const c = b.dataset.sacClub;
      if (S.some((x) => x.c === c)) S = S.filter((x) => x.c !== c);
      else if (S.length >= MAX) note = `déjà ${MAX} clubs : sors-en un d'abord`;
      else S.push({ c, d: parNom[c].d });
    }
    if (!note) enregistrer(S);
    rendre();
  });
  document.addEventListener("change", (e) => {
    const i = e.target.closest("[data-sac-portee]"); if (!i) return;
    const v = Math.max(10, Math.min(350, Math.round(+i.value || 0)));
    enregistrer(sac().map((x) => (x.c === i.dataset.sacPortee ? { c: x.c, d: v } : x)));
  });
  return { famille, sac, noms, pour, boutons, rendre };
})();
