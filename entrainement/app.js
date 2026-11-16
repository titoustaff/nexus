"use strict";
// Entraînement — module n° 5 de la suite GolfNexus (V1, 16/11/2026).
// Catalogue (exercices + séances types, exercices.js) → séance (conditions du jour, exercices enchaînés, un appui par balle)
// → historique (score et niveau d'une fois à l'autre). Table entrainement_seances (supabase/entrainement-v1.sql).
// Hors réseau : la séance en cours vit dans le navigateur (localStorage) et part vers la base dès que possible.

const $ = (id) => document.getElementById(id);
const etat = { vue: "", filtre: "tout", seance: null, seances: [], envoi: "ok", minuteur: null, confirmer: null };
const exo = (id) => EXERCICES.find((e) => e.id === id);
const fr = (x, d = 1) => (x == null || Number.isNaN(x) ? "—" : (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("fr-FR"));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const nivHaut = (v, b) => { const i = b.findIndex((x) => v >= x); return i < 0 ? 5 : i; };   // points : plus haut = mieux
const nivBas = (v, b) => { const i = b.findIndex((x) => v <= x); return i < 0 ? 5 : i; };    // dispersion, séries ratées : plus bas = mieux
const mediane = (a) => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const pastille = (i, approx) => (i == null ? "" : `<span class="en-niv en-n${i}">${NIVEAUX[i]}${approx ? " (approché)" : ""}</span>`);

// ------------------------------------------------------------------ compte (comme Stats)
const Compte = {
  moi: null, user: null, role: "joueur", fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, mineur: P.mineur, parentValide: P.parentValide, fiche: P.fiche });
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

// ------------------------------------------------------------------ calculs (un exercice, sa saisie brute r)
const titreLigne = (l, cond) => (cond?.s === "F" && l.tF ? l.tF : l.t);
function calc(e, r) {
  if (e.type === "spirale") {
    const L = r.L || [], fini = L.includes("ok") || L.length >= 10, rates = L.filter((x) => x !== "ok").length, ten = {}, ok = {};
    for (let d = 2; d <= 7; d++) { ten[d] = 0; ok[d] = 0; }
    L.forEach((x) => { const fin = x === "ok" ? 7 : x; for (let d = 2; d <= fin; d++) { ten[d]++; if (x === "ok" || d < x) ok[d]++; } });
    return { fini, score: rates, niv: fini ? nivBas(rates, e.niv) : null, ten, ok, n: L.length };
  }
  if (e.type === "mesure") { const L = r.L || []; return { fini: L.length >= e.n, best: L.length ? Math.max(...L) : null, n: L.length }; }
  const nl = e.lignes.length, L = r.L || [];
  const Lg = e.lignes.map((l, i) => {
    const C = CHOIX[l.choix], v = L.filter((x, k) => k % nl === i && x).map((x) => ({ x, o: C.L.find((y) => y.c === x.c) })).filter((b) => b.o);
    const pts = v.reduce((a, b) => a + (b.o.p || 0), 0), bon = v.filter((b) => b.o.bon).length, trois = v.filter((b) => b.o.trois).length;
    const complet = v.length === e.tours, vals = v.filter((b) => b.o.v != null).map((b) => b.x.m ?? b.o.v);
    const approx = v.some((b) => b.o.v != null && b.x.m == null), med = l.med && complet ? mediane(vals) : null;
    const cotes = { g: v.filter((b) => b.x.c === "g").length, d: v.filter((b) => b.x.c === "d").length };
    return { n: v.length, pts, bon, trois, complet, med, approx, cotes, niv: !complet ? null : l.niv ? nivHaut(pts, l.niv) : l.med ? nivBas(med, l.med) : null };
  });
  const fini = Lg.every((x) => x.complet), tot = Lg.reduce((a, b) => a + b.pts, 0);
  return { fini, Lg, tot, nivTot: fini && e.nivTot ? nivHaut(tot, e.nivTot) : null, n: Lg.reduce((a, b) => a + b.n, 0), max: e.tours * nl };
}
// le chiffre qui résume un exercice terminé (historique, courbe d'une fois à l'autre)
function principal(e, R, cond) {
  if (!R.fini) return null;
  if (e.type === "spirale") return { val: R.score, txt: `${R.score} série${R.score > 1 ? "s" : ""} ratée${R.score > 1 ? "s" : ""}`, niv: R.niv };
  if (e.type === "mesure") return { val: R.best, txt: `${fr(R.best)} ${e.unite}`, niv: null };
  if (e.score === "points") return { val: R.tot, txt: `${R.tot} points`, niv: R.nivTot };
  const M = R.Lg.filter((x) => x.med != null), moy = M.length ? M.reduce((a, b) => a + b.med, 0) / M.length : null;
  const d = e.lignes.findIndex((l) => l.choix === "drive");
  return { val: moy, txt: `médiane ${fr(moy)} m${d >= 0 ? ` · drive ${R.Lg[d].bon}/${R.Lg[d].n}` : ""}`, niv: null };
}
// résumé enregistré avec la séance (scores) : l'historique et Stats le lisent sans recalculer
function resumer(s) {
  const out = {};
  for (const id of s.exercices) {
    const e = exo(id); if (!e) continue;
    const R = calc(e, s.resultats[id] || {}), P = principal(e, R, s.conditions);
    out[id] = { fini: R.fini, principal: P,
      lignes: R.Lg ? R.Lg.map((x, i) => ({ t: titreLigne(e.lignes[i], s.conditions), n: x.n, pts: x.pts, bon: x.bon, trois: x.trois, med: x.med, niv: x.niv, approx: x.approx || undefined, g: x.cotes.g || undefined, d: x.cotes.d || undefined })) : undefined,
      spirale: e.type === "spirale" ? { score: R.score, niv: R.niv, tentes: R.ten, reussis: R.ok } : undefined,
      mesures: e.type === "mesure" ? s.resultats[id]?.L : undefined };
  }
  return out;
}

