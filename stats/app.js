"use strict";
// Stats — module n° 4 de la suite GolfNexus (V1) : analyser les cartes saisies dans Carte (table carte_parties).
// Tout de suite après la saisie (le joueur a besoin de ses chiffres entre deux tours) ; filtres période / contexte ;
// un coach voit les stats des joueurs qui l'ont accepté (droit coach_de du cœur, comme dans Carte).
// Règle : Stats ne lit QUE les cartes (y compris celles des tournois). Les données ffgolf restent dans Saison (Mes stats)
// et servent dans Carte à contrôler une carte ; jamais ici (score seul = stats incomplètes).
// Plus tard : séances d'Entraînement, coup par coup (Carte V2), strokes gained.

const etat = { parties: [], noms: new Map(), ouverts: new Set(), focus: null, cadre: false, vue: "", periode: "12m", contextes: new Set(["entrainement", "libre", "rencontre", "competition", "tournoi"]) };
const $ = (id) => document.getElementById(id);
const JOUR = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
// contextes, du plus calme au plus exigeant (niveau de pression)
const CONTEXTES = [["entrainement", "Entraînement"], ["libre", "Partie libre"], ["rencontre", "Rencontre"], ["competition", "Hors Mérite"], ["tournoi", "Tournoi ffgolf"]];
const LIB_CTX = Object.fromEntries(CONTEXTES);
const PERIODES = [["3m", "3 mois"], ["12m", "12 mois"], ["tout", "Tout"]];
// répartition des scores : échelle divergente autour du par (comme la carte de score : birdie orange, bogey bleu)
const CLASSES = [["aigle", "Eagle ou mieux", "#9a3412"], ["birdie", "Birdie", "#ea580c"], ["par", "Par", "#a8a29e"], ["bogey", "Bogey", "#60a5fa"], ["double", "Double ou pire", "#1d4ed8"]];

// ------------------------------------------------------------------ compte (profil + joueurs suivis, comme Carte)
const Compte = {
  moi: null, user: null, role: "joueur", fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, mineur: P.mineur, parentValide: P.parentValide, fiche: P.fiche });
    this.joueurs = [];
    if (this.role !== "joueur") { const J = await sb.rpc("mes_joueurs"); this.joueurs = (J.data || []).filter((j) => j.statut === "accepte"); }
  },
  setFiche(champs) {
    this.fiche = { ...this.fiche, ...champs };
    sb.from("profils").update({ fiche: this.fiche, modifie_le: new Date().toISOString() }).eq("id", this.moi.id)
      .then(({ error }) => { if (error) signaler("Enregistrement impossible (profil) : " + error.message); });
  },
};
function rendreCompte() {
  const b = $("b-compte"), pan = $("b-pan");
  pan.hidden = !compte.ouvert;
  if (!Compte.user) { b.innerHTML = ""; pan.innerHTML = nexusPanneauConnexion(); return; }
  const mel = Compte.user.email || "", nom = Compte.fiche.nom || mel;
  b.innerHTML = `<button type="button" class="b-btn b-moi" id="c-ouvrir" aria-haspopup="menu" aria-expanded="${compte.ouvert}" aria-controls="b-pan" title="${esc(mel)}">
      <span class="b-init" aria-hidden="true">${esc((nom.trim()[0] || "?").toUpperCase())}</span><span class="b-qui">${esc(nom)}</span><span aria-hidden="true">▾</span></button>`;
  pan.innerHTML = nexusPanneauConnecte(mel);
}
nexusBrancherPanneau(rendreCompte, Compte);
document.addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id || e.target.id;
  if (nexusClicPanneau(id, rendreCompte)) return;
  if (id === "c-ouvrir") { compte.ouvert = !compte.ouvert; rendreCompte(); return; }
  if (compte.ouvert && !e.target.closest("#b-pan")) { compte.ouvert = false; rendreCompte(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && compte.ouvert) { compte.ouvert = false; rendreCompte(); } });

