"use strict";
// Carte — module n° 3 de la suite GolfNexus : noter ses parties trou par trou (V1).
// Écrans : Mes cartes (liste ; un coach peut voir celles de ses joueurs), Nouvelle partie, Saisie (un trou par écran),
// Voir (carte de score complète). Données : table carte_parties (supabase/carte-v1.sql), golfs et tournois des données
// publiées (gn-data). S'appuie sur les briques communes (../commun/v1/nexus.js : sb, esc, signaler, accueil, profil…).

const etat = { golfs: {}, tournois: [], ecran: "liste", vue: "", parties: [], partie: null, i: 0 };
const $ = (id) => document.getElementById(id);
const CONTEXTES = { libre: "Partie libre", entrainement: "Entraînement", rencontre: "Rencontre", tournoi: "Tournoi ffgolf" };
const FAIRWAYS = [["gauche", "← Gauche"], ["fairway", "Fairway"], ["droite", "Droite →"], ["court", "Court"], ["long", "Long"]];

// ------------------------------------------------------------------ compte (comme Club : profil + joueurs suivis)
const Compte = {
  moi: null, user: null, role: "joueur", fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, mineur: P.mineur, parentValide: P.parentValide, fiche: P.fiche });
    this.joueurs = [];
    if (this.role !== "joueur") { const J = await sb.rpc("mes_joueurs"); this.joueurs = (J.data || []).filter((j) => j.statut === "accepte"); }
  },
  setFiche(champs) {   // utilisé par le panneau du compte (mot de passe choisi)
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

// ------------------------------------------------------------------ outils de calcul
const joues = (p) => (p.trous || []).filter((t) => t.score);
const total = (p, k = "score") => joues(p).reduce((s, t) => s + (+t[k] || 0), 0);
const parJoue = (p) => joues(p).reduce((s, t) => s + (+t.par || 0), 0);
const ecartPar = (n) => (n === 0 ? "par" : (n > 0 ? "+" : "") + n);
const classeScore = (t) => { if (!t.score) return ""; const d = t.score - t.par; return d <= -2 ? "sc-aigle" : d === -1 ? "sc-birdie" : d === 0 ? "sc-par" : d === 1 ? "sc-bogey" : "sc-double"; };
const gir = (t) => t.score && t.putts != null && t.score - t.putts <= t.par - 2;
function bilan(p) {
  const J = joues(p), avecPutts = J.filter((t) => t.putts != null), fw = J.filter((t) => t.par > 3 && t.fw);
  return {
    n: J.length, score: total(p), ecart: total(p) - parJoue(p), putts: avecPutts.length ? total(p, "putts") : null,
    fairways: fw.length ? `${fw.filter((t) => t.fw === "fairway").length}/${fw.length}` : "—",
    gir: avecPutts.length ? `${avecPutts.filter(gir).length}/${avecPutts.length}` : "—",
    pen: J.reduce((s, t) => s + (+t.pen || 0), 0),
  };
}
const dateLongue = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

// ------------------------------------------------------------------ navigation
function ecran(nom) {
  if (nom === "nouvelle" && etat.vue) nom = "liste";   // pas de saisie pour un joueur suivi (lecture seule)
  etat.ecran = nom;
  for (const k of ["liste", "nouvelle", "saisie", "voir"]) $("ecran-" + k).hidden = k !== nom;
  for (const b of document.querySelectorAll(".vues button[data-ecran]"))
    if (b.dataset.ecran === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  $("v-nouvelle").hidden = !!etat.vue;
  rendreCompte();
  if (nom === "liste") rendreListe();
  else if (nom === "nouvelle") preparerNouvelle();
  else if (nom === "saisie") rendreSaisie();
  else if (nom === "voir") rendreVoir();
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ecran]"); if (b && !b.closest("#b-pan")) ecran(b.dataset.ecran);
});