// ------------------------------------------------------------------ séance en cours : navigateur d'abord, base ensuite
const cleLocale = () => `gn-entrainement-${Compte.moi?.id || "anon"}`;
function nouvelleSeance(titre, ids, modele = null) {
  const cond = {};
  if (ids.some((id) => exo(id).conds.includes("s"))) cond.s = /^f/i.test(Compte.fiche.sexe || "") ? "F" : "G";   // distances selon ta fiche
  return { id: uuid(), jour: AUJ, titre, modele, exercices: ids, conditions: cond, resultats: Object.fromEntries(ids.map((id) => [id, vide(exo(id))])),
    terminee: false, cur: ids[0], condOuvert: true, local: true };
}
const vide = (e) => (e.type === "grille" ? { L: Array(e.tours * e.lignes.length).fill(null), k: 0, radar: false } : { L: [] });
function garder() {
  const s = etat.seance; if (!s) return;
  lsSet(cleLocale(), JSON.stringify(s));
  etat.envoi = "attente"; clearTimeout(etat.minuteur); etat.minuteur = setTimeout(envoyer, 1200);
}
async function envoyer() {
  const s = etat.seance; if (!s || !Compte.moi) return;
  const ligne = { id: s.id, user_id: Compte.moi.id, jour: s.jour, titre: s.titre, modele: s.modele, exercices: s.exercices, conditions: s.conditions,
    resultats: Object.fromEntries(Object.entries(s.resultats).map(([k, r]) => [k, { L: r.L, radar: r.radar || undefined }])),
    scores: resumer(s), terminee: s.terminee, modifie_le: new Date().toISOString() };
  const { error } = await sb.from("entrainement_seances").upsert(ligne);
  etat.envoi = error ? "attente" : "ok";
  if (!error) { const i = etat.seances.findIndex((x) => x.id === s.id); if (i >= 0) etat.seances[i] = { ...etat.seances[i], ...ligne }; else etat.seances.unshift(ligne); }
  const m = $("en-envoi"); if (m) majEnvoi(m);
}
window.addEventListener("online", () => { if (etat.envoi === "attente") envoyer(); });
const majEnvoi = (m) => { m.className = "en-envoi" + (etat.envoi === "attente" ? " en-attend" : ""); m.textContent = etat.envoi === "attente" ? "Enregistrée sur le téléphone, envoi dès que le réseau revient" : "Enregistrée dans ton compte"; };