// ------------------------------------------------------------------ calculs
const joues = (p) => (p.trous || []).filter((t) => t.score);
const virgule = (n, d = 1) => (n == null || Number.isNaN(n) ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const signe = (n, d = 1) => (n == null || Number.isNaN(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + virgule(Math.abs(n), d));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const classe = (t) => { const d = t.score - t.par; return d <= -2 ? "aigle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "double"; };
const coherent = (t) => t.putts == null || (t.putts || 0) + (t.pen || 0) <= t.score - 1;   // 3 avec 3 putts : écarté des calculs de putting / GIR
const gir = (t) => t.putts != null && coherent(t) && t.score - t.putts - (t.pen || 0) <= t.par - 2;
const dateCourte = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

function filtrees() {
  const debut = etat.periode === "tout" ? "" : (() => { const d = new Date(); d.setMonth(d.getMonth() - (etat.periode === "3m" ? 3 : 12)); return d.toISOString().slice(0, 10); })();
  return etat.parties.filter((p) => etat.contextes.has(p.contexte) && (!debut || p.jour >= debut) && joues(p).length >= 9);
}
// une partie, ramenée à 18 trous (écart au par × 18 / trous joués) pour comparer 9 et 18 trous
function resume(p) {
  const J = joues(p), n = J.length, ecart = J.reduce((s, t) => s + t.score - t.par, 0), C = J.filter((t) => t.putts != null && coherent(t));
  return { p, n, score: J.reduce((s, t) => s + t.score, 0), ecart, ecart18: (ecart * 18) / n,
    putts18: C.length ? (C.reduce((s, t) => s + t.putts, 0) * 18) / C.length : null };
}
function calculer(P) {
  const T = P.flatMap((p) => joues(p).map((t) => ({ ...t, ctx: p.contexte })));
  const C = T.filter((t) => t.putts != null && coherent(t)), F = T.filter((t) => t.par > 3 && t.fw);
  const R = P.map(resume);
  const parType = [3, 4, 5].map((par) => { const X = T.filter((t) => t.par === par); return { par, n: X.length, moy: X.length ? X.reduce((s, t) => s + t.score - t.par, 0) / X.length : null }; });
  const repart = Object.fromEntries(CLASSES.map(([k]) => [k, T.filter((t) => classe(t) === k).length]));
  const fw = Object.fromEntries(["gauche", "fairway", "droite", "court", "long"].map((k) => [k, F.filter((t) => t.fw === k).length]));
  const sable = T.filter((t) => t.bunker), sauve = sable.filter((t) => t.score <= t.par);
  const parCtx = CONTEXTES.map(([k, l]) => { const X = R.filter((r) => r.p.contexte === k); return { k, l, n: X.length, moy: X.length ? X.reduce((s, r) => s + r.ecart18, 0) / X.length : null }; });
  return {
    nbParties: P.length, nbTrous: T.length, R,
    ecart18: R.length ? R.reduce((s, r) => s + r.ecart18, 0) / R.length : null,
    meilleur: R.filter((r) => r.n === 18).sort((a, b) => a.score - b.score)[0] || null,
    putts18: C.length ? (C.reduce((s, t) => s + t.putts, 0) * 18) / C.length : null,
    puttsTrou: C.length ? C.reduce((s, t) => s + t.putts, 0) / C.length : null,
    un: pct(C.filter((t) => t.putts <= 1).length, C.length), trois: pct(C.filter((t) => t.putts >= 3).length, C.length),
    fwPct: pct(fw.fairway, F.length), fw, nbFw: F.length,
    girPct: pct(C.filter(gir).length, C.length), nbGir: C.length,
    pen18: T.length ? (T.reduce((s, t) => s + (t.pen || 0), 0) * 18) / T.length : null,
    sable: sable.length, sauve: pct(sauve.length, sable.length),
    parType, repart, parCtx,
  };
}

// ------------------------------------------------------------------ rendu
const tuile = (val, lib, sous = "", titre = "") => `<div class="st-tuile"${titre ? ` title="${esc(titre)}"` : ""}><b>${val}</b><span>${lib}</span>${sous ? `<small>${sous}</small>` : ""}</div>`;
function rendreFiltres() {
  $("st-filtres").innerHTML = `<div class="seg" role="group" aria-label="Période">${PERIODES.map(([k, l]) => `<button type="button" data-periode="${k}" aria-pressed="${etat.periode === k}">${l}</button>`).join("")}</div>
    <div class="st-ctx" role="group" aria-label="Contextes">${CONTEXTES.map(([k, l]) => `<button type="button" data-ctx="${k}" aria-pressed="${etat.contextes.has(k)}">${l}</button>`).join("")}</div>`;
  $("st-qui").innerHTML = Compte.joueurs.length ? `<select id="st-joueur" aria-label="Stats de"><option value="">Mes stats</option>${Compte.joueurs.map((j) =>
    `<option value="${esc(j.joueur_id)}" ${j.joueur_id === etat.vue ? "selected" : ""}>Stats de ${esc(j.nom || j.libelle || "joueur")}</option>`).join("")}</select>` : "";
}
function rendre() {
  rendreFiltres();
  const jv = etat.vue && Compte.joueurs.find((j) => j.joueur_id === etat.vue);   // coach : bande jaune et raccourcis
  nexusBandeVue(jv && !etat.cadre ? jv.nom || jv.libelle || "Joueur" : "", "stats", () => {
    nexusJoueurVu.ecrire(Compte.moi?.id, ""); if (location.hash.length > 1) location.hash = ""; else lireLien(); });
  const qui = etat.vue ? ` · ${esc(Compte.joueurs.find((j) => j.joueur_id === etat.vue)?.nom || "joueur")}` : "";
  $("st-filtres").hidden = !!etat.focus;
  if (etat.focus) { $("st-titre").innerHTML = (etat.focus.type === "partie" ? "Stats du tour" : "Stats du tournoi") + qui; rendreFocus(); return; }
  $("st-titre").textContent = etat.vue ? "Stats du joueur" : "Mes stats";
  const box = $("st-contenu"), P = filtrees();
  if (!etat.parties.length) {
    box.innerHTML = `<div class="bloc vide"><p><b>${etat.vue ? "Ce joueur n'a encore saisi aucune carte." : "Pas encore de carte saisie."}</b></p>${etat.vue ? "" : `<p class="meta">Tes stats se construisent à partir de tes cartes : note ta prochaine partie dans Carte.</p><a class="btn plein" href="../carte/">Ouvrir Carte</a>`}</div>`;
    return;
  }
  if (!P.length) { box.innerHTML = `<div class="bloc vide"><p>Aucune partie (9 trous saisis au moins) pour ces filtres.</p></div>`; return; }
  const s = calculer(P);
  box.innerHTML = `
    <p class="meta st-base">Sur <b>${s.nbParties} partie${s.nbParties > 1 ? "s" : ""}</b> (${s.nbTrous} trous) · moyennes ramenées à 18 trous</p>
    <div class="st-tuiles">
      ${tuile(signe(s.ecart18), "écart au par", s.meilleur ? `meilleure carte : ${s.meilleur.score} (${signe(s.meilleur.ecart, 0)})` : "", "Moyenne de l'écart au par, par partie, ramené à 18 trous")}
      ${tuile(virgule(s.putts18), "putts par partie", s.puttsTrou != null ? `${virgule(s.puttsTrou, 2)} par trou` : "")}
      ${tuile(s.fwPct != null ? s.fwPct + " %" : "—", "fairways touchés", s.nbFw ? `${s.fw.fairway} sur ${s.nbFw} départs (par 4 et 5)` : "")}
      ${tuile(s.girPct != null ? s.girPct + " %" : "—", "greens en régulation", s.nbGir ? `sur ${s.nbGir} trous` : "", "Green atteint en (par − 2) coups ou moins")}
      ${tuile(virgule(s.pen18), "pénalités par partie")}
    </div>

    <div class="st-grille">
      <section class="bloc st-bloc st-large" aria-labelledby="t-evol"><h3 id="t-evol">Évolution <small>écart au par, partie après partie (ramené à 18 trous)</small></h3>${graphEvolution(s.R)}</section>

      <section class="bloc st-bloc" aria-labelledby="t-rep"><h3 id="t-rep">Répartition des scores <small>sur ${s.nbTrous} trous</small></h3>${barreRepartition(s.repart, s.nbTrous)}</section>

      <section class="bloc st-bloc" aria-labelledby="t-par"><h3 id="t-par">Par 3, par 4, par 5 <small>écart moyen au par, par trou</small></h3>
        <div class="st-pars">${s.parType.map((x) => `<div><span>Par ${x.par}</span><b>${signe(x.moy, 2)}</b><small>${x.n} trou${x.n > 1 ? "s" : ""}</small></div>`).join("")}</div></section>

      <section class="bloc st-bloc" aria-labelledby="t-putt"><h3 id="t-putt">Putting</h3>
        <div class="st-pars"><div><span>1 putt ou moins</span><b>${s.un != null ? s.un + " %" : "—"}</b><small>des trous</small></div>
          <div><span>3 putts ou plus</span><b>${s.trois != null ? s.trois + " %" : "—"}</b><small>des trous</small></div>
          <div><span>Par trou</span><b>${virgule(s.puttsTrou, 2)}</b><small>putts</small></div></div></section>

      <section class="bloc st-bloc" aria-labelledby="t-dep"><h3 id="t-dep">Mises en jeu <small>${s.nbFw} départs (par 4 et 5)</small></h3>${terrainFw(s.fw, s.nbFw)}</section>

      <section class="bloc st-bloc" aria-labelledby="t-sable"><h3 id="t-sable">Bunkers</h3>
        <div class="st-pars"><div><span>Trous avec bunker</span><b>${s.sable}</b><small>sur ${s.nbTrous}</small></div>
          <div><span>Par ou mieux malgré le bunker</span><b>${s.sauve != null ? s.sauve + " %" : "—"}</b><small>(sauvetage)</small></div></div></section>

      <section class="bloc st-bloc st-large" aria-labelledby="t-ctx"><h3 id="t-ctx">Selon la pression <small>écart moyen au par (18 trous), du plus calme au plus exigeant</small></h3>${barresContexte(s.parCtx)}</section>

      <section class="bloc st-bloc st-large" aria-labelledby="t-tab"><h3 id="t-tab">Les parties <small>tableau des chiffres</small></h3>${tableau(s.R)}</section>
    </div>`;
  brancherBulle();
}

// ---- évolution : une courbe (un seul axe), une marque par partie, bulle au survol
function graphEvolution(R) {
  const L = R.slice().sort((a, b) => (a.p.jour + a.p.cree_le).localeCompare(b.p.jour + b.p.cree_le));
  if (L.length < 2) return `<p class="meta">Il faut au moins deux parties pour tracer une évolution.</p>`;
  const W = 960, H = 260, g = 44, d = 14, h = 16, b = 30;   // repère large : textes à ~11 px sur ordinateur
  const vals = L.map((r) => r.ecart18), min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const pas = Math.max(2, Math.ceil((max - min) / 5 / 2) * 2), y0 = Math.floor(min / pas) * pas, y1 = Math.ceil(max / pas) * pas || pas;
  const X = (i) => g + (i * (W - g - d)) / (L.length - 1), Y = (v) => h + ((y1 - v) * (H - h - b)) / (y1 - y0 || 1);
  let grille = "";
  for (let v = y0; v <= y1; v += pas) grille += `<line x1="${g}" x2="${W - d}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? "st-axe0" : "st-grille-l"}"/><text x="${g - 8}" y="${Y(v) + 4}" class="st-axe-t" text-anchor="end">${v === 0 ? "par" : (v > 0 ? "+" : "−") + Math.abs(v)}</text>`;
  const etiquettes = L.map((r, i) => (i === 0 || i === L.length - 1 || L.length <= 8 ? `<text x="${X(i)}" y="${H - 8}" class="st-axe-t" text-anchor="middle">${dateCourte(r.p.jour)}</text>` : "")).join("");
  const ligne = L.map((r, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(r.ecart18).toFixed(1)}`).join(" ");
  const points = L.map((r, i) => `<circle cx="${X(i)}" cy="${Y(r.ecart18)}" r="4.5" class="st-pt"/>
    <rect x="${X(i) - 14}" y="${h}" width="28" height="${H - h - b}" class="st-cible" data-bulle="${esc(`${dateCourte(r.p.jour)} · ${titre(r.p.golf_nom || r.p.golf)}\n${LIB_CTX[r.p.contexte] || ""} · ${r.score} sur ${r.n} trous (${signe(r.ecart, 0)})${r.n < 18 ? ` → ${signe(r.ecart18)} sur 18` : ""}${r.putts18 != null ? `\n${virgule(r.putts18)} putts (18 trous)` : ""}`)}"/>`).join("");
  return `<div class="st-graph"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de l'écart au par sur ${L.length} parties">${grille}${etiquettes}<path d="${ligne}" class="st-ligne"/>${points}</svg></div>`;
}
// ---- répartition : une barre segmentée (≤ 6 parts), parts écrites dessus, légende
function barreRepartition(rep, n) {
  const segs = CLASSES.filter(([k]) => rep[k]).map(([k, l, c]) => { const p = (100 * rep[k]) / n;
    return `<span style="flex:${rep[k]};background:${c}" class="st-seg${k === "par" ? " clair" : ""}" data-bulle="${esc(`${l} : ${rep[k]} trou${rep[k] > 1 ? "s" : ""} (${Math.round(p)} %)`)}">${p >= 7 ? Math.round(p) + " %" : ""}</span>`; }).join("");
  return `<div class="st-barre">${segs}</div><div class="st-legende">${CLASSES.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} <b>${rep[k]}</b></span>`).join("")}</div>`;
}
// ---- mises en jeu : le fairway vu de dessus (comme dans Carte), une part par zone
function terrainFw(fw, n) {
  if (!n) return `<p class="meta">Pas encore de mise en jeu saisie (zone touchée dans Carte).</p>`;
  const z = (k, lib) => `<div class="fw-zone fw-${k}"><b>${pct(fw[k], n)} %</b><span>${lib}</span></div>`;
  return `<div class="fw-terrain">${z("long", "Long")}${z("gauche", "Gauche")}${z("fairway", "Fairway")}${z("droite", "Droite")}${z("court", "Court")}<span class="fw-depart">▲ départ</span></div>`;
}
// ---- selon la pression : une barre par contexte, valeur écrite, ordre fixe (calme → exigeant)
function barresContexte(L) {
  const X = L.filter((x) => x.n);
  if (!X.length) return "";
  const max = Math.max(1, ...X.map((x) => Math.abs(x.moy)));
  return `<div class="st-ctx-barres">${L.map((x) => `<div class="st-ctx-l${x.n ? "" : " vide"}"><span>${x.l}</span>
    <div class="st-ctx-piste">${x.n ? `<i style="width:${(100 * Math.abs(x.moy)) / max}%" class="${x.moy < 0 ? "sous" : ""}" data-bulle="${esc(`${x.l} : ${signe(x.moy)} en moyenne sur ${x.n} partie${x.n > 1 ? "s" : ""}`)}"></i>` : ""}</div>
    <b>${x.n ? signe(x.moy) : "—"}</b><small>${x.n ? `${x.n} partie${x.n > 1 ? "s" : ""}` : "aucune"}</small></div>`).join("")}</div>
    <p class="meta">Un écart qui grandit avec la pression signale un problème de transfert entraînement → jeu plutôt que de technique.</p>`;
}
// ---- tableau (vue accessible de toutes les valeurs) ; les tours d'un même tournoi sont regroupés sur une ligne qui se déplie
function chiffres(P) {
  const b = bilan(P);
  return `<td class="n">${b.n}</td><td class="n"><b>${b.score}</b></td><td class="n">${signe(b.ecart, 0)}</td><td class="n">${b.putts != null ? b.putts : "—"}</td>
    <td class="n">${b.nF ? `${b.fw}/${b.nF}` : "—"}</td><td class="n">${b.nC ? `${b.gir}/${b.nC}` : "—"}</td>`;
}
function tableau(R) {
  const groupes = new Map();
  for (const r of R) { const k = r.p.tournoi_id || "p:" + r.p.id; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(r.p); }
  const G = [...groupes.entries()].map(([k, P]) => ({ k, P: P.sort((a, b) => (a.tour || 1) - (b.tour || 1) || a.jour.localeCompare(b.jour)) }))
    .sort((a, b) => b.P.at(-1).jour.localeCompare(a.P.at(-1).jour));
  const ligne = (p, enfant) => `<tr class="${enfant ? "st-enfant" : ""}"><td>${dateCourte(p.jour)}</td><td><a href="${lienPartie(p)}">${enfant ? `Tour ${p.tour || "?"}` : esc(titre(p.golf_nom || p.golf))}</a></td><td>${enfant ? "" : LIB_CTX[p.contexte] || ""}</td>${chiffres([p])}</tr>`;
  return `<div class="defile"><table class="st-table"><thead><tr><th>Date</th><th>Partie</th><th>Contexte</th><th class="n">Trous</th><th class="n">Score</th><th class="n">Écart</th><th class="n">Putts</th><th class="n">Fairways</th><th class="n">GIR</th></tr></thead><tbody>
    ${G.map(({ k, P }) => { if (P.length < 2) return ligne(P[0]);
      const ouvert = etat.ouverts.has(k), d1 = dateCourte(P[0].jour), d2 = dateCourte(P.at(-1).jour);
      return `<tr class="st-groupe"><td>${d1}${d1 !== d2 ? ` → ${d2}` : ""}</td><td><button type="button" class="st-deplier" data-deplier="${esc(k)}" aria-expanded="${ouvert}" aria-label="${ouvert ? "Replier" : "Déplier"} les tours">${ouvert ? "▾" : "▸"}</button> <a href="${lienTournoi(k)}">${esc(nomTournoi(k, P))}</a> <span class="tag">${P.length} tours</span></td><td>${LIB_CTX[P[0].contexte] || ""}</td>${chiffres(P)}</tr>
        ${ouvert ? P.map((p) => ligne(p, true)).join("") : ""}`; }).join("")}
    </tbody></table></div>
    <p class="meta">Clique une partie pour voir ses stats ; un tournoi regroupe ses tours (▸ pour les déplier).</p>`;
}
// ------------------------------------------------------------------ vue Tour et vue Tournoi (lien #partie=… ou #tournoi=…)
// Un tournoi = les cartes qui portent le même tournoi_id (tournoi ffgolf ou « club:<id> » pour un événement du coach),
// rangées par tour. Chaque tour a sa stat ; le tournoi additionne les tours. Comparaison : ta moyenne sur tes autres parties.
const somme = (L, f) => L.reduce((s, x) => s + f(x), 0);
function bilan(P) {   // chiffres bruts (pas ramenés à 18 trous) d'une ou plusieurs cartes
  const T = P.flatMap(joues), C = T.filter((t) => t.putts != null && coherent(t)), F = T.filter((t) => t.par > 3 && t.fw), S = T.filter((t) => t.bunker);
  return { n: T.length, score: somme(T, (t) => t.score), ecart: somme(T, (t) => t.score - t.par),
    putts: C.length ? somme(C, (t) => t.putts) : null, nC: C.length, un: C.filter((t) => t.putts <= 1).length, trois: C.filter((t) => t.putts >= 3).length,
    gir: C.filter(gir).length, fw: F.filter((t) => t.fw === "fairway").length, nF: F.length,
    fwz: Object.fromEntries(["gauche", "fairway", "droite", "court", "long"].map((k) => [k, F.filter((t) => t.fw === k).length])),
    pen: somme(T, (t) => t.pen || 0), sable: S.length, sauve: S.filter((t) => t.score <= t.par).length,
    parType: [3, 4, 5].map((par) => { const X = T.filter((t) => t.par === par); return { par, n: X.length, moy: X.length ? somme(X, (t) => t.score - t.par) / X.length : null }; }),
    repart: Object.fromEntries(CLASSES.map(([k]) => [k, T.filter((t) => classe(t) === k).length])) };
}
const tournoiDe = (p) => (p.tournoi_id ? etat.parties.filter((x) => x.tournoi_id === p.tournoi_id && joues(x).length)
  .sort((a, b) => (a.tour || 1) - (b.tour || 1) || (a.jour + a.cree_le).localeCompare(b.jour + b.cree_le)) : []);
const nomTournoi = (ref, P) => etat.noms.get(ref) || titre(P[0]?.golf_nom || P[0]?.golf || "Tournoi");
const suite = () => `${etat.vue ? `&joueur=${encodeURIComponent(etat.vue)}` : ""}${etat.cadre ? "&cadre=1" : ""}`;
const lienPartie = (p) => `#partie=${encodeURIComponent(p.id)}${suite()}`;
const lienTournoi = (ref) => `#tournoi=${encodeURIComponent(ref)}${suite()}`;
// onglets d'un tournoi à plusieurs tours : Tour 1 · Tour 2 · … · Tournoi (actif : id de la partie, ou "tournoi")
const onglets = (T, actif) => (T.length > 1 ? `<nav class="st-onglets" aria-label="Tours du tournoi">${T.map((p, i) =>
  `<a href="${lienPartie(p)}"${p.id === actif ? ` aria-current="page"` : ""}>Tour ${p.tour || i + 1}</a>`).join("")}<a href="${lienTournoi(T[0].tournoi_id)}"${actif === "tournoi" ? ` aria-current="page"` : ""}>Tournoi · ${T.length} tours</a></nav>` : "");
// ta moyenne habituelle (toutes tes autres cartes d'au moins 9 trous), ramenée à n trous pour comparer à ce tour
function moyenneHors(ids) {
  const A = etat.parties.filter((p) => !ids.has(p.id) && joues(p).length >= 9);
  return A.length ? { ...calculer(A), nb: A.length } : null;
}
const aN = (v18, n) => (v18 == null ? null : (v18 * n) / 18);
const cmp = (txt) => (txt ? `<small class="st-moy">ta moyenne : ${txt}</small>` : "");

function rendreFocus() {
  const box = $("st-contenu"), f = etat.focus;
  const retour = `<a class="st-retour" href="#${etat.vue ? `joueur=${encodeURIComponent(etat.vue)}` : ""}">← Toutes les stats</a>`;
  if (f.type === "partie") {
    const p = etat.parties.find((x) => x.id === f.id);
    if (!p) { box.innerHTML = `${retour}<div class="bloc vide"><p>Cette carte est introuvable (supprimée, ou pas à ce compte).</p></div>`; return; }
    const T = tournoiDe(p), b = bilan([p]), m = moyenneHors(new Set([p.id]));
    const rang = onglets(T, p.id);
    if (!b.n) { box.innerHTML = `${retour}${rang}<div class="bloc vide"><p>Aucun trou saisi pour l'instant sur cette carte.</p></div>`; return; }
    box.innerHTML = `${retour}
      <div class="st-entete"><h3>${esc(titre(p.golf_nom || p.golf))}${p.tour ? ` · tour ${p.tour}` : ""}</h3>
        <p class="meta">${new Date(p.jour + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${LIB_CTX[p.contexte] || ""}${p.parcours_nom ? ` · ${esc(p.parcours_nom)}` : ""}${p.repere ? ` · repère ${esc(p.repere)}` : ""} · ${b.n} trou${b.n > 1 ? "s" : ""}${p.terminee ? "" : " · en cours"}</p>${rang}</div>
      ${blocsBilan(b, m)}`;
  } else {
    const T = etat.parties.filter((x) => x.tournoi_id === f.ref && joues(x).length)
      .sort((a, b) => (a.tour || 1) - (b.tour || 1) || (a.jour + a.cree_le).localeCompare(b.jour + b.cree_le));
    if (!T.length) { box.innerHTML = `${retour}<div class="bloc vide"><p>Aucune carte pour ce tournoi.</p></div>`; return; }
    const B = T.map((p) => bilan([p])), tot = bilan(T), m = moyenneHors(new Set(T.map((p) => p.id)));
    box.innerHTML = `${retour}
      <div class="st-entete"><h3>${esc(nomTournoi(f.ref, T))}</h3>
        <p class="meta">${T.length} tour${T.length > 1 ? "s" : ""} saisi${T.length > 1 ? "s" : ""} · ${dateCourte(T[0].jour)}${T.length > 1 && T.at(-1).jour !== T[0].jour ? ` → ${dateCourte(T.at(-1).jour)}` : ""} · ${esc(titre(T[0].golf_nom || T[0].golf))}</p>${onglets(T, "tournoi")}</div>
      <section class="bloc st-bloc st-tour-tab" aria-labelledby="t-tours"><h3 id="t-tours">Tour par tour <small>et total du tournoi</small></h3>${tableauTours(T, B, tot, m)}</section>
      <h3 class="st-sous-titre">Total du tournoi</h3>
      ${blocsBilan(tot, m, T.length)}`;
  }
  brancherBulle();
}
// tuiles + blocs d'une carte ou d'un tournoi (nbTours : pour comparer un total à ta moyenne × nombre de tours)
function blocsBilan(b, m, nbTours = 1) {
  const moyScore = m ? `${signe(aN(m.ecart18, b.n))}` : "";
  return `<div class="st-tuiles">
      ${tuile(`${b.score} <small>(${signe(b.ecart, 0)})</small>`, "score", cmp(moyScore && `${moyScore} sur ${b.n} trous`))}
      ${tuile(b.putts != null ? b.putts : "—", "putts", cmp(m?.putts18 != null && b.nC ? virgule(aN(m.putts18, b.nC)) : ""))}
      ${tuile(b.nF ? `${b.fw}/${b.nF}` : "—", "fairways touchés", (b.nF ? `<small>${pct(b.fw, b.nF)} %</small>` : "") + cmp(m?.fwPct != null && b.nF ? `${m.fwPct} %` : ""))}
      ${tuile(b.nC ? `${b.gir}/${b.nC}` : "—", "greens en régulation", (b.nC ? `<small>${pct(b.gir, b.nC)} %</small>` : "") + cmp(m?.girPct != null && b.nC ? `${m.girPct} %` : ""), "Green atteint en (par − 2) coups ou moins")}
      ${tuile(b.pen, "pénalités", cmp(m?.pen18 != null ? virgule(aN(m.pen18, b.n)) : ""))}
    </div>
    ${m ? `<p class="meta st-base">Comparaison avec ta moyenne sur tes ${m.nb} autre${m.nb > 1 ? "s" : ""} partie${m.nb > 1 ? "s" : ""}, ramenée au même nombre de trous${nbTours > 1 ? ` (${nbTours} tours)` : ""}.</p>` : ""}
    <div class="st-grille">
      <section class="bloc st-bloc" aria-labelledby="f-rep"><h3 id="f-rep">Répartition des scores <small>sur ${b.n} trous</small></h3>${barreRepartition(b.repart, b.n)}</section>
      <section class="bloc st-bloc" aria-labelledby="f-par"><h3 id="f-par">Par 3, par 4, par 5 <small>écart moyen au par, par trou</small></h3>
        <div class="st-pars">${b.parType.map((x, i) => `<div><span>Par ${x.par}</span><b>${x.n ? signe(x.moy, 2) : "—"}</b><small>${x.n} trou${x.n > 1 ? "s" : ""}${m?.parType[i].moy != null ? ` · moy. ${signe(m.parType[i].moy, 2)}` : ""}</small></div>`).join("")}</div></section>
      <section class="bloc st-bloc" aria-labelledby="f-putt"><h3 id="f-putt">Putting</h3>
        <div class="st-pars"><div><span>1 putt ou moins</span><b>${b.nC ? b.un : "—"}</b><small>trou${b.un > 1 ? "s" : ""}${m?.un != null ? ` · moy. ${m.un} %` : ""}</small></div>
          <div><span>3 putts ou plus</span><b>${b.nC ? b.trois : "—"}</b><small>trou${b.trois > 1 ? "s" : ""}${m?.trois != null ? ` · moy. ${m.trois} %` : ""}</small></div>
          <div><span>Par trou</span><b>${b.nC ? virgule(b.putts / b.nC, 2) : "—"}</b><small>putts${m?.puttsTrou != null ? ` · moy. ${virgule(m.puttsTrou, 2)}` : ""}</small></div></div></section>
      <section class="bloc st-bloc" aria-labelledby="f-dep"><h3 id="f-dep">Mises en jeu <small>${b.nF} départ${b.nF > 1 ? "s" : ""} (par 4 et 5)</small></h3>${terrainFw(b.fwz, b.nF)}</section>
      <section class="bloc st-bloc st-large" aria-labelledby="f-sable"><h3 id="f-sable">Bunkers</h3>
        <div class="st-pars"><div><span>Trous avec bunker</span><b>${b.sable}</b><small>sur ${b.n}</small></div>
          <div><span>Par ou mieux malgré le bunker</span><b>${b.sable ? b.sauve : "—"}</b><small>sur ${b.sable}${m?.sauve != null ? ` · moy. ${m.sauve} %` : ""}</small></div></div></section>
    </div>`;
}
// tableau tour par tour : une colonne par tour, puis le total, puis ta moyenne par tour (18 trous)
function tableauTours(T, B, tot, m) {
  const L = [
    ["Trous", (b) => b.n, ""],
    ["Score", (b) => `<b>${b.score}</b>`, ""],
    ["Écart au par", (b) => signe(b.ecart, 0), m ? signe(m.ecart18) : "—"],
    ["Putts", (b) => (b.putts != null ? b.putts : "—"), m?.putts18 != null ? virgule(m.putts18) : "—"],
    ["1 putt ou moins", (b) => (b.nC ? b.un : "—"), ""],
    ["3 putts ou plus", (b) => (b.nC ? b.trois : "—"), ""],
    ["Fairways", (b) => (b.nF ? `${b.fw}/${b.nF}` : "—"), m?.fwPct != null ? m.fwPct + " %" : "—"],
    ["Greens en régulation", (b) => (b.nC ? `${b.gir}/${b.nC}` : "—"), m?.girPct != null ? m.girPct + " %" : "—"],
    ["Pénalités", (b) => b.pen, m?.pen18 != null ? virgule(m.pen18) : "—"],
    ["Bunkers (sauvés)", (b) => (b.sable ? `${b.sable} (${b.sauve})` : "0"), ""],
    ...[0, 1, 2].map((i) => [`Par ${3 + i}`, (b) => (b.parType[i].n ? signe(b.parType[i].moy, 2) : "—"), m?.parType[i].moy != null ? signe(m.parType[i].moy, 2) : "—"]),
  ];
  return `<div class="defile"><table class="st-table st-tours"><thead><tr><th></th>${T.map((p, i) => `<th class="n"><a href="${lienPartie(p)}" title="Stats de ce tour">Tour ${p.tour || i + 1}</a><small>${dateCourte(p.jour)}</small></th>`).join("")}<th class="n st-total">Total</th>${m ? `<th class="n st-hab">Ta moyenne<small>par partie de 18</small></th>` : ""}</tr></thead><tbody>
    ${L.map(([lib, f, hab]) => `<tr><th scope="row">${lib}</th>${B.map((b) => `<td class="n">${f(b)}</td>`).join("")}<td class="n st-total">${f(tot)}</td>${m ? `<td class="n st-hab">${hab}</td>` : ""}</tr>`).join("")}
  </tbody></table></div>`;
}

// ---- bulle au survol (et au toucher) des marques
function brancherBulle() {
  let bulle = $("st-bulle");
  if (!bulle) { bulle = document.createElement("div"); bulle.id = "st-bulle"; bulle.className = "st-bulle"; bulle.hidden = true; document.body.append(bulle); }
  const montrer = (e) => { const c = e.target.closest("[data-bulle]"); if (!c) { bulle.hidden = true; return; }
    bulle.textContent = c.dataset.bulle; bulle.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - bulle.offsetWidth - 8), y = Math.max(8, e.clientY - bulle.offsetHeight - 10);
    bulle.style.left = x + "px"; bulle.style.top = y + "px"; };
  $("st-contenu").onmousemove = montrer; $("st-contenu").onclick = montrer; $("st-contenu").onmouseleave = () => { bulle.hidden = true; };
}

// ------------------------------------------------------------------ filtres
document.addEventListener("click", (e) => {
  const dp = e.target.closest("[data-deplier]"); if (dp) { const k = dp.dataset.deplier; if (etat.ouverts.has(k)) etat.ouverts.delete(k); else etat.ouverts.add(k); rendre(); return; }
  const p = e.target.closest("[data-periode]"); if (p) { etat.periode = p.dataset.periode; rendre(); return; }
  const c = e.target.closest("[data-ctx]");
  if (c) { const k = c.dataset.ctx; if (etat.contextes.has(k) && etat.contextes.size > 1) etat.contextes.delete(k); else etat.contextes.add(k); rendre(); }
});
document.addEventListener("change", (e) => { if (e.target.id === "st-joueur") nexusJoueurVu.ecrire(Compte.moi?.id, e.target.value, Compte.joueurs.find((j) => j.joueur_id === e.target.value)?.nom); });
document.addEventListener("change", (e) => { if (e.target.id === "st-joueur") location.hash = e.target.value ? `joueur=${encodeURIComponent(e.target.value)}` : ""; });

// ------------------------------------------------------------------ données et démarrage
async function charger() {
  $("st-contenu").innerHTML = `<p class="meta">Chargement…</p>`;
  const { data, error } = await sb.from("carte_parties").select("*").eq("user_id", etat.vue || Compte.moi.id).order("jour", { ascending: true });
  if (error) { etat.parties = []; signaler("Lecture des cartes impossible : " + error.message); return; }
  etat.parties = data || [];
  await chargerNoms();
}
// noms des tournois : événements du coach (club_evenements) et tournois ffgolf (données publiées, seulement si besoin)
async function chargerNoms() {
  const refs = [...new Set(etat.parties.map((p) => p.tournoi_id).filter(Boolean))].filter((r) => !etat.noms.has(r));
  const club = refs.filter((r) => r.startsWith("club:")).map((r) => r.slice(5)), ff = refs.filter((r) => !r.startsWith("club:"));
  if (club.length) { const { data } = await sb.from("club_evenements").select("id,nom").in("id", club); for (const e of data || []) etat.noms.set("club:" + e.id, e.nom); }
  if (ff.length) { try { const T = (await telechargerDonnees()).tournois || []; const parId = new Map(T.map((t) => [String(t.id), t.nom]));
    for (const r of ff) if (parId.has(String(r))) etat.noms.set(r, titre(parId.get(String(r)))); } catch { /* le nom du golf suffit */ } }
}
// lien direct : #partie=<id> · #tournoi=<ref> · &joueur=<id> (coach : stats d'un joueur suivi)
async function lireLien() {
  // sans « joueur » dans le lien : le joueur regardé dans un autre module (Saison, Carte)
  const h = new URLSearchParams(location.hash.slice(1)), j = h.has("joueur") ? h.get("joueur") : nexusJoueurVu.lire(Compte.moi?.id);
  etat.cadre = h.get("cadre") === "1"; document.body.classList.toggle("cadre", etat.cadre);
  const vue = Compte.joueurs.some((x) => x.joueur_id === j) ? j : "";
  if (vue !== etat.vue) { etat.vue = vue; await charger(); }
  nexusJoueurVu.ecrire(Compte.moi?.id, vue, Compte.joueurs.find((j) => j.joueur_id === vue)?.nom);
  etat.focus = h.get("partie") ? { type: "partie", id: h.get("partie") } : h.get("tournoi") ? { type: "tournoi", ref: h.get("tournoi") } : null;
  rendre(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { if (demarre) lireLien(); });
let demarre = false;
async function entrer() {   // pas de données publiées ici : seulement le compte et les cartes
  if (demarre) return;
  demarre = true;
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  rendreCompte();
  await charger(); await lireLien();
}
// lien public (#direct=<jeton>) : la carte partagée seulement, sans compte, lue par carte_partagee (comme le direct de Carte).
// Stats de ce tour uniquement : pas de comparaison (la personne n'a pas accès aux autres parties du joueur), relue toutes les 15 s.
async function modeDirect(jeton) {
  etat.cadre = true; document.body.classList.add("cadre");
  finReprise(); document.body.classList.remove("verrou");
  const lire = async () => {
    const { data, error } = await sb.rpc("carte_partagee", { j: jeton });
    const p = Array.isArray(data) ? data[0] : data;
    if (error || !p) { $("st-contenu").innerHTML = `<div class="bloc vide"><p><b>Ce lien de partage n'est plus valable.</b></p><p class="meta">Il a expiré ou le joueur a arrêté le partage.</p></div>`; return false; }
    etat.parties = [{ ...p, id: "direct", cree_le: "" }]; etat.focus = { type: "partie", id: "direct" }; rendre();
    return !p.terminee;
  };
  let enDirect = await lire();
  const relire = async () => { if (enDirect) enDirect = await lire(); };
  setInterval(relire, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) relire(); });
}
const jetonDirect = new URLSearchParams(location.hash.slice(1)).get("direct");
if (sb && jetonDirect) modeDirect(jetonDirect);
else { nexusBrancherAccueil(); if (sb) nexusDemarrer(entrer); }