// ------------------------------------------------------------------ Mes cartes
async function rendreListe() {
  const box = $("li-contenu");
  // coach : voir les cartes d'un joueur suivi (lecture seule, droit « coach_de » du cœur)
  $("li-vue").innerHTML = Compte.joueurs.length ? `<select id="li-qui" aria-label="Cartes de"><option value="">Mes cartes</option>${Compte.joueurs.map((j) =>
    `<option value="${esc(j.joueur_id)}" ${j.joueur_id === etat.vue ? "selected" : ""}>Cartes de ${esc(j.nom || j.libelle || "joueur")}</option>`).join("")}</select>` : "";
  $("li-titre").textContent = etat.vue ? "Cartes du joueur" : "Mes cartes";
  box.innerHTML = `<p class="meta">Chargement…</p>`;
  const { data, error } = await sb.from("carte_parties").select("*").eq("user_id", etat.vue || Compte.moi.id).order("jour", { ascending: false }).order("cree_le", { ascending: false });
  if (error) { box.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(error.message)}${/carte_parties/.test(error.message) ? "<br>La table de Carte n'est pas encore créée dans la base (script supabase/carte-v1.sql)." : ""}</div>`; return; }
  etat.parties = data || [];
  if (!etat.parties.length) {
    box.innerHTML = etat.vue ? `<div class="bloc vide">Aucune carte pour ce joueur.</div>`
      : `<div class="bloc vide"><p>Aucune partie pour l'instant.</p><button type="button" class="btn plein" data-ecran="nouvelle">+ Noter ma première partie</button></div>`;
    return;
  }
  const enCours = !etat.vue && etat.parties.find((p) => !p.terminee);
  box.innerHTML = `${enCours ? `<button type="button" class="li-reprendre" data-partie="${esc(enCours.id)}">▶ <b>Reprendre la partie en cours</b>
      <span>${esc(titre(enCours.golf_nom || enCours.golf))} · ${bilan(enCours).n}/${enCours.nb_trous} trous saisis</span></button>` : ""}<div class="li-cartes">${etat.parties.map((p) => {
    const b = bilan(p);
    return `<button type="button" class="li-carte" data-partie="${esc(p.id)}">
      <span class="li-score ${b.n ? (b.ecart <= 0 ? "bon" : "") : "vide"}"><b>${b.n ? b.score : "—"}</b><small>${b.n ? ecartPar(b.ecart) : ""}</small></span>
      <span class="li-quoi"><b>${esc(titre(p.golf_nom || p.golf))}</b><small>${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${p.nb_trous} trous</small>
        <small>${dateLongue(p.jour)} · ${CONTEXTES[p.contexte] || ""}${p.terminee ? "" : ` · <span class="tag en-cours">en cours ${b.n}/${p.nb_trous}</span>`}</small></span>
      <span class="li-chiffres">${b.putts != null ? `<span><b>${b.putts}</b> putts</span>` : ""}<span><b>${b.fairways}</b> fairways</span></span>
    </button>`; }).join("")}</div>`;
}
document.addEventListener("change", (e) => { if (e.target.id === "li-qui") { etat.vue = e.target.value; ecran("liste"); } });
$("li-contenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-partie]"); if (!b) return;
  etat.partie = etat.parties.find((p) => p.id === b.dataset.partie);
  const m = jsonLs("carte-en-cours");   // reprendre au trou où l'on s'était arrêté, sinon au premier trou sans score
  etat.i = m?.id === etat.partie.id ? Math.min(m.i, etat.partie.trous.length - 1) : Math.max(0, etat.partie.trous.findIndex((t) => !t.score));
  ecran(!etat.vue && !etat.partie.terminee ? "saisie" : "voir");
});