// ------------------------------------------------------------------ saisie
const cur = () => exo(etat.seance.cur), rc = () => etat.seance.resultats[etat.seance.cur];
const suivantVide = (A, k) => { for (let j = k + 1; j < A.length; j++) if (!A[j]) return j; return k + 1 < A.length ? k + 1 : k; };
function finSaisie() {
  const s = etat.seance; s.terminee = s.exercices.every((id) => calc(exo(id), s.resultats[id]).fini);
  garder(); rendre();
}
function choisir(val) {
  const e = cur(), r = rc();
  if (e.type === "spirale") { if (calc(e, r).fini) return; r.L.push(val); }
  else if (e.type === "mesure") { if (r.L.length >= e.n) return; r.L.push(val); r.buf = ""; }
  else { r.L[r.k] = val; r.k = suivantVide(r.L, r.k); r.buf = ""; }
  finSaisie();
}
function annuler() {
  const e = cur(), r = rc();
  if (e.type !== "grille") r.L.pop();
  else if (r.L[r.k]) r.L[r.k] = null;
  else { let j = r.k - 1; while (j >= 0 && !r.L[j]) j--; if (j >= 0) { r.L[j] = null; r.k = j; } }
  r.buf = ""; finSaisie();
}
function pave(x) {
  const e = cur(), r = rc(); r.buf = r.buf || "";
  if (x === "ok") {
    if (!r.buf) return; const m = parseFloat(r.buf.replace(",", "."));
    if (Number.isNaN(m)) return;
    if (e.type === "mesure") return choisir(m);
    const C = CHOIX[e.lignes[r.k % e.lignes.length].choix], o = C.L.find((y) => m <= y.max);
    return choisir({ c: o.c, m });
  }
  if (x === ",") { if (!r.buf.includes(",")) r.buf = (r.buf || "0") + ","; }
  else if (r.buf.replace(",", "").length < 4) r.buf = r.buf === "0" ? x : r.buf + x;
  rendre();
}
const avecPave = (e, r) => e.type === "mesure" || (e.type === "grille" && e.radar && r.radar && e.lignes[r.k % e.lignes.length].choix !== "drive");

