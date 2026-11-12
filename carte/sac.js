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
    // rangés par ligne de famille (12/11) : bois et hybrides, fers, wedges, putter
    const LIGNES = [["bois", "hybride"], ["fer"], ["wedge"], ["putter"]];
    const b = (x) => `<button type="button" class="cl cl-${famille(x)}" ${attrs} data-val="${esc(x)}" aria-pressed="${x === choisi}">${esc(x)}</button>`;
    return `<div class="cl-lignes">${LIGNES.map((F) => L.filter((x) => F.includes(famille(x)))).filter((l) => l.length)
      .map((l) => `<div class="cl-ligne">${l.map(b).join("")}</div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- écran « Mon sac » (version visuelle, 12/11)
  // le sac = une ligne par club, de la plus longue portée à la plus courte, barre proportionnelle (on voit les trous entre clubs),
  // − / + pour régler la portée ; en dessous, « Ajouter un club » : les clubs absents du sac, filtrés par famille.
  let note = "", filtre = "tous";
  const ICONE = { bois: "🪵", hybride: "◆", fer: "▮", wedge: "◢", putter: "⛳" };
  function enregistrer(S) { Compte.setFiche({ sac: S }); }
  const perso = () => Array.isArray(Compte.fiche?.sac) && Compte.fiche.sac.length;
  function rendre() {
    const z = document.getElementById("sac-contenu"); if (!z) return;
    const S = perso() ? sac() : [], dans = new Set(S.map((x) => x.c));
    const enCours = typeof etat !== "undefined" && etat.partie && !etat.vue;
    const tri = S.slice().sort((a, b) => b.d - a.d || (parNom[a.c]?.i ?? 99) - (parNom[b.c]?.i ?? 99));
    const dmax = Math.max(220, ...S.map((x) => x.d));
    const parFam = Object.keys(FAMILLES).map((f) => [f, S.filter((x) => famille(x.c) === f).length]).filter((x) => x[1]);
    const dispo = CATALOGUE.filter(([c, f]) => !dans.has(c) && (filtre === "tous" || f === filtre));
    z.innerHTML = `
      ${enCours ? `<p><button type="button" class="lien" data-ecran="saisie">← Retour à la partie</button></p>` : ""}
      <div class="bloc sac-tete">
        <div class="sac-jauge" style="--p:${Math.round(S.length / MAX * 100)}%"><b>${S.length}</b><span>/ ${MAX}</span></div>
        <div>
          <p class="sac-titre">${S.length ? "Ton sac" : "Ton sac est vide"}</p>
          <p class="meta ${S.length ? "sac-fams" : ""}">${S.length ? parFam.map(([f, n]) => `<span class="sac-fam-n"><i class="cl-pt cl-${f}"></i>${n} ${FAMILLES[f].toLowerCase()}</span>`).join("")
            : `Ajoute tes clubs ci-dessous${perso() ? "" : `, ou <button type="button" class="lien" data-sac-defaut>pars du sac type</button>`}. En attendant, la saisie propose un sac type.`}</p>
        </div>
      </div>
      ${note ? `<p class="sac-note">${esc(note)}</p>` : ""}
      ${S.length ? `<div class="bloc sac-liste">
        <p class="meta sac-aide">Portée moyenne d'un coup plein, roule comprise : règle-la avec − et +, le club deviné pendant la saisie sera plus juste.</p>
        ${tri.map((x) => { const f = famille(x.c), put = f === "putter" && x.c === "Putter";
          return `<div class="sac-club cl-${f}">
            <span class="sac-nom"><i class="cl-pt cl-${f}"></i>${esc(x.c)}</span>
            ${put ? `<span class="sac-barre sac-barre-vide">sur le green</span>` : `<span class="sac-barre"><span style="width:${Math.max(6, Math.round(x.d / dmax * 100))}%"></span></span>
            <span class="sac-reglage"><button type="button" class="sac-pm" data-sac-pm="-5" data-c="${esc(x.c)}" aria-label="Portée ${esc(x.c)} moins 5 m">−</button><b>${x.d}<small> m</small></b><button type="button" class="sac-pm" data-sac-pm="5" data-c="${esc(x.c)}" aria-label="Portée ${esc(x.c)} plus 5 m">+</button></span>`}
            <button type="button" class="sac-x" data-sac-club="${esc(x.c)}" aria-label="Retirer ${esc(x.c)} du sac">✕</button>
          </div>`; }).join("")}
      </div>` : ""}
      <div class="bloc">
        <h3>Ajouter un club</h3>
        <div class="sac-filtres" role="group" aria-label="Famille">${[["tous", "Tous"], ...Object.entries(FAMILLES)].map(([f, t]) =>
          `<button type="button" class="bulle ${f !== "tous" ? "cl-" + f : ""}" data-sac-filtre="${f}" aria-pressed="${filtre === f}">${t}</button>`).join("")}</div>
        ${dispo.length ? `<div class="sac-ajout">${dispo.map(([c, f]) => `<button type="button" class="sac-plus cl-${f}" data-sac-club="${esc(c)}" ${S.length >= MAX ? "disabled" : ""}><span>+</span>${esc(c)}</button>`).join("")}</div>`
          : `<p class="meta">Tous les clubs de cette famille sont déjà dans ton sac.</p>`}
        ${S.length >= MAX ? `<p class="meta">Sac plein (${MAX} clubs, règle 4.1b) : retire un club pour en ajouter un autre.</p>` : ""}
      </div>`;
  }
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-sac-filtre]"); if (f) { filtre = f.dataset.sacFiltre; rendre(); return; }
    const pm = e.target.closest("[data-sac-pm]");
    if (pm) { const c = pm.dataset.c, d = +pm.dataset.sacPm; enregistrer(sac().map((x) => (x.c === c ? { c, d: Math.max(10, Math.min(350, x.d + d)) } : x))); rendre(); return; }
    const b = e.target.closest("[data-sac-club],[data-sac-defaut]"); if (!b) return;
    let S = perso() ? sac() : []; note = "";
    if (b.dataset.sacDefaut != null) S = DEFAUT.map((c) => ({ c, d: parNom[c].d }));
    else {
      const c = b.dataset.sacClub;
      if (S.some((x) => x.c === c)) S = S.filter((x) => x.c !== c);
      else if (S.length >= MAX) note = `Déjà ${MAX} clubs : retire-en un d'abord.`;
      else S.push({ c, d: parNom[c].d });
    }
    if (!note) enregistrer(S);
    rendre();
  });
  return { famille, sac, noms, pour, boutons, rendre };
})();