// ------------------------------------------------------------------ Nouvelle partie
const golfDuChamp = () => { const v = $("nv-golf").value.trim().toLowerCase(); return Object.values(etat.golfs).find((g) => libGolf(g).toLowerCase() === v || g.nom.toLowerCase() === v) || null; };
const libGolf = (g) => `${titre(g.nom)}${g.ville ? " (" + titre(g.ville) + ")" : ""}`;
function preparerNouvelle() {
  if (!$("nv-jour").value) $("nv-jour").value = AUJ;
  if (!$("nv-golfs").children.length) $("nv-golfs").innerHTML = Object.values(etat.golfs).sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((g) => `<option value="${esc(libGolf(g))}">`).join("");
  majParcours();
}
function majParcours() {
  const g = golfDuChamp(), P = g ? (g.parcours || []) : [];
  $("nv-parcours").innerHTML = P.length ? P.map((p) => `<option value="${esc(p.code)}">${esc(p.nom)} · ${p.trous} trous${p.par ? " · par " + p.par : ""}</option>`).join("") : `<option value="">${g ? "Parcours inconnu" : "Choisis d'abord le golf"}</option>`;
  majReperes(); majTournois();
}
function parcoursChoisi() { const g = golfDuChamp(); return g && (g.parcours || []).find((p) => p.code === $("nv-parcours").value) || null; }
function majReperes() {
  const p = parcoursChoisi(), R = p ? p.reperes || [] : [];
  $("nv-repere").innerHTML = `<option value="">—</option>` + R.map((r) => `<option value="${esc(r.couleur)}">${esc(r.couleur)}${r.distance ? " · " + r.distance + " m" : ""}</option>`).join("");
  const p9 = p && p.trous < 18; $("nv-trous").value = p9 ? "9-1" : $("nv-trous").value;
}
function majTournois() {
  const g = golfDuChamp(), ctx = $("nv-contexte").value === "tournoi";
  $("nv-tournoi-l").hidden = !ctx;
  if (!ctx) return;
  // tous les tournois ffgolf de ce golf, les plus proches de la date choisie d'abord (champ « debut » des données)
  const j = new Date($("nv-jour").value + "T12:00:00"), ecart = (t) => Math.abs(new Date(t.debut + "T12:00:00") - j);
  const T = g ? etat.tournois.filter((t) => t.golf === g.slug && t.debut).sort((a, b) => ecart(a) - ecart(b)).slice(0, 20) : [];
  const avant = $("nv-tournoi").value;
  $("nv-tournoi").innerHTML = T.length ? T.map((t) => `<option value="${esc(t.id)}" ${t.id === avant ? "selected" : ""}>${esc(fmtDate(t.debut))} ${t.annee || ""} · ${esc(t.nom)}</option>`).join("")
    : `<option value="">${g ? "Aucun tournoi ffgolf sur ce golf" : "Choisis d'abord le golf"}</option>`;
}
// choisir un tournoi règle la date de la partie sur son premier jour
$("nv-tournoi").addEventListener("change", () => { const t = etat.tournois.find((x) => x.id === $("nv-tournoi").value); if (t?.debut) $("nv-jour").value = t.debut; });
$("nv-golf").addEventListener("change", majParcours);
$("nv-golf").addEventListener("input", () => { if (golfDuChamp()) majParcours(); });
$("nv-parcours").addEventListener("change", majReperes);
$("nv-contexte").addEventListener("change", majTournois);
$("nv-jour").addEventListener("change", majTournois);
$("nv-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = golfDuChamp(), p = parcoursChoisi();
  if (!g) { signaler("Choisis un golf dans la liste."); $("nv-golf").focus(); return; }
  const [nb, premier] = $("nv-trous").value.split("-").map(Number);
  const pars = p?.par_trous || [];
  const trous = Array.from({ length: nb }, (_, k) => { const t = premier + k; return { t, par: pars[t - 1] || 4 }; });
  const ligne = { jour: $("nv-jour").value, golf: g.slug, golf_nom: g.nom, parcours: p?.code || null, parcours_nom: p?.nom || null,
    repere: $("nv-repere").value || null, nb_trous: nb, premier, contexte: $("nv-contexte").value,
    tournoi_id: $("nv-contexte").value === "tournoi" ? ($("nv-tournoi").value || null) : null, trous, note: $("nv-note").value.trim() || null };
  $("nv-ok").disabled = true;
  const { data, error } = await sb.from("carte_parties").insert(ligne).select("*").single();
  $("nv-ok").disabled = false;
  if (error) { signaler("Création impossible : " + error.message); return; }
  $("nv-form").reset(); $("nv-jour").value = AUJ;
  etat.partie = data; etat.i = 0; ecran("saisie");
});