// ------------------------------------------------------------------ écrans
function rendre() {
  document.querySelectorAll("#vues [data-vue]").forEach((b) => (b.dataset.vue === etat.vue ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  const el = $("ecran");
  el.innerHTML = etat.vue === "catalogue" ? vueCatalogue() : etat.vue === "historique" ? vueHistorique() : vueSeance();
  const m = $("en-envoi"); if (m) majEnvoi(m);
}
const FILTRES = [["tout", "Tout"], ["seances", "Séances types"], ...[...new Set(EXERCICES.map((e) => e.secteur))].map((s) => [s, s])];
function vueCatalogue() {
  const f = etat.filtre;
  const seances = f === "tout" || f === "seances" ? SEANCES_TYPES : [];
  const exos = f === "seances" ? [] : EXERCICES.filter((e) => f === "tout" || e.secteur === f);
  const carteSeance = (x) => `<article class="en-bloc en-fiche"><span class="en-type">Séance type · ${x.exos.length} exercices</span><h3>${esc(x.titre)}</h3><p>${esc(x.resume)}</p>
    <p>${x.exos.map((id) => esc(exo(id).titre)).join(" · ")}</p><div class="en-bas"><span>${x.duree}</span><button type="button" class="btn plein" data-lancer-seance="${x.id}">Commencer</button></div></article>`;
  const carteExo = (e) => `<article class="en-bloc en-fiche"><span class="en-type">Exercice · ${esc(e.secteur)}</span><h3>${esc(e.titre)}</h3><p>${esc(e.resume)}</p>
    <div class="en-bas"><span>${e.duree}</span><button type="button" class="btn" data-lancer-exo="${e.id}">Faire seul</button></div></article>`;
  return `<h2>Catalogue</h2>
    <div class="en-puces" role="group" aria-label="Filtrer le catalogue">${FILTRES.map(([k, l]) => `<button type="button" class="en-puce" aria-pressed="${f === k}" data-filtre="${esc(k)}">${esc(l)}</button>`).join("")}</div>
    ${etat.confirmer?.type === "remplacer" ? `<div class="en-bloc"><p><b>Une séance est en cours (${esc(etat.seance.titre)}).</b> Elle reste dans ton historique, tu pourras la reprendre.</p>
      <div class="en-outils"><button type="button" class="btn plein" data-confirmer-oui>Commencer la nouvelle</button><button type="button" class="btn" data-confirmer-non>Garder la séance en cours</button></div></div>` : ""}
    <div class="en-cartes">${seances.map(carteSeance).join("")}${exos.map(carteExo).join("")}</div>
    <p class="en-note">Premier lot : les exercices de l'évaluation ffgolf. D'autres exercices viendront, et tu pourras composer tes propres séances.</p>`;
}
function vueConds() {
  const s = etat.seance, ks = [...new Set(s.exercices.flatMap((id) => exo(id).conds))], complet = ks.every((k) => s.conditions[k]);
  if (complet && !s.condOuvert) return `<button type="button" class="en-resume-cond" data-cond-ouvrir>Conditions : ${ks.map((k) => `${CONDITIONS[k].t.toLowerCase()} ${CONDITIONS[k].L.find(([v]) => v === s.conditions[k])[1]}`).join(" · ")}<span>modifier</span></button>`;
  return `<div class="en-conds">${complet ? `<button type="button" class="en-resume-cond" data-cond-fermer style="width:auto">Conditions<span>réduire</span></button>` : `<span class="en-lib" style="width:100%">Conditions du jour, une fois pour toute la séance</span>`}
    ${ks.map((k) => `<div class="en-grp"><span class="en-lib">${CONDITIONS[k].t}</span>${CONDITIONS[k].L.map(([v, l]) => `<button type="button" aria-pressed="${s.conditions[k] === v}" data-cond="${k}" data-v="${v}">${l}</button>`).join("")}</div>`).join("")}</div>`;
}
function vueSeance() {
  const s = etat.seance;
  if (!s) return `<div class="en-bloc en-vide"><p><b>Pas de séance en cours.</b></p><p class="meta">Choisis un exercice ou une séance type dans le catalogue.</p><button type="button" class="btn plein" data-vue="catalogue">Ouvrir le catalogue</button></div>`;
  const onglets = s.exercices.map((id) => { const e = exo(id), R = calc(e, s.resultats[id]); return `<button type="button" class="en-puce ${R.fini ? "fait" : ""}" aria-pressed="${s.cur === id}" data-exo="${id}">${esc(e.titre)}</button>`; }).join("")
    + (s.exercices.length > 1 ? `<button type="button" class="en-puce" aria-pressed="${s.cur === "bilan"}" data-exo="bilan">Bilan</button>` : "");
  const tete = `<div class="en-feuille-tete"><h2>${esc(s.titre)}</h2><span id="en-envoi" class="en-envoi"></span></div>`;
  const fin = `<div class="en-outils">${etat.confirmer?.type === "supprimer"
    ? `<span>Supprimer cette séance et tout ce qui a été saisi ?</span><button type="button" class="btn plein" data-supprimer-oui>Supprimer</button><button type="button" class="btn" data-confirmer-non>Garder</button>`
    : `<button type="button" class="btn" data-fermer-seance>${s.terminee ? "Séance terminée : voir l'historique" : "Finir plus tard"}</button><button type="button" class="lien" data-supprimer>Supprimer la séance</button>`}</div>`;
  return `${tete}<div class="en-puces">${onglets}</div>${vueConds()}${s.cur === "bilan" ? vueBilan(s) : vueExo(exo(s.cur), s)}${fin}`;
}
const touche = (i) => `<span class="en-k">${i}</span>`;
const aideHtml = (e) => `<details class="en-aide"><summary>Comment se passe l'exercice ?</summary><ul>${e.aide.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
const paveHtml = () => `<div class="en-pave">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ","].map((x) => `<button type="button" data-pave="${x}">${x}</button>`).join("")}<button type="button" data-pave="ok" class="en-ok">OK</button></div>`;
function vueExo(e, s) {
  const r = s.resultats[e.id], R = calc(e, r), cond = s.conditions;
  const outils = `<div class="en-outils"><button type="button" class="btn" data-annuler>↶ Annuler le dernier</button>${R.fini ? suite(s) : ""}</div>`;
  let saisie, feuille;
  if (e.type === "spirale") {
    saisie = R.fini ? `<div class="en-consigne"><span class="en-fini">Exercice terminé</span><small>${r.L.includes("ok") ? `6 sur 6 à la ${R.n}e série` : "10 séries jouées"}</small></div>`
      : `<div class="en-consigne">Série ${R.n + 1}<small>Un putt raté : touche sa distance. Les 6 rentrés : le gros bouton.</small></div>
        <div class="en-choix en-g6">${[2, 3, 4, 5, 6, 7].map((d, i) => `<button type="button" data-ch="${d}">${d}'${touche(i + 1)}</button>`).join("")}
        <button type="button" class="en-grand" data-ch="ok">✓ 6 sur 6 rentrés ${touche(0)}</button></div>`;
    feuille = `<div class="en-feuille-tete"><h3>Feuille</h3><span>putt raté à chaque série (en pieds) · ✓ = 6 sur 6</span></div><div class="en-defile"><table class="en-feuille">
      <tr><th class="en-lig">Série</th>${Array.from({ length: 10 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
      <tr><th class="en-lig">Putt raté</th>${Array.from({ length: 10 }, (_, i) => { const x = r.L[i]; return `<td><span class="en-case ${x == null ? "en-rien" : ""} ${i === R.n && !R.fini ? "en-cur" : ""}">${x == null ? "·" : x === "ok" ? "✓" : x + "'"}</span></td>`; }).join("")}</tr></table></div>
      <div class="en-res"><div><span>Séries ratées</span><b>${R.score}</b>${pastille(R.niv)}</div></div>
      <div class="en-stats"><h4>Réussite par distance</h4><div class="en-barres">${[2, 3, 4, 5, 6, 7].map((d) => { const p = pct(R.ok[d], R.ten[d]);
        return `<div class="en-barre"><span>${d} pieds (${fr(d * 0.3)} m)</span><i><em style="width:${p ?? 0}%"></em></i><b>${p == null ? "—" : p + " %"}</b></div>`; }).join("")}</div>
      <p class="en-note">Dans une série, les putts avant le raté sont rentrés.</p></div>`;
  } else if (e.type === "mesure") {
    saisie = R.fini ? `<div class="en-consigne"><span class="en-fini">Exercice terminé</span><small>Meilleure vitesse : ${fr(R.best)} ${e.unite}</small></div>`
      : `<div class="en-consigne">Balle ${R.n + 1} sur ${e.n}<small>Vitesse de club lue sur le radar, en ${e.unite}.</small></div>
        <div class="en-lecture" aria-live="polite">${r.buf ? r.buf + " " + e.unite : `<span class="en-attente">— ${e.unite}</span>`}</div>${paveHtml()}`;
    feuille = `<div class="en-feuille-tete"><h3>Feuille</h3><span>vitesse de club, meilleure des ${e.n}</span></div>
      <div class="en-mesures">${r.L.map((x) => `<span class="${x === R.best ? "en-max" : ""}">${fr(x)} ${e.unite}</span>`).join("") || `<span class="meta">aucune balle</span>`}</div>
      <div class="en-res"><div><span>Record</span><b>${R.best == null ? "—" : fr(R.best) + " " + e.unite}</b></div></div>
      <p class="en-note">La ffgolf ne donne pas de tableau de niveau pour cet exercice : l'historique suit ta progression.</p>`;
  } else {
    const nl = e.lignes.length, k = r.k, l = e.lignes[k % nl], C = CHOIX[l.choix], tour = Math.floor(k / nl) + 1;
    const mode = e.radar ? `<div class="en-mode" role="group" aria-label="Mode de saisie"><button type="button" aria-pressed="${!r.radar}" data-radar="0">Sans radar (zones)</button><button type="button" aria-pressed="${!!r.radar}" data-radar="1">Avec radar (mètres)</button></div>` : "";
    if (R.fini) saisie = `${mode}<div class="en-consigne"><span class="en-fini">Exercice terminé</span><small>${R.max} balles saisies. Touche une case de la feuille pour corriger.</small></div>`;
    else if (avecPave(e, r)) saisie = `${mode}<div class="en-consigne">Tour ${tour} · ${esc(titreLigne(l, cond))}<small>Distance au drapeau lue sur le radar, en mètres.</small></div>
        <div class="en-lecture" aria-live="polite">${r.buf ? r.buf + " m" : `<span class="en-attente">— m</span>`}</div>${paveHtml()}`;
    else saisie = `${mode}<div class="en-consigne">Tour ${tour} · ${esc(titreLigne(l, cond))}<small>${l.choix === "putts" ? "Joue la balle jusqu'au trou, puis touche le résultat." : l.choix === "drive" ? "Où a fini le drive ?" : "Où s'est arrêtée la balle ?"}</small></div>
        <div class="en-choix">${C.L.map((o, i) => `<button type="button" data-zone="${o.c}">${touche(i + 1)}${esc(o.t)}${o.p != null ? `<span class="en-pts">${o.p > 0 ? "+" : ""}${o.p}</span>` : ""}</button>`).join("")}</div>`;
    const legende = [...new Set(e.lignes.map((x) => x.choix))].map((ch) => CHOIX[ch].L.map((o) => `${o.court} : ${o.t.toLowerCase()}`).join(" · ")).join(" — ");
    const val = (li, L) => (e.score === "points" ? L.pts : L.med != null ? fr(L.med) + " m" : li.choix === "drive" ? `${L.bon}/${L.n} FW` : "—");
    feuille = `<div class="en-feuille-tete"><h3>Feuille</h3><span>${esc(legende)}</span></div><div class="en-defile"><table class="en-feuille">
      <tr><th class="en-lig">Situation</th>${Array.from({ length: e.tours }, (_, i) => `<th>${i + 1}</th>`).join("")}<th>${e.score === "points" ? "Pts" : "Méd."}</th></tr>
      ${e.lignes.map((li, i) => `<tr><th class="en-lig">${esc(titreLigne(li, cond))}</th>${Array.from({ length: e.tours }, (_, t) => { const j = t * nl + i, x = r.L[j], o = x && CHOIX[li.choix].L.find((y) => y.c === x.c);
        return `<td><button type="button" class="en-case ${x ? "" : "en-rien"} ${j === k && !R.fini ? "en-cur" : ""}" data-aller="${j}" aria-label="${esc(titreLigne(li, cond))}, tour ${t + 1}">${!o ? "·" : x.m != null ? fr(x.m) : o.court}</button></td>`; }).join("")}
        <td class="en-tot">${val(li, R.Lg[i])}</td></tr>`).join("")}
      </table></div>
      <div class="en-res">${e.lignes.map((li, i) => { const L = R.Lg[i]; return `<div><span>${esc(titreLigne(li, cond))}</span><b>${val(li, L)}</b>${L.niv != null ? pastille(L.niv, L.approx && !!li.med) : `<span>${L.n}/${e.tours}</span>`}</div>`; }).join("")}
        ${e.score === "points" ? `<div><span>Total</span><b>${R.tot}</b>${pastille(R.nivTot)}</div>` : ""}</div>
      ${statsGrille(e, R, cond)}`;
  }
  return `${aideHtml(e)}<div class="en-zone"><section class="en-bloc">${feuille}</section><section class="en-bloc en-saisie">${saisie}${outils}</section></div>`;
}
function suite(s) {
  const i = s.exercices.indexOf(s.cur), nx = s.exercices[i + 1];
  return nx ? `<button type="button" class="btn plein" data-exo="${nx}">Suivant : ${esc(exo(nx).titre)} →</button>` : s.exercices.length > 1 ? `<button type="button" class="btn plein" data-exo="bilan">Voir le bilan →</button>` : "";
}
function statsGrille(e, R, cond) {
  const barres = e.lignes.map((l, i) => { const L = R.Lg[i], p = pct(L.bon, L.n); return `<div class="en-barre"><span>${esc(titreLigne(l, cond))}</span><i><em style="width:${p ?? 0}%"></em></i><b>${p == null ? "—" : p + " %"}</b></div>`; }).join("");
  const trois = e.lignes.some((l) => l.choix === "putts") ? e.lignes.map((l, i) => { const L = R.Lg[i], p = pct(L.trois, L.n); return `<div class="en-barre"><span>3 putts à ${l.t}</span><i><em class="en-mal" style="width:${p ?? 0}%"></em></i><b>${p == null ? "—" : p + " %"}</b></div>`; }).join("") : "";
  const d = e.lignes.findIndex((l) => l.choix === "drive"), cotes = d >= 0 && R.Lg[d].n ? `<p class="en-note">Drives ratés : ${R.Lg[d].cotes.g} à gauche, ${R.Lg[d].cotes.d} à droite.</p>` : "";
  const ch = [...new Set(e.lignes.map((l) => CHOIX[l.choix].bon))].join(" · ");
  return `<div class="en-stats"><h4>Réussite : ${esc(ch)}</h4><div class="en-barres">${barres}${trois}</div>${cotes}
    ${e.score === "dispersion" ? `<p class="en-note">Avec les zones, la médiane est estimée au milieu de la zone : le niveau est « approché ». Avec un radar, il est exact.</p>` : ""}</div>`;
}
function vueBilan(s) {
  return `<div class="en-bilan">${s.exercices.map((id) => { const e = exo(id), R = calc(e, s.resultats[id]);
    const ligne = e.type === "spirale" ? `<div><span>Séries ratées</span><b>${R.score}</b>${pastille(R.niv)}</div>`
      : e.type === "mesure" ? `<div><span>Record</span><b>${R.best == null ? "—" : fr(R.best) + " " + e.unite}</b></div>`
      : e.lignes.map((l, i) => { const L = R.Lg[i]; return `<div><span>${esc(titreLigne(l, s.conditions))}</span><b>${e.score === "points" ? L.pts : L.med != null ? fr(L.med) + " m" : l.choix === "drive" ? `${L.bon}/${L.n}` : "—"}</b>${pastille(L.niv, L.approx && !!l.med)}</div>`; }).join("")
        + (e.score === "points" ? `<div><span>Total</span><b>${R.tot}</b>${pastille(R.nivTot)}</div>` : "");
    return `<section class="en-bloc"><div class="en-feuille-tete"><h3>${esc(e.titre)}</h3><span>${R.fini ? "terminé" : e.type === "grille" ? `${R.n}/${R.max} balles` : "en cours"}</span></div><div class="en-res">${ligne}</div></section>`; }).join("")}</div>`;
}
function vueHistorique() {
  const S = [...etat.seances].sort((a, b) => (b.jour + b.modifie_le).localeCompare(a.jour + a.modifie_le));
  if (!S.length) return `<h2>Historique</h2><div class="en-bloc en-vide"><p><b>Aucune séance pour l'instant.</b></p><p class="meta">Tes séances apparaîtront ici, avec ton score et ton niveau pour chaque exercice.</p><button type="button" class="btn plein" data-vue="catalogue">Ouvrir le catalogue</button></div>`;
  // une courbe par exercice : ses scores d'une séance à l'autre (fait seul ou en séance)
  const parExo = EXERCICES.map((e) => ({ e, pts: S.filter((s) => s.scores?.[e.id]?.principal).reverse().map((s) => ({ jour: s.jour, p: s.scores[e.id].principal })) })).filter((x) => x.pts.length);
  return `<h2>Historique</h2>
    ${parExo.length ? `<section class="en-bloc"><div class="en-feuille-tete"><h3>Par exercice</h3><span>du plus ancien au plus récent</span></div><div class="en-hist">${parExo.map(({ e, pts }) => `<div class="en-hist-ligne"><span class="en-date">${esc(e.secteur)}</span>
      <span class="en-quoi">${esc(e.titre)}<small>${pts.length} fois · dernière : ${esc(pts[pts.length - 1].p.txt)}</small></span>
      <span class="en-courbe">${pts.slice(-5).map((x) => `<span title="${fmtDate(x.jour)}">${x.p.val == null ? "—" : fr(x.p.val)}</span>`).join("")}</span></div>`).join("")}</div></section>` : ""}
    <section class="en-bloc"><div class="en-feuille-tete"><h3>Séances</h3><span>${S.length}</span></div><div class="en-hist">${S.map((s) => {
      const faits = s.exercices.filter((id) => s.scores?.[id]?.fini).length;
      return `<div class="en-hist-ligne"><span class="en-date">${fmtDate(s.jour)}</span><span class="en-quoi">${esc(s.titre)}<small>${faits}/${s.exercices.length} exercice${s.exercices.length > 1 ? "s" : ""} terminé${faits > 1 ? "s" : ""}${s.exercices.map((id) => s.scores?.[id]?.principal ? ` · ${esc(exo(id)?.titre || id)} : ${esc(s.scores[id].principal.txt)}` : "").join("")}</small></span>
        <button type="button" class="btn" data-ouvrir="${s.id}">${s.terminee ? "Voir" : "Reprendre"}</button></div>`; }).join("")}</div></section>`;
}

// ------------------------------------------------------------------ navigation et événements
function aller(vue) { etat.vue = vue; etat.confirmer = null; if (location.hash.slice(1) !== vue) history.replaceState(null, "", "#" + vue); rendre(); window.scrollTo(0, 0); }
function lancer(titre, ids, modele) {
  etat.seance = nouvelleSeance(titre, ids, modele); garder(); aller("seance");
}
async function charger() {
  const { data, error } = await sb.from("entrainement_seances").select("*").eq("user_id", Compte.moi.id).order("jour", { ascending: false }).limit(300);
  if (error) { signaler("Lecture des séances impossible : " + error.message); etat.seances = []; return; }
  etat.seances = data || [];
}
document.addEventListener("click", async (ev) => {
  const id = ev.target.closest("button")?.id || ev.target.id;
  if (nexusClicPanneau(id, rendreCompte)) return;
  if (id === "c-ouvrir") { compte.ouvert = !compte.ouvert; rendreCompte(); return; }
  if (compte.ouvert && !ev.target.closest("#b-pan")) { compte.ouvert = false; rendreCompte(); }
  const t = ev.target.closest("button"); if (!t || !Compte.moi) return;
  const d = t.dataset, s = etat.seance;
  if (d.vue) return aller(d.vue);
  if (d.filtre) { etat.filtre = d.filtre; return rendre(); }
  if (d.lancerSeance || d.lancerExo) {
    const x = d.lancerSeance ? SEANCES_TYPES.find((y) => y.id === d.lancerSeance) : null, nouv = x ? [x.titre, x.exos, x.id] : [exo(d.lancerExo).titre, [d.lancerExo], null];
    if (s && !s.terminee && s.exercices.some((i) => (s.resultats[i]?.L || []).some(Boolean))) { etat.confirmer = { type: "remplacer", nouv }; rendre(); window.scrollTo(0, 0); return; }
    return lancer(...nouv);
  }
  if (d.confirmerOui != null && etat.confirmer?.nouv) { await envoyer(); return lancer(...etat.confirmer.nouv); }
  if (d.confirmerNon != null) { etat.confirmer = null; return rendre(); }
  if (d.ouvrir) { const x = etat.seances.find((y) => y.id === d.ouvrir); if (!x) return;
    etat.seance = { ...x, resultats: Object.fromEntries(x.exercices.map((i) => [i, { ...vide(exo(i)), ...(x.resultats?.[i] || {}) }])), cur: x.exercices[0], condOuvert: false };
    for (const i of x.exercices) { const r = etat.seance.resultats[i]; if (exo(i).type === "grille") r.k = Math.max(0, r.L.findIndex((v) => !v)); }
    lsSet(cleLocale(), JSON.stringify(etat.seance)); return aller("seance"); }
  if (!s) return;
  if (d.exo) { s.cur = d.exo; garder(); rendre(); window.scrollTo(0, 0); return; }
  if (d.condOuvrir != null) { s.condOuvert = true; return rendre(); }
  if (d.condFermer != null) { s.condOuvert = false; return rendre(); }
  if (d.cond) { const ks = [...new Set(s.exercices.flatMap((i) => exo(i).conds))], avant = ks.every((k) => s.conditions[k]); s.conditions[d.cond] = d.v; if (!avant && ks.every((k) => s.conditions[k])) s.condOuvert = false; garder(); return rendre(); }
  if (d.radar) { rc().radar = d.radar === "1"; rc().buf = ""; garder(); return rendre(); }
  if (d.annuler != null) return annuler();
  if (d.aller != null) { rc().k = +d.aller; rc().buf = ""; return rendre(); }
  if (d.ch) return choisir(d.ch === "ok" ? "ok" : +d.ch);
  if (d.zone) return choisir({ c: d.zone });
  if (d.pave) return pave(d.pave);
  if (d.fermerSeance != null) { await envoyer(); etat.seance = null; lsSet(cleLocale(), ""); return aller("historique"); }
  if (d.supprimer != null) { etat.confirmer = { type: "supprimer" }; return rendre(); }
  if (d.supprimerOui != null) {
    const { error } = await sb.from("entrainement_seances").delete().eq("id", s.id);
    if (error) { signaler("Suppression impossible : " + error.message); return; }
    etat.seances = etat.seances.filter((x) => x.id !== s.id); etat.seance = null; lsSet(cleLocale(), ""); signaler("Séance supprimée."); return aller("catalogue");
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && compte.ouvert) { compte.ouvert = false; rendreCompte(); return; }
  if (ev.ctrlKey || ev.metaKey || ev.altKey || etat.vue !== "seance" || !etat.seance || etat.seance.cur === "bilan") return;
  if (ev.target.closest("input, textarea, select")) return;
  const e = cur(), r = rc(), n = /^[0-9]$/.test(ev.key) ? +ev.key : null, pav = avecPave(e, r);
  if (ev.key === "Backspace") { ev.preventDefault(); if (pav && r.buf) { r.buf = r.buf.slice(0, -1); return rendre(); } return annuler(); }
  if (e.type === "grille" && (ev.key === "ArrowRight" || ev.key === "ArrowLeft")) { r.k = Math.max(0, Math.min(r.L.length - 1, r.k + (ev.key === "ArrowRight" ? 1 : -1))); return rendre(); }
  if (pav) { if (n != null) pave(String(n)); else if (ev.key === "," || ev.key === ".") pave(","); else if (ev.key === "Enter") pave("ok"); return; }
  if (n == null) return;
  if (e.type === "spirale") { if (n === 0) choisir("ok"); else if (n <= 6) choisir(n + 1); return; }
  const C = CHOIX[e.lignes[r.k % e.lignes.length].choix].L; if (n >= 1 && n <= C.length) choisir({ c: C[n - 1].c });
});
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (demarre && ["catalogue", "seance", "historique"].includes(v) && v !== etat.vue) aller(v); });

let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  rendreCompte();
  await charger();
  const loc = jsonLs(cleLocale());
  if (loc?.id && loc.exercices?.every((i) => exo(i))) { etat.seance = loc; if (!etat.seances.some((x) => x.id === loc.id) || loc.local) envoyer(); }
  const v = location.hash.slice(1);
  aller(["catalogue", "seance", "historique"].includes(v) ? v : etat.seance ? "seance" : "catalogue");
}
nexusBrancherAccueil();
if (sb) nexusDemarrer(entrer);