// ------------------------------------------------------------------ Saisie : un trou par écran, gros boutons
// partie en cours mémorisée dans ce navigateur (id + trou affiché) : déconnecté, page fermée, réseau coupé…
// au retour, Carte rouvre la saisie sur ce trou (07/11, demande de l'utilisateur)
const memoriserEnCours = () => lsSet("carte-en-cours", JSON.stringify({ id: etat.partie.id, i: etat.i, user: etat.partie.user_id }));
const oublierEnCours = (id) => { const m = jsonLs("carte-en-cours"); if (!id || m?.id === id) try { localStorage.removeItem("carte-en-cours"); } catch { /* */ } };
function rendreSaisie() {
  const p = etat.partie, t = p.trous[etat.i], b = bilan(p);
  memoriserEnCours();
  // plus = true : pas de limite (stroke play) → bouton « + » qui ajoute 1 au-delà du dernier choix ; la valeur atteinte s'affiche
  const choix = (cle, valeurs, lib = (v) => v, plus = false) => {
    const V = [...valeurs], max = V[V.length - 1];
    if (plus && typeof t[cle] === "number" && t[cle] > max) V.push(t[cle]);
    return `<div class="sa-choix" role="group">${V.map((v) =>
      `<button type="button" data-cle="${cle}" data-val="${v}" aria-pressed="${t[cle] === v}">${lib(v)}</button>`).join("")}${plus
      ? `<button type="button" class="sa-plus" data-plus="${cle}" data-max="${max}" aria-label="Ajouter 1">+</button>` : ""}</div>`;
  };
  const scores = [], bas = Math.max(1, t.par - 2);
  for (let s = bas; s <= t.par + 4; s++) scores.push(s);
  const nomScore = (s) => { const d = s - t.par; return `<b>${s}</b><small>${d <= -2 ? "aigle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : d === 2 ? "double" : "+" + d}</small>`; };
  $("sa-contenu").innerHTML = `
    <div class="sa-tete"><div><h2 id="sa-titre">${esc(titre(p.golf_nom || p.golf))}</h2><p class="meta">${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${dateLongue(p.jour)}</p></div>
      <div class="sa-total"><b>${b.n ? b.score : "—"}</b><small>${b.n ? ecartPar(b.ecart) + " · " + b.n + "/" + p.nb_trous : "à toi de jouer"}</small></div></div>
    <div class="sa-trous" role="tablist" aria-label="Trous">${p.trous.map((x, k) => `<button type="button" class="${classeScore(x)}${k === etat.i ? " actif" : ""}" data-aller="${k}" aria-label="Trou ${x.t}">${x.t}<small>${x.score || ""}</small></button>`).join("")}</div>
    <div class="bloc sa-trou">
      <div class="sa-num"><span>Trou <b>${t.t}</b></span><span class="sa-par">Par <b>${t.par}</b></span></div>
      <h3>Score</h3>${choix("score", scores, nomScore, true)}
      <div class="sa-ligne"><div><h3>Putts</h3>${choix("putts", [0, 1, 2, 3, 4], undefined, true)}</div><div><h3>Pénalités</h3>${choix("pen", [0, 1, 2, 3], undefined, true)}</div></div>
      ${t.par > 3 ? `<h3>Mise en jeu (départ)</h3>${choix("fw", FAIRWAYS.map((f) => f[0]), (v) => FAIRWAYS.find((f) => f[0] === v)[1])}` : ""}
      <h3>Bunker</h3>${choix("bunker", [false, true], (v) => (v ? "Oui, joué depuis un bunker" : "Non"))}
    </div>
    <div class="sa-nav">
      <button type="button" class="btn" data-pas="-1" ${etat.i === 0 ? "disabled" : ""}>← Trou ${etat.i ? p.trous[etat.i - 1].t : ""}</button>
      <span class="meta" id="sa-etat"></span>
      ${etat.i < p.trous.length - 1 ? `<button type="button" class="btn plein" data-pas="1">Trou ${p.trous[etat.i + 1].t} →</button>` : `<button type="button" class="btn plein" data-finir>Terminer la partie ✓</button>`}
    </div>
    <p class="sa-bas"><button type="button" class="lien" data-ecran="liste">← Mes cartes</button> · <button type="button" class="lien" data-voir-carte>Voir la carte</button> · <button type="button" class="lien" data-partager>🔗 Partager en direct</button></p>`;
}
$("sa-contenu").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const p = etat.partie, t = p.trous[etat.i];
  if (b.dataset.cle) {
    const v = b.dataset.cle === "bunker" ? b.dataset.val === "true" : b.dataset.cle === "fw" ? b.dataset.val : +b.dataset.val;
    t[b.dataset.cle] = t[b.dataset.cle] === v && b.dataset.cle !== "score" ? null : v;   // second clic : on efface (sauf le score)
    if (b.dataset.cle === "score" && t.putts == null) t.putts = 2;                     // valeurs les plus courantes, à corriger d'un clic
    if (b.dataset.cle === "score" && t.pen == null) t.pen = 0;
    if (b.dataset.cle === "score" && t.bunker == null) t.bunker = false;
    sauver(); rendreSaisie(); return;
  }
  if (b.dataset.plus) {   // au-delà du dernier choix : +1 à chaque appui
    const k = b.dataset.plus, max = +b.dataset.max;
    t[k] = Math.max(typeof t[k] === "number" ? t[k] : max, max) + 1;
    if (k === "score") { if (t.putts == null) t.putts = 2; if (t.pen == null) t.pen = 0; if (t.bunker == null) t.bunker = false; }
    sauver(); rendreSaisie(); return;
  }
  if (b.dataset.aller) { etat.i = +b.dataset.aller; rendreSaisie(); return; }
  if (b.dataset.pas) { etat.i += +b.dataset.pas; rendreSaisie(); window.scrollTo({ top: 0 }); return; }
  if ("finir" in b.dataset) {
    const manque = p.trous.filter((x) => !x.score).length;
    if (manque && !confirm(`${manque} trou${manque > 1 ? "s" : ""} sans score. Terminer quand même ?`)) return;
    p.terminee = true; sauver(true); oublierEnCours(p.id); ecran("voir"); return;
  }
  if ("voirCarte" in b.dataset) { ecran("voir"); }
});
// enregistrement automatique (0,6 s après le dernier clic) ; copie dans ce navigateur en cas de coupure réseau
let minuteurSauve = null;
function sauver(tout = false) {
  const p = etat.partie; p.modifie_le = new Date().toISOString();
  lsSet("carte-brouillon", JSON.stringify(p));
  const ecrire = async () => {
    const { error } = await sb.from("carte_parties").update({ trous: p.trous, terminee: p.terminee, modifie_le: p.modifie_le }).eq("id", p.id);
    const m = $("sa-etat");
    if (error) { if (m) m.textContent = "⚠ pas encore enregistré (réseau ?)"; signaler("Enregistrement impossible : " + error.message + " — tes saisies sont gardées dans ce navigateur."); return; }
    try { localStorage.removeItem("carte-brouillon"); } catch { /* */ }
    if (m) m.textContent = "✓ enregistré";
  };
  clearTimeout(minuteurSauve);
  if (tout) ecrire(); else minuteurSauve = setTimeout(ecrire, 600);
}

// ------------------------------------------------------------------ Voir : la carte de score complète
function rendreVoir() {
  const p = etat.partie, b = bilan(p), lecture = etat.partage || !!etat.vue || p.user_id !== Compte.moi?.id;
  const moities = p.nb_trous === 18 ? [p.trous.slice(0, 9), p.trous.slice(9)] : [p.trous];
  const somme = (T, k) => T.filter((t) => t.score).reduce((s, t) => s + (+t[k] || 0), 0);
  const tableau = (T, nom) => `<table class="vo-table"><thead><tr><th>Trou</th>${T.map((t) => `<th>${t.t}</th>`).join("")}<th>${nom}</th></tr></thead><tbody>
    <tr><th>Par</th>${T.map((t) => `<td>${t.par}</td>`).join("")}<td><b>${T.reduce((s, t) => s + t.par, 0)}</b></td></tr>
    <tr class="vo-score"><th>Score</th>${T.map((t) => `<td><span class="${classeScore(t)}">${t.score || "·"}</span></td>`).join("")}<td><b>${somme(T, "score") || "—"}</b></td></tr>
    <tr><th>Putts</th>${T.map((t) => `<td>${t.putts ?? "·"}</td>`).join("")}<td>${somme(T, "putts") || "—"}</td></tr>
    <tr><th>Pén.</th>${T.map((t) => `<td>${t.pen ? t.pen : "·"}</td>`).join("")}<td>${somme(T, "pen") || "—"}</td></tr>
    <tr><th>Départ</th>${T.map((t) => `<td title="${esc(t.fw || "")}">${t.par === 3 ? "" : { gauche: "←", fairway: "●", droite: "→", court: "↓", long: "↑" }[t.fw] || "·"}</td>`).join("")}<td></td></tr>
    <tr><th>Bunker</th>${T.map((t) => `<td>${t.bunker ? "◆" : "·"}</td>`).join("")}<td></td></tr></tbody></table>`;
  $("vo-contenu").innerHTML = `
    ${etat.partage ? `<div class="pt-direct ${p.terminee ? "fini" : ""}">${p.terminee ? "✓ Partie terminée" : "● En direct"}${p.prenom ? ` · la carte de <b>${esc(p.prenom)}</b>` : ""}
      <small>${p.terminee ? "" : "mise à jour automatique · "}dernière saisie ${new Date(p.modifie_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></div>` : ""}
    <div class="s-tete"><h2>${esc(titre(p.golf_nom || p.golf))}</h2><span class="meta">${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${dateLongue(p.jour)} · ${CONTEXTES[p.contexte] || ""}</span></div>
    <div class="st-tuiles">${tuileSt(b.n ? b.score : "—", "score", b.n ? ecartPar(b.ecart) + (b.n < p.nb_trous ? ` sur ${b.n} trous` : "") : "")}${tuileSt(b.putts ?? "—", "putts")}${tuileSt(b.fairways, "fairways touchés")}${tuileSt(b.gir, "greens en régulation")}${tuileSt(b.pen, "pénalités")}</div>
    <div class="bloc vo-carte">${moities.map((T, k) => `<div class="defile">${tableau(T, moities.length > 1 ? (k ? "Retour" : "Aller") : "Total")}</div>`).join("")}
      <p class="meta vo-legende"><span class="sc-birdie">birdie</span> <span class="sc-par">par</span> <span class="sc-bogey">bogey</span> <span class="sc-double">double +</span> · départ : ● fairway, ← gauche, → droite, ↓ court, ↑ long · ◆ bunker</p></div>
    ${p.note ? `<div class="bloc"><b>Note</b> <span>${esc(p.note)}</span></div>` : ""}
    ${etat.partage ? `<p class="meta pt-pied">Carte partagée par lien (lecture seule) · <a href="../">GolfNexus</a></p>` : `<div class="vo-actions"><button type="button" class="btn" data-ecran="liste">← ${etat.vue ? "Cartes du joueur" : "Mes cartes"}</button>
      ${lecture ? `<span class="meta">Lecture seule</span>` : `<button type="button" class="btn plein" data-partager>🔗 Partager en direct</button><button type="button" class="btn" data-modifier>Modifier la saisie</button><button type="button" class="lien vo-suppr" data-supprimer>Supprimer la partie</button>`}</div>`}`;
}
$("vo-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if ("modifier" in b.dataset) { const p = etat.partie; p.terminee = false; etat.i = Math.max(0, p.trous.findIndex((t) => !t.score)); ecran("saisie"); return; }
  if ("supprimer" in b.dataset) {
    if (!confirm("Supprimer définitivement cette partie ?")) return;
    const { error } = await sb.from("carte_parties").delete().eq("id", etat.partie.id);
    if (error) { signaler("Suppression impossible : " + error.message); return; }
    oublierEnCours(etat.partie.id); signaler("Partie supprimée."); ecran("liste");
  }
});

// ------------------------------------------------------------------ démarrage
let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  $("accueil").classList.add("chargement");
  let D;
  try { D = await telechargerDonnees(); }
  catch (e) { demarre = false; $("accueil").classList.remove("chargement"); msgAccueil("Données inaccessibles : " + (e.message || e), true); return; }
  for (const g of D.golfs || []) etat.golfs[g.slug] = g;
  etat.tournois = D.tournois || [];
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  // une saisie non enregistrée (coupure réseau) : on la renvoie
  const br = jsonLs("carte-brouillon");
  if (br && br.id && br.user_id === Compte.moi.id) { etat.partie = br; sauver(true); }
  // une partie en cours (déconnecté, page fermée…) : on rouvre la saisie sur le trou où l'on s'était arrêté
  const m = jsonLs("carte-en-cours");
  if (m?.id && m.user === Compte.moi.id) {
    if (!etat.partie || etat.partie.id !== m.id) {
      const { data: p } = await sb.from("carte_parties").select("*").eq("id", m.id).maybeSingle();
      etat.partie = p || null;
    }
    if (etat.partie && !etat.partie.terminee) {
      etat.i = Math.min(m.i || 0, etat.partie.trous.length - 1);
      ecran("saisie"); signaler("Reprise de ta partie en cours."); return;
    }
    oublierEnCours();
  }
  ecran("liste");
}
// ------------------------------------------------------------------ partage en direct par lien (07/11)
// Le joueur crée un jeton pour UNE partie (table carte_partages) ; le lien …/carte/#direct=<jeton> montre cette carte
// seulement, sans compte (fonction carte_partagee), mise à jour toutes les 20 s tant que la partie n'est pas terminée.
async function lienDePartage(partie) {
  const maintenant = new Date().toISOString();
  let { data } = await sb.from("carte_partages").select("jeton,expire_le").eq("partie_id", partie.id).gt("expire_le", maintenant).order("expire_le", { ascending: false }).limit(1);
  let j = data?.[0];
  if (!j) {
    const r = await sb.from("carte_partages").insert({ partie_id: partie.id }).select("jeton,expire_le").single();
    if (r.error) throw r.error;
    j = r.data;
  }
  return { url: `${location.origin}${location.pathname}#direct=${j.jeton}`, expire: j.expire_le };
}
async function ouvrirPartage() {
  const p = etat.partie; let L;
  try { L = await lienDePartage(p); }
  catch (e) { signaler("Partage impossible : " + (e.message || e) + (/carte_partages/.test(e.message || "") ? " (script supabase/carte-partage.sql à lancer)" : "")); return; }
  const fin = new Date(L.expire).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const f = document.createElement("div"); f.className = "pt-fond"; f.id = "pt-fond";
  f.innerHTML = `<div class="pt-boite" role="dialog" aria-modal="true" aria-labelledby="pt-titre">
    <h2 id="pt-titre">🔗 Partager en direct</h2>
    <p>La personne qui reçoit ce lien voit <b>la carte de cette partie seulement</b>, sans compte, et la suit en direct pendant que tu saisis. Elle ne voit rien d'autre.</p>
    <input id="pt-lien" readonly value="${esc(L.url)}" aria-label="Lien de partage">
    <div class="pt-boutons"><button type="button" class="btn plein" id="pt-copier">Copier le lien</button>${navigator.share ? `<button type="button" class="btn" id="pt-envoyer">Envoyer…</button>` : ""}</div>
    <p class="meta">Valable jusqu'au ${esc(fin)}. Tu peux l'arrêter à tout moment.</p>
    <div class="pt-pied2"><button type="button" class="lien vo-suppr" id="pt-arreter">Arrêter le partage</button><button type="button" class="btn" id="pt-fermer">Fermer</button></div></div>`;
  document.body.append(f);
  $("pt-lien").select();
  f.addEventListener("click", async (e) => {
    const id = e.target.id;
    if (id === "pt-fond" || id === "pt-fermer") { f.remove(); return; }
    if (id === "pt-copier") { try { await navigator.clipboard.writeText(L.url); signaler("Lien copié."); } catch { $("pt-lien").select(); document.execCommand("copy"); signaler("Lien copié."); } return; }
    if (id === "pt-envoyer") { navigator.share({ title: "Ma carte GolfNexus en direct", text: `Suis ma partie à ${titre(p.golf_nom || p.golf)} en direct`, url: L.url }).catch(() => {}); return; }
    if (id === "pt-arreter") {
      if (!confirm("Arrêter le partage ? Le lien ne marchera plus.")) return;
      const { error } = await sb.from("carte_partages").delete().eq("partie_id", p.id);
      signaler(error ? "Impossible : " + error.message : "Partage arrêté : le lien ne marche plus."); f.remove();
    }
  });
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-partager]")) ouvrirPartage(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("pt-fond")?.remove(); });

async function modePartage(jeton) {
  etat.partage = true;
  finReprise(); document.body.classList.remove("verrou"); document.body.classList.add("partage");
  for (const k of ["liste", "nouvelle", "saisie"]) $("ecran-" + k).hidden = true;
  $("ecran-voir").hidden = false;
  const lire = async () => {
    const { data, error } = await sb.rpc("carte_partagee", { j: jeton });
    const p = Array.isArray(data) ? data[0] : data;
    if (error || !p) {
      $("vo-contenu").innerHTML = `<div class="bloc vide"><p><b>Ce lien de partage n'est plus valable.</b></p><p class="meta">Il a expiré ou le joueur a arrêté le partage.</p><a class="btn" href="../">GolfNexus</a></div>`;
      return false;
    }
    etat.partie = p; rendreVoir();
    return !p.terminee;
  };
  if (await lire()) { const minuteur = setInterval(async () => { if (!(await lire())) clearInterval(minuteur); }, 20000); }
}

const jetonPartage = new URLSearchParams(location.hash.slice(1)).get("direct");
if (sb && jetonPartage) modePartage(jetonPartage);
else { nexusBrancherAccueil(); if (sb) nexusDemarrer(entrer); }
