"use strict";
// Carte — module n° 3 de la suite GolfNexus : noter ses parties trou par trou (V1).
// Écrans : Mes cartes (liste ; un coach peut voir celles de ses joueurs), Nouvelle partie, Saisie (un trou par écran),
// Voir (carte de score complète). Données : table carte_parties (supabase/carte-v1.sql), golfs et tournois des données
// publiées (gn-data). S'appuie sur les briques communes (../commun/v1/nexus.js : sb, esc, signaler, accueil, profil…).

const etat = { golfs: {}, tournois: [], ecran: "liste", vue: "", parties: [], partie: null, i: 0 };
const $ = (id) => document.getElementById(id);
// date du jour EN HEURE LOCALE (AUJ, commun, est en heure universelle : entre minuit et 1–2 h, il donne encore la veille)
const JOUR = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const CONTEXTES = { libre: "Partie libre", entrainement: "Entraînement", rencontre: "Rencontre", competition: "Événement hors Mérite", tournoi: "Tournoi ffgolf" };
const FAIRWAYS = [["gauche", "Gauche"], ["fairway", "Fairway"], ["droite", "Droite"], ["court", "Court"], ["long", "Long"]];
// mise en jeu : un fairway vu de dessus (rough à gauche et à droite, long au-dessus, court en dessous) ; la balle se pose
// dans la zone touchée. Second appui sur la même zone : on efface.
function terrainFw(val) {
  const z = (v, lib) => `<button type="button" class="fw-zone fw-${v}" data-cle="fw" data-val="${v}" aria-pressed="${val === v}" aria-label="${lib}"><span>${lib}</span>${val === v ? '<i class="fw-balle" aria-hidden="true"></i>' : ""}</button>`;
  return `<div class="fw-terrain" role="group" aria-label="Où a fini la mise en jeu">${z("long", "Long")}${z("gauche", "Gauche")}${z("fairway", "Fairway")}${z("droite", "Droite")}${z("court", "Court")}<span class="fw-depart" aria-hidden="true">▲ départ</span></div>`;
}
// mini-fairway de la carte de score : la balle à sa place
const POS_FW = { gauche: [4, 13], fairway: [10, 13], droite: [16, 13], court: [10, 23], long: [10, 3] };
const miniFw = (v) => `<svg class="fw-mini" viewBox="0 0 20 26" aria-hidden="true"><rect x="0" y="0" width="20" height="26" rx="4" class="r"/><rect x="6" y="5" width="8" height="16" rx="3" class="f"/>${POS_FW[v] ? `<circle cx="${POS_FW[v][0]}" cy="${POS_FW[v][1]}" r="2.6" class="b"/>` : ""}</svg>`;

// ------------------------------------------------------------------ compte (comme Club : profil + joueurs suivis)
const Compte = {
  moi: null, user: null, role: "joueur", fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, structure: P.structure, mineur: P.mineur, parentValide: P.parentValide, fiche: P.fiche });
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
// notation des cartes de golf : rond = birdie, double rond = eagle ou mieux, carré = bogey, double carré = double bogey ou pire
const notation = (t) => { if (!t.score) return ""; const d = t.score - t.par; return d <= -3 ? "nt-albatros" : d === -2 ? "nt-aigle" : d === -1 ? "nt-birdie" : d === 0 ? "nt-par" : d === 1 ? "nt-bogey" : "nt-double"; };
const SABLE = `<svg class="ic-sable" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 12c2-6 6-9 10-9s8 3 10 9c-3 2-17 2-20 0z"/></svg>`;
const gir = (t) => t.score && t.putts != null && t.score - t.putts >= 1 && t.score - t.putts - (t.pen || 0) <= t.par - 2;
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
  for (const k of ["liste", "nouvelle", "saisie", "voir", "direct", "lives", "marqueur"]) $("ecran-" + k).hidden = k !== nom;
  if (nom !== "direct") { arreterDirect(); if (/(^|[#&])(evt|tournoi)=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); }
  for (const b of document.querySelectorAll(".vues button[data-ecran]"))
    if (b.dataset.ecran === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  $("v-nouvelle").hidden = !!etat.vue;
  rendreCompte();
  const jv = etat.vue && Compte.joueurs.find((j) => j.joueur_id === etat.vue);   // coach : bande jaune et raccourcis
  nexusBandeVue(jv ? jv.nom || jv.libelle || "Joueur" : "", "carte", () => { etat.vue = ""; nexusJoueurVu.ecrire(Compte.moi?.id, ""); ecran("liste"); },
    Compte.joueurs.map((j) => ({ id: j.joueur_id, nom: j.nom || j.libelle, info: j.categorie || "" })),
    (id) => { etat.vue = id; nexusJoueurVu.ecrire(Compte.moi?.id, id, Compte.joueurs.find((j) => j.joueur_id === id)?.nom); ecran("liste"); });
  if (nom === "liste") rendreListe();
  else if (nom === "nouvelle") preparerNouvelle();
  else if (nom === "saisie") rendreSaisie();
  else if (nom === "voir") rendreVoir();
  else if (nom === "direct") rendreDirect();
  else if (nom === "lives") rendreLives();
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
  const enCours = !etat.vue && etat.parties.find((p) => !p.terminee);
  const attend = etat.vue ? [] : (etat.agenda || []).map((a) => ({ ...a, carte: etat.parties.find((p) => p.tournoi_id === a.t.id && (p.tour || 1) === a.tour) }))
    .filter((a) => !a.carte || !a.carte.terminee);
  const htmlAttend = attend.map((a) => `<div class="li-attend"><span>⛳ <b>Aujourd'hui : ${esc(titre(a.t.nom))}</b>${(a.t.nb_tours || 1) > 1 ? ` · tour ${a.tour}` : ""}
      <small>${esc(titre(a.t.golf_nom || a.t.golf || ""))}${a.t.categorie ? " · " + esc(a.t.categorie) : ""}${a.t.invite ? " · invitation pas encore acceptée : commencer ta carte vaut acceptation" : ""} · ${a.t.club ? esc((NX_TYPES_EV[a.t.type] || "événement").toLowerCase()) : `dans ta saison (${esc({ envisage: "envisagé", inscrit: "inscrit", joue: "joué" }[a.statut] || a.statut)})`}</small></span>
      <span class="li-attend-b">${a.t.ev ? `<button type="button" class="btn" data-direct-evt="${esc(a.t.ev)}">📡 Direct</button>` : ""}${a.carte ? `<button type="button" class="btn plein" data-partie="${esc(a.carte.id)}">Reprendre ma carte</button>` : `<button type="button" class="btn plein" data-attend="${esc(a.t.id)}">Ta carte t'attend · commencer</button>`}</span></div>`).join("");
  if (!etat.parties.length) {
    box.innerHTML = etat.vue ? `<div class="bloc vide">Aucune carte pour ce joueur.</div>`
      : `${htmlAttend}<div class="bloc vide"><p>Aucune partie pour l'instant.</p><button type="button" class="btn plein" data-ecran="nouvelle">+ Noter ma première partie</button></div>`;
    return;
  }
  box.innerHTML = `${htmlAttend}${enCours && !attend.some((a) => a.carte?.id === enCours.id) ? `<button type="button" class="li-reprendre" data-partie="${esc(enCours.id)}">▶ <b>Reprendre la partie en cours</b>
      <span>${esc(titre(enCours.golf_nom || enCours.golf))} · ${bilan(enCours).n}/${enCours.nb_trous} trous saisis</span></button>` : ""}<div class="li-cartes">${etat.parties.map((p) => {
    const b = bilan(p);
    return `<button type="button" class="li-carte" data-partie="${esc(p.id)}">
      <span class="li-score ${b.n ? (b.ecart <= 0 ? "bon" : "") : "vide"}"><b>${b.n ? b.score : "—"}</b><small>${b.n ? ecartPar(b.ecart) : ""}</small></span>
      <span class="li-quoi"><b>${esc(titre(p.golf_nom || p.golf))}</b><small>${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${p.nb_trous} trous</small>
        <small>${dateLongue(p.jour)} · ${CONTEXTES[p.contexte] || ""}${p.terminee ? "" : ` · <span class="tag en-cours">en cours ${b.n}/${p.nb_trous}</span>`}</small></span>
      <span class="li-chiffres">${b.putts != null ? `<span><b>${b.putts}</b> putts</span>` : ""}<span><b>${b.fairways}</b> fairways</span></span>
    </button>`; }).join("")}</div>`;
}
document.addEventListener("change", (e) => { if (e.target.id === "li-qui") { etat.vue = e.target.value; nexusJoueurVu.ecrire(Compte.moi?.id, etat.vue, Compte.joueurs.find((j) => j.joueur_id === etat.vue)?.nom); ecran("liste"); } });
$("li-contenu").addEventListener("click", async (e) => {
  const at = e.target.closest("[data-attend]");
  if (at) {   // invitation pas encore acceptée : commencer sa carte vaut acceptation
    const a = (etat.agenda || []).find((x) => x.t.id === at.dataset.attend);
    if (a?.t.invite) {
      const { error } = await sb.rpc("evenement_repondre", { ev: a.t.ev, accepte: true });
      if (error) { signaler("Impossible d'accepter l'invitation : " + error.message); return; }
      a.t.invite = false; signaler("Invitation acceptée : tes scores de cet événement sont visibles des participants.");
    }
    preremplir(at.dataset.attend); return;
  }
  if (e.target.closest("[data-direct-evt]")) return;   // géré plus bas (page En direct)
  const b = e.target.closest("[data-partie]"); if (!b) return;
  etat.partie = etat.parties.find((p) => p.id === b.dataset.partie);
  const m = jsonLs("carte-en-cours");   // reprendre au trou où l'on s'était arrêté, sinon au premier trou sans score
  etat.i = m?.id === etat.partie.id ? Math.min(m.i, etat.partie.trous.length - 1) : Math.max(0, etat.partie.trous.findIndex((t) => !t.score));
  ecran(!etat.vue && !etat.partie.terminee ? "saisie" : "voir");
});

// ------------------------------------------------------------------ « Ta carte t'attend » : compétitions du jour dans Ma saison (Saison)
// Les tournois de mes saisons (Envisagé / Inscrit / Joué) qui se jouent aujourd'hui : la carte est proposée, pré-remplie ;
// rien n'est créé tant que le joueur ne l'active pas (08/11, demande de l'utilisateur).
async function chargerAgenda() {
  etat.agenda = [];
  // événements (Saison / Club › Calendrier d'équipe, galaxy/MD_DOC/EVENEMENTS.md) acceptés OU pas encore répondus (pas refusés),
  // non annulés, qui se jouent aujourd'hui : commencer sa carte vaut acceptation (décision utilisateur, 11/11)
  const C = await sb.from("club_evenement_joueurs").select("statut,evenement:club_evenements(id,type,nom,golf,golf_nom,debut,fin,nb_tours,categorie,statut,parcours,repere)")
    .eq("joueur_id", Compte.moi.id).in("statut", ["accepte", "invite"]);
  for (const r of C.data || []) {
    const c = r.evenement;
    if (c?.debut && c.statut !== "annule" && c.debut <= JOUR && JOUR <= (c.fin || c.debut)) {
      const t = { id: "club:" + c.id, ev: c.id, nom: c.nom, golf: c.golf, golf_nom: c.golf_nom, debut: c.debut, fin: c.fin, nb_tours: c.nb_tours, categorie: c.categorie, club: true, type: c.type, parcours: c.parcours, repere: c.repere, invite: r.statut === "invite" };
      etat.agenda.push({ t, statut: "coach", tour: tourDuJour(t, JOUR) });
    }
  }
  // tournois de mes saisons (Envisagé / Inscrit / Joué) qui se jouent aujourd'hui
  const L = await sb.from("saisons").select("id").eq("user_id", Compte.moi.id);
  const ids = (L.data || []).map((x) => x.id); if (!ids.length) return;
  const I = await sb.from("saison_tournois").select("tournoi_id,statut").in("saison_id", ids);
  for (const r of I.data || []) {
    const t = etat.tournois.find((x) => x.id === r.tournoi_id);
    if (t?.debut && t.debut <= JOUR && JOUR <= (t.fin || t.debut)) etat.agenda.push({ t, statut: r.statut, tour: tourDuJour(t, JOUR) });
  }
}
function preremplir(id) {
  const a = etat.agenda.find((x) => x.t.id === id); if (!a) return;
  const g = etat.golfs[a.t.golf];
  ecran("nouvelle");
  $("nv-jour").value = JOUR;
  if (g) { $("nv-golf").value = libGolf(g); majParcours(); }
  if (g && a.t.parcours && [...$("nv-parcours").options].some((o) => o.value === a.t.parcours)) { $("nv-parcours").value = a.t.parcours; majReperes(); }
  if (a.t.repere && [...$("nv-repere").options].some((o) => o.value === a.t.repere)) $("nv-repere").value = a.t.repere;
  if (a.t.club) {   // événement du coach : contexte selon son type, carte rattachée à l'événement (club:<id>)
    $("nv-contexte").value = { rencontre: "rencontre", interne: "libre" }[a.t.type] || "competition"; majTournois();
    etat.attente = { ref: a.t.id, tour: a.tour };
  } else {
    $("nv-contexte").value = "tournoi"; majTournois();
    $("nv-tournoi").value = a.t.id; majTours(); $("nv-tour").value = String(a.tour);
  }
  signaler("Carte pré-remplie : vérifie le parcours et les repères, puis commence la saisie.");
}

// ------------------------------------------------------------------ Nouvelle partie
const golfDuChamp = () => { const v = $("nv-golf").value.trim().toLowerCase(); return Object.values(etat.golfs).find((g) => libGolf(g).toLowerCase() === v || g.nom.toLowerCase() === v) || null; };
const libGolf = (g) => `${titre(g.nom)}${g.ville ? " (" + titre(g.ville) + ")" : ""}`;
function preparerNouvelle() {
  etat.attente = null;   // rattachement à une compétition du coach : posé par preremplir() juste après
  if (!$("nv-jour").value) $("nv-jour").value = JOUR;
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
  majTours();
}
// tour d'un tournoi : par défaut celui du jour (1er jour = tour 1)
const tourDuJour = (t, jour) => Math.min(Math.max(1, Math.round((new Date(jour + "T12:00:00") - new Date(t.debut + "T12:00:00")) / 864e5) + 1), t.nb_tours || 1);
function majTours() {
  const t = etat.tournois.find((x) => x.id === $("nv-tournoi").value), ctx = $("nv-contexte").value === "tournoi";
  $("nv-tour-l").hidden = !ctx || !t || (t.nb_tours || 1) < 2;
  if (!t) return;
  const n = t.nb_tours || 1, d = tourDuJour(t, $("nv-jour").value);
  $("nv-tour").innerHTML = Array.from({ length: n }, (_, k) => `<option value="${k + 1}" ${k + 1 === d ? "selected" : ""}>Tour ${k + 1}</option>`).join("");
}
// choisir un tournoi règle la date de la partie sur son premier jour (sauf si la date tombe déjà pendant le tournoi)
$("nv-tournoi").addEventListener("change", () => {
  const t = etat.tournois.find((x) => x.id === $("nv-tournoi").value);
  if (t?.debut && !($("nv-jour").value >= t.debut && $("nv-jour").value <= (t.fin || t.debut))) $("nv-jour").value = t.debut;
  majTours();
});
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
  if (etat.attente && ligne.contexte !== "tournoi") { ligne.tournoi_id = etat.attente.ref; ligne.tour = etat.attente.tour; }
  else if (ligne.tournoi_id) ligne.tour = +$("nv-tour").value || 1;
  if (ligne.tournoi_id) {
    // déjà une carte pour ce tournoi et ce tour : on l'ouvre plutôt que d'en créer une deuxième
    const deja = etat.parties.find((x) => x.tournoi_id === ligne.tournoi_id && (x.tour || 1) === ligne.tour);
    if (deja) { signaler("Ta carte de ce tour existe déjà : on la rouvre."); etat.partie = deja; etat.i = Math.max(0, deja.trous.findIndex((t) => !t.score)); ecran(deja.terminee ? "voir" : "saisie"); return; }
  }
  $("nv-ok").disabled = true;
  let { data, error } = await sb.from("carte_parties").insert(ligne).select("*").single();
  if (error && /tour|contexte_check/.test(error.message)) {   // script carte-v1-tour.sql pas encore lancé
    delete ligne.tour; if (ligne.contexte === "competition") ligne.contexte = "rencontre";
    ({ data, error } = await sb.from("carte_parties").insert(ligne).select("*").single());
    if (!error) signaler("Carte créée (le tour et le contexte « événement hors Mérite » attendent le script carte-v1-tour.sql).");
  }
  $("nv-ok").disabled = false;
  if (error) { signaler("Création impossible : " + error.message); return; }
  $("nv-form").reset(); $("nv-jour").value = JOUR; etat.attente = null;
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
  const scores = [], bas = 1;   // toujours à partir de 1 : trou en un, albatros, eagle…
  for (let s = bas; s <= t.par + 4; s++) scores.push(s);
  const nomScore = (s) => { const d = s - t.par; return `<b>${s}</b><small>${s === 1 ? "trou en 1" : d <= -3 ? "albatros" : d === -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : d === 2 ? "double" : "+" + d}</small>`; };
  $("sa-contenu").innerHTML = `
    <div class="sa-tete"><div><h2 id="sa-titre">${esc(titre(p.golf_nom || p.golf))}</h2><p class="meta">${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${dateLongue(p.jour)}</p></div>
      <div class="sa-total"><b>${b.n ? b.score : "—"}</b><small>${b.n ? ecartPar(b.ecart) + " · " + b.n + "/" + p.nb_trous : "à toi de jouer"}</small></div></div>
    <div class="sa-trous" role="tablist" aria-label="Trous">${p.trous.map((x, k) => `<button type="button" class="${classeScore(x)}${k === etat.i ? " actif" : ""}" data-aller="${k}" aria-label="Trou ${x.t}">${x.t}<small>${x.score || ""}</small></button>`).join("")}</div>
    <div class="bloc sa-trou">
      <div class="sa-num"><span>Trou <b>${t.t}</b></span><span class="sa-par">Par <b>${t.par}</b></span></div>
      <h3>Score</h3>${t.m ? choix("score", scores, nomScore, false).replace(/<button /g, "<button disabled ") + `<p class="sa-marqueur">🔒 Score saisi par le marqueur${(() => { const d = new Date(t.m); return isNaN(d) ? "" : " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); })()} : complète seulement tes détails (putts, mise en jeu…).</p>` : choix("score", scores, nomScore, true)}
      ${t.score && (t.putts || 0) + (t.pen || 0) > t.score - 1 ? `<p class="sa-alerte">⚠ ${t.putts || 0} putt${t.putts > 1 ? "s" : ""}${t.pen ? ` + ${t.pen} pénalité${t.pen > 1 ? "s" : ""}` : ""} pour un score de ${t.score} : il manque au moins le coup de départ. Vérifie le score ou les putts.</p>` : ""}
      <div class="sa-ligne"><div><h3>Putts</h3>${choix("putts", [0, 1, 2, 3, 4], undefined, true)}</div><div><h3>Pénalités</h3>${choix("pen", [0, 1, 2, 3], undefined, true)}</div></div>
      ${t.par > 3 ? `<h3>Mise en jeu : où a fini ton départ ?</h3>${terrainFw(t.fw)}` : ""}
      <h3>Bunker</h3>${choix("bunker", [false, true], (v) => (v ? "Oui, joué depuis un bunker" : "Non"))}
    </div>
    <div class="sa-nav">
      <button type="button" class="btn" data-pas="-1" ${etat.i === 0 ? "disabled" : ""}>← Trou ${etat.i ? p.trous[etat.i - 1].t : ""}</button>
      <span class="meta" id="sa-etat"></span>
      ${etat.i < p.trous.length - 1 ? `<button type="button" class="btn plein" data-pas="1">Trou ${p.trous[etat.i + 1].t} →</button>` : `<button type="button" class="btn plein" data-finir>Terminer la partie ✓</button>`}
    </div>
    <p class="sa-bas"><button type="button" class="lien" data-ecran="liste">← Mes cartes</button> · <button type="button" class="lien" data-voir-carte>Voir la carte</button> · ${String(p.tournoi_id || "").startsWith("club:") ? `<button type="button" class="lien" data-direct-evt="${esc(p.tournoi_id.slice(5))}">📡 Direct de la partie</button> · ` : ""}<button type="button" class="lien" data-partager>🔗 Partager en direct</button></p>`;
}
$("sa-contenu").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const p = etat.partie, t = p.trous[etat.i];
  if (t.m && (b.dataset.cle === "score" || b.dataset.plus === "score")) return;   // score du marqueur : verrouillé (écran seulement, V1)
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
    // carte d'un événement : le marqueur a pu saisir des scores entre-temps (lien marqueur) ; on reprend ses scores
    // (trous marqués « m ») avant d'écrire, pour ne jamais les écraser avec une version ancienne
    if (String(p.tournoi_id || "").startsWith("club:")) {
      const { data: srv } = await sb.from("carte_parties").select("trous").eq("id", p.id).maybeSingle();
      for (const ts of srv?.trous || []) {
        const tl = p.trous.find((x) => x.t === ts.t);
        if (tl && ts.m && (!tl.m || ts.m > tl.m)) { tl.score = ts.score; tl.m = ts.m; }
      }
    }
    // .select : on vérifie qu'une ligne a vraiment été écrite (session expirée → 0 ligne, sans erreur : faux « enregistré »)
    let { data, error } = await sb.from("carte_parties").update({ trous: p.trous, terminee: p.terminee, modifie_le: p.modifie_le }).eq("id", p.id).select("id");
    if (!error && !data?.length) {   // session à rafraîchir, puis un nouvel essai
      try { await sb.auth.refreshSession?.(); } catch { /* */ }
      ({ data, error } = await sb.from("carte_parties").update({ trous: p.trous, terminee: p.terminee, modifie_le: p.modifie_le }).eq("id", p.id).select("id"));
      if (!error && !data?.length) error = { message: "session expirée : reconnecte-toi (tes saisies sont gardées et repartiront)" };
    }
    const m = $("sa-etat");
    if (error) { if (m) m.textContent = "⚠ pas encore enregistré"; signaler("Enregistrement impossible : " + error.message + " — tes saisies sont gardées dans ce navigateur."); return; }
    try { localStorage.removeItem("carte-brouillon"); } catch { /* */ }
    if (m) m.textContent = "✓ enregistré";
  };
  clearTimeout(minuteurSauve);
  if (tout) ecrire(); else minuteurSauve = setTimeout(ecrire, 600);
}

// carte de score (Voir, direct) ; complet = false : par, score, putts seulement (lien public sans l'option « carte complète »)
const sommeCarte = (T, k) => T.filter((t) => t.score).reduce((s, t) => s + (+t[k] || 0), 0);
function tableauCarte(T, nom, complet = true) {
  const somme = sommeCarte;
  return `<table class="vo-table"><thead><tr><th>Trou</th>${T.map((t) => `<th>${t.t}</th>`).join("")}<th>${nom}</th></tr></thead><tbody>
    <tr><th>Par</th>${T.map((t) => `<td>${t.par}</td>`).join("")}<td><b>${T.reduce((s, t) => s + t.par, 0)}</b></td></tr>
    <tr class="vo-score"><th>Score</th>${T.map((t) => `<td><span class="nt ${notation(t)}">${t.score || "·"}</span></td>`).join("")}<td><b>${somme(T, "score") || "—"}</b></td></tr>
    <tr><th>Putts</th>${T.map((t) => `<td class="${t.putts >= 3 ? "pt-mal" : t.putts === 1 ? "pt-bon" : ""}">${t.putts ?? "·"}</td>`).join("")}<td>${somme(T, "putts") || "—"}</td></tr>
    ${complet ? `<tr><th>Pén.</th>${T.map((t) => `<td>${t.pen ? `<span class="pen">${t.pen}</span>` : "·"}</td>`).join("")}<td>${somme(T, "pen") || "—"}</td></tr>` : ""}
    ${complet ? `<tr><th>Départ</th>${T.map((t) => `<td title="${esc(t.fw || "")}">${t.par === 3 ? "" : t.fw ? miniFw(t.fw) : "·"}</td>`).join("")}<td title="Fairways touchés (par 4 et 5)">${(() => { const F = T.filter((t) => t.score && t.par > 3 && t.fw); return F.length ? `${F.filter((t) => t.fw === "fairway").length}/${F.length}` : "—"; })()}</td></tr>` : ""}
    ${complet ? `<tr><th title="Green en régulation : green atteint en (par − 2) coups ou moins">GIR</th>${T.map((t) => `<td>${t.score && t.putts != null ? (gir(t) ? `<span class="vo-gir" title="Green en régulation">✓</span>` : "·") : ""}</td>`).join("")}<td title="Greens en régulation">${(() => { const C = T.filter((t) => t.score && t.putts != null); return C.length ? `${C.filter(gir).length}/${C.length}` : "—"; })()}</td></tr>` : ""}
    ${complet ? `<tr><th>Bunker</th>${T.map((t) => `<td>${t.bunker ? SABLE : "·"}</td>`).join("")}<td></td></tr>` : ""}</tbody></table>`;
}
// ------------------------------------------------------------------ Voir : la carte de score complète
function rendreVoir() { rendreVoir0(); controleFfgolf().catch(() => {}); }
function rendreVoir0() {
  const p = etat.partie, b = bilan(p), lecture = etat.partage || !!etat.vue || p.user_id !== Compte.moi?.id;
  const moities = p.nb_trous === 18 ? [p.trous.slice(0, 9), p.trous.slice(9)] : [p.trous];
  const tableau = (T, nom) => tableauCarte(T, nom);
  $("vo-contenu").innerHTML = `
    ${etat.partage ? `<div class="pt-direct ${p.terminee ? "fini" : ""}"><span>${p.terminee ? "✓ Partie terminée" : "● En direct"}${p.prenom ? ` · la carte de <b>${esc(p.prenom)}</b>` : ""}</span>
      <small>${p.terminee ? "" : "mise à jour automatique · "}dernière saisie ${new Date(p.modifie_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></div>` : ""}
    <div class="s-tete"><h2>${esc(titre(p.golf_nom || p.golf))}</h2><span class="meta">${esc(p.parcours_nom || "")}${p.repere ? " · " + esc(p.repere) : ""} · ${dateLongue(p.jour)} · ${CONTEXTES[p.contexte] || ""}</span></div>
    <div class="st-tuiles">${tuileSt(b.n ? b.score : "—", "score", b.n ? ecartPar(b.ecart) + (b.n < p.nb_trous ? ` sur ${b.n} trous` : "") : "")}${tuileSt(b.putts ?? "—", "putts")}${tuileSt(b.fairways, "fairways touchés")}${tuileSt(b.gir, "greens en régulation")}${tuileSt(b.pen, "pénalités")}</div>
    ${b.n ? `<button type="button" class="vo-stats" data-stats-tour><span aria-hidden="true">📊</span> <b>Stats du tour</b><small>${etat.partage ? "répartition, putting, mises en jeu…" : `comparées à ta moyenne${p.tournoi_id ? " · tournoi tour par tour" : ""}`}</small></button>` : ""}
    <div class="bloc vo-carte">${moities.map((T, k) => `<div class="defile">${tableau(T, moities.length > 1 ? (k ? "Retour" : "Aller") : "Total")}</div>`).join("")}
      <p class="meta vo-legende"><span class="nt nt-albatros">2</span> albatros <span class="nt nt-aigle">3</span> eagle <span class="nt nt-birdie">4</span> birdie <span class="nt nt-par">5</span> par <span class="nt nt-bogey">6</span> bogey <span class="nt nt-double">7</span> double + · départ ${miniFw("fairway")} · <span class="vo-gir">✓</span> green en régulation · ${SABLE} bunker</p></div>
    ${p.contexte === "tournoi" && p.tournoi_id && !String(p.tournoi_id).startsWith("club:") && !etat.partage ? `<div id="vo-ffgolf"></div>` : ""}
    ${p.note ? `<div class="bloc"><b>Note</b> <span>${esc(p.note)}</span></div>` : ""}
    ${etat.partage ? `<p class="meta pt-pied">Carte partagée par lien (lecture seule) · <a href="../">GolfNexus</a></p>` : `<div class="vo-actions"><button type="button" class="btn" data-ecran="liste">← ${etat.vue ? "Cartes du joueur" : "Mes cartes"}</button>
      ${lecture ? `<span class="meta">Lecture seule</span>` : `<button type="button" class="btn plein" data-partager>🔗 Partager en direct</button><button type="button" class="btn" data-modifier>Modifier la saisie</button><button type="button" class="lien vo-suppr" data-supprimer>Supprimer la partie</button>`}</div>`}`;
}
// Contrôle ffgolf : le trou par trou relevé par la ffgolf (resultats_perso, après le tournoi) comparé à la carte.
// La saisie reste la source immédiate (le joueur a besoin de ses chiffres entre deux tours) ; ici on signale seulement
// les écarts, et le joueur choisit de reprendre les scores officiels (ses détails — putts, départ… — restent).
async function controleFfgolf() {
  const p = etat.partie, box = $("vo-ffgolf"); if (!box) return;
  const { data: r } = await sb.from("resultats_perso").select("trous,pars,tours").eq("user_id", p.user_id).eq("tournoi_id", p.tournoi_id).maybeSingle();
  const t = etat.tournois.find((x) => x.id === p.tournoi_id), tour = p.tour || (t ? tourDuJour(t, p.jour) : 1);
  const off = r?.trous?.[tour - 1];
  if (!off?.length) { box.innerHTML = `<p class="meta ff-attente">Scores ffgolf pas encore relevés pour ce tour : ils seront comparés à ta carte dès leur arrivée (relevé du lundi).</p>`; return; }
  const tous = p.trous.map((h, k) => ({ h, o: off[off.length >= h.t ? h.t - 1 : k] })).filter((x) => x.o && x.h.score !== x.o);   // 18 trous ffgolf : par numéro ; 9 trous : par rang
  const ecarts = tous.filter((x) => x.h.score), manquants = tous.filter((x) => !x.h.score);
  const lecture = !!etat.vue || p.user_id !== Compte.moi?.id;
  box.innerHTML = !tous.length ? `<div class="ff-ok">✓ Conforme aux scores ffgolf (tour ${tour})</div>`
    : `<div class="ff-ecart">${ecarts.length ? `<b>⚠ ${ecarts.length} trou${ecarts.length > 1 ? "s" : ""} diffère${ecarts.length > 1 ? "nt" : ""} des scores ffgolf (tour ${tour}) :</b>
      ${ecarts.map((x) => `trou ${x.h.t} : ffgolf <b>${x.o}</b>, ta carte <b>${x.h.score}</b>`).join(" · ")}` : `<b>✓ Tes scores saisis sont conformes à la ffgolf (tour ${tour}).</b>`}
      ${manquants.length ? `<br>${manquants.length} trou${manquants.length > 1 ? "s" : ""} sans score sur ta carte : la ffgolf peut ${manquants.length > 1 ? "les" : "le"} compléter.` : ""}
      ${lecture ? "" : `<button type="button" class="btn" data-reprendre-ffgolf>${ecarts.length ? "Reprendre les scores ffgolf" : "Compléter avec la ffgolf"}</button>`}</div>`;
  box.dataset.ecarts = JSON.stringify(tous.map((x) => [x.h.t, x.o]));
}
$("vo-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if ("reprendreFfgolf" in b.dataset) {
    const E = JSON.parse($("vo-ffgolf").dataset.ecarts || "[]");
    if (!confirm(`Remplacer ${E.length} score${E.length > 1 ? "s" : ""} par ceux de la ffgolf ? Tes putts, départs, bunkers et pénalités restent.`)) return;
    for (const [t, o] of E) { const h = etat.partie.trous.find((x) => x.t === t); if (h) h.score = o; }
    sauver(true); rendreVoir(); signaler("Scores ffgolf repris."); return;
  }
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
  // coach : le joueur regardé dans un autre module (Saison, Stats) reste choisi
  { const j = nexusJoueurVu.lire(Compte.moi?.id); if (j && (Compte.joueurs || []).some((x) => x.joueur_id === j)) etat.vue = j; }
  document.body.classList.remove("verrou");
  // une saisie non enregistrée (coupure réseau) : on la renvoie
  try { await chargerAgenda(); } catch { etat.agenda = []; }
  const br = jsonLs("carte-brouillon");
  if (br && br.id && br.user_id === Compte.moi.id) { etat.partie = br; sauver(true); }
  if (lireDirect()) { ecran("direct"); return; }   // lien « En direct » (Saison, Club, Carte)
  if (location.hash === "#lives") { ecran("lives"); return; }   // onglet En direct (lien depuis Club)
  chargerLives().then(majBadgeLives).catch(() => {});
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
// seulement, sans compte (fonction carte_partagee), mise à jour toutes les 15 s tant que la partie n'est pas terminée.
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
// Stats du tour : calculées par le module Stats (séparation des rôles), affichées ici dans une fenêtre (Stats en mode compact)
function ouvrirStats() {
  const p = etat.partie; if (!p) return;
  // lien public : Stats lit la même carte par le jeton (sans compte) ; sinon par l'identifiant de la partie
  const src = etat.partage ? `../stats/#direct=${encodeURIComponent(jetonPartage)}&cadre=1`
    : `../stats/#partie=${encodeURIComponent(p.id)}${etat.vue ? `&joueur=${encodeURIComponent(etat.vue)}` : ""}&cadre=1`;
  const f = document.createElement("div"); f.className = "pt-fond"; f.id = "st-fond";
  f.innerHTML = `<div class="pt-boite st-boite" role="dialog" aria-modal="true" aria-labelledby="st-titre-f">
    <div class="st-boite-tete"><h2 id="st-titre-f">📊 Stats du tour</h2>${etat.partage ? "" : `<a class="lien" href="${src.replace("&cadre=1", "")}" target="_top">Ouvrir dans Stats →</a>`}<button type="button" class="btn" id="st-fermer" aria-label="Fermer">✕</button></div>
    <iframe src="${src}" title="Stats du tour" loading="eager"></iframe></div>`;
  document.body.append(f);
  const fermer = () => { f.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => { if (e.key === "Escape") fermer(); };
  document.addEventListener("keydown", esc_);
  f.addEventListener("click", (e) => { if (e.target.id === "st-fond" || e.target.closest("#st-fermer")) fermer(); });
  $("st-fermer").focus();
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-stats-tour]")) ouvrirStats(); });
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
  // toutes les 15 s, et tout de suite quand on revient sur la page (téléphone sorti de veille : les minuteries y sont suspendues)
  let enDirect = await lire();
  const relire = async () => { if (enDirect) enDirect = await lire(); };
  setInterval(relire, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) relire(); });
  window.addEventListener("focus", relire);
}

// ------------------------------------------------------------------ En direct : toutes les cartes d'un événement ou d'un tournoi sur UNE page (11/11)
// galaxy/MD_DOC/EVENEMENTS.md. #evt=<id> : événement (fonction carte_direct : participants ayant accepté) ;
// #tournoi=<id ffgolf> : coach, cartes de SES joueurs suivis rattachées au tournoi (règle « carte : coach lecture ») ;
// #evtdirect=<jeton> : lien public de l'événement, sans compte (carte_direct_public). Mise à jour toutes les 15 s.
const di = { src: null, ouverts: new Set(), minuteur: null, publicJeton: null };
function lireDirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  di.src = h.get("evt") ? { evt: h.get("evt") } : h.get("tournoi") ? { tournoi: h.get("tournoi") } : null;
  return !!di.src;
}
function arreterDirect() { clearInterval(di.minuteur); di.minuteur = null; }
// liste « Tous les directs » : mise à jour chaque minute tant qu'elle est affichée
setInterval(() => { if (!document.hidden && etat.ecran === "lives") rendreLives(); }, 60000);
// retour sur l'onglet (téléphone déverrouillé) : on recharge tout de suite
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (etat.ecran === "direct" && (di.minuteur || di.publicJeton)) rendreDirect();
  else if (etat.ecran === "lives") rendreLives();
});
function allerDirect(src) {
  const h = src.evt ? "evt=" + encodeURIComponent(src.evt) : "tournoi=" + encodeURIComponent(src.tournoi);
  history.pushState(null, "", location.pathname + location.search + "#" + h);
  di.src = src; di.ouverts.clear(); ecran("direct");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-direct-evt]"); if (b) { e.preventDefault(); allerDirect({ evt: b.dataset.directEvt }); }
});
addEventListener("hashchange", () => { if (!di.publicJeton && Compte.moi && lireDirect()) { di.ouverts.clear(); ecran("direct"); } });

// lignes { cle, nom, partie_id, tour, trous, nb_trous, terminee, modifie_le } → joueurs { cle, nom, cartes[] }, classés
function joueursDirect(L) {
  const J = new Map();
  for (const r of L) {
    const j = J.get(r.cle) || { cle: r.cle, nom: r.nom, cartes: [] }; J.set(r.cle, j);
    if (r.trous) j.cartes.push({ ...r, b: bilan(r) });
  }
  for (const j of J.values()) {
    j.cartes.sort((a, b) => (a.tour || 1) - (b.tour || 1) || String(a.jour).localeCompare(String(b.jour)));
    j.n = j.cartes.reduce((s, c) => s + c.b.n, 0);
    j.ecart = j.cartes.reduce((s, c) => s + (c.b.n ? c.b.ecart : 0), 0);
    j.score = j.cartes.reduce((s, c) => s + (c.b.n ? c.b.score : 0), 0);
    j.der = j.cartes[j.cartes.length - 1] || null;   // carte du tour en cours (ou du dernier tour)
    j.maj = j.cartes.reduce((m, c) => (c.modifie_le > m ? c.modifie_le : m), "");
  }
  return [...J.values()].sort((a, b) => (b.n > 0) - (a.n > 0) || a.ecart - b.ecart || b.n - a.n || a.nom.localeCompare(b.nom, "fr"));
}
// la carte d'un tour, en petit (trou, par, score), pour la ligne dépliée
function miniCarte(c, complet) {
  const T = c.trous || [], moities = T.length > 9 ? [T.slice(0, 9), T.slice(9)] : [T];
  return moities.map((M, k) => `<div class="defile">${tableauCarte(M, moities.length > 1 ? (k ? "Retour" : "Aller") : "Total", complet).replace('class="vo-table"', 'class="vo-table di-mini"')}</div>`).join("");
}
async function chargerDirect() {
  if (di.publicJeton) {
    const { data, error } = await sb.rpc("carte_direct_public", { j: di.publicJeton });
    if (error) throw error;
    if (!data?.length) return null;
    const e = data[0];
    return { titre: e.ev_nom, sous: [titre(e.ev_golf_nom || ""), e.ev_debut && dateLongue(e.ev_debut)].filter(Boolean).join(" · "), nbTours: e.ev_nb_tours || 1, statut: e.ev_statut, lignes: data, debut: e.ev_debut, fin: e.ev_fin, complet: !!e.public_complet };
  }
  if (di.src?.evt) {
    const { data, error } = await sb.rpc("carte_direct", { ev: di.src.evt });
    if (error) throw error;
    if (!data?.length) return null;
    const e = data[0];
    return { evt: di.src.evt, titre: e.ev_nom, sous: [titre(e.ev_golf_nom || ""), e.ev_debut && dateLongue(e.ev_debut)].filter(Boolean).join(" · "), nbTours: e.ev_nb_tours || 1,
      statut: e.ev_statut, organisateur: e.organisateur, jeton: e.ev_jeton, complet: !!e.public_complet, lignes: data, debut: e.ev_debut, fin: e.ev_fin };
  }
  // tournoi ffgolf : cartes de mes joueurs suivis rattachées au tournoi
  const t = etat.tournois.find((x) => x.id === di.src.tournoi), suivis = Compte.joueurs || [];
  if (!suivis.length) return { titre: t ? titre(t.nom) : "Tournoi", sous: "", nbTours: 1, lignes: [], vide: "Le direct d'un tournoi ffgolf est réservé aux coachs, pour leurs joueurs suivis." };
  const { data, error } = await sb.from("carte_parties").select("id,user_id,tour,jour,nb_trous,trous,terminee,modifie_le,parcours_nom,repere")
    .eq("tournoi_id", di.src.tournoi).in("user_id", suivis.map((j) => j.joueur_id));
  if (error) throw error;
  const nom = (id) => { const j = suivis.find((x) => x.joueur_id === id); return j?.nom || j?.libelle || "Joueur"; };
  const lignes = (data || []).map((c) => ({ ...c, cle: c.user_id, nom: nom(c.user_id), partie_id: c.id }));
  const nbTours = Math.max(t?.nb_tours || 1, ...lignes.map((c) => c.tour || 1));
  return { titre: t ? titre(t.nom) : "Tournoi ffgolf", sous: [t && titre(t.golf_nom || ""), t?.debut && dateLongue(t.debut)].filter(Boolean).join(" · "), nbTours, lignes, debut: t?.debut, fin: t?.fin,
    note: "Tes joueurs suivis qui saisissent leur carte de ce tournoi dans Carte." };
}
// Mise à jour sans tout redessiner : seuls les blocs qui ont changé sont remplacés (le classement, l'heure de dernière
// saisie) ; le titre, le lien public et les cases restent en place, le défilement du tableau est gardé.
function majBlocs(box, html) {
  const neuf = document.createElement("div"); neuf.innerHTML = html;
  const A = [...box.children], N = [...neuf.children];
  if (A.length !== N.length || A.some((x, i) => x.tagName !== N[i].tagName || x.className.split(" ")[0] !== N[i].className.split(" ")[0])) { box.replaceChildren(...N); return; }
  N.forEach((n, i) => {
    if (A[i].outerHTML === n.outerHTML) return;
    const g = [...A[i].querySelectorAll(".defile")].map((d) => d.scrollLeft);
    A[i].replaceWith(n);
    n.querySelectorAll(".defile").forEach((d, k) => { if (g[k]) d.scrollLeft = g[k]; });
  });
}
async function rendreDirect() {
  const box = $("di-contenu");
  // mise à jour automatique dès l'ouverture, même si le premier chargement échoue ou ne trouve encore rien
  if (!di.minuteur) di.minuteur = setInterval(() => { if (!document.hidden && etat.ecran === "direct") rendreDirect(); }, 15000);
  if (!box.innerHTML.trim()) box.innerHTML = `<p class="meta">Chargement…</p>`;
  let D;
  try { D = await chargerDirect(); }
  catch (e) {
    box.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(e.message || String(e))}${/carte_direct|function/.test(e.message || "") ? "<br>La page En direct n'est pas encore installée dans la base (scripts club-evenements-v2.sql puis carte-direct.sql)." : ""}</div>`;
    return;
  }
  if (!D) {
    box.innerHTML = di.publicJeton ? `<div class="bloc vide"><p><b>Ce lien n'est plus valable.</b></p><p class="meta">L'organisateur a coupé le lien public.</p><a class="btn" href="../">GolfNexus</a></div>`
      : `<div class="bloc vide"><p><b>Rien à afficher pour l'instant.</b></p><p class="meta">Le direct montre les participants qui ont accepté l'invitation. Si tu n'es ni organisateur ni participant, il n'est pas visible.</p>${Compte.moi ? `<button type="button" class="btn" data-ecran="liste">← Mes cartes</button>` : ""}</div>`;
    return;
  }
  const J = joueursDirect(D.lignes), N = D.nbTours;
  const enCours = J.some((j) => j.der && !j.der.terminee), fini = J.length && J.every((j) => j.der?.terminee) && J.every((j) => j.cartes.length >= N);
  const derniere = J.reduce((m, j) => (j.maj > m ? j.maj : m), "");
  const tourCol = (j, k) => { const c = j.cartes.find((x) => (x.tour || 1) === k); return c && c.b.n ? `<b>${c.b.score}</b> <small>${ecartPar(c.b.ecart)}</small>` : "·"; };
  const trou = (j) => !j.der ? "—" : j.der.terminee ? "F" : j.der.b.n ? String(j.der.b.n) : "0";
  let rang = 0, prec = null;
  const lignes = J.map((j, i) => {
    if (j.n) { if (j.ecart !== prec) rang = i + 1; prec = j.ecart; }
    const ouvert = di.ouverts.has(j.cle);
    return `<tr class="di-ligne${ouvert ? " ouvert" : ""}${j.n ? "" : " di-sans"}" data-di="${esc(j.cle)}" tabindex="0" aria-expanded="${ouvert}">
      <td class="di-rang">${j.n ? rang : ""}</td><td class="di-nom"><b>${esc(j.nom)}</b>${j.der && !j.der.terminee && j.der.b.n ? ` <span class="di-live" title="saisie en cours">●</span>` : ""}${j.cartes.length ? ` <span class="di-voir">${ouvert ? "▾ masquer" : "▸ carte"}</span>` : ""}</td>
      <td class="di-trou" title="trous saisis (F = carte terminée)">${trou(j)}</td>
      <td class="di-ecart ${j.n ? (j.ecart < 0 ? "sous" : j.ecart === 0 ? "par" : "") : ""}">${j.n ? ecartPar(j.ecart) : `<small>${j.cartes.length ? "carte ouverte" : "pas encore de carte"}</small>`}</td>
      ${N > 1 ? Array.from({ length: N }, (_, k) => `<td class="di-t">${tourCol(j, k + 1)}</td>`).join("") : ""}
      <td class="di-total">${j.n ? `<b>${j.score}</b>` : ""}</td></tr>
      ${ouvert ? `<tr class="di-detail"><td colspan="${5 + (N > 1 ? N : 0)}">${j.cartes.length ? j.cartes.map((c) => `<div class="di-carte"><p class="meta">${N > 1 ? `Tour ${c.tour || 1} · ` : ""}${esc(c.parcours_nom || "")}${c.repere ? " · " + esc(c.repere) : ""} · ${c.terminee ? "terminée" : `${c.b.n}/${c.nb_trous} trous`}</p>${miniCarte(c, !di.publicJeton || D.complet)}</div>`).join("") : `<p class="meta">Pas encore de carte : le joueur la commence dans Carte (« Ta carte t'attend »).</p>`}</td></tr>` : ""}`;
  }).join("");
  const annule = D.statut === "annule";
  majBlocs(box, `
    <div class="pt-direct ${!enCours ? "fini" : ""}"><span>${annule ? "✕ Événement annulé" : enCours ? "● En direct" : fini ? "✓ Terminé" : "En attente des premières cartes"}</span>
      <small>${enCours ? "mise à jour automatique · " : ""}${derniere ? "dernière saisie " + new Date(derniere).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</small></div>
    <div class="s-tete"><h2>${esc(D.titre)}</h2><span class="meta">${esc(D.sous)}${N > 1 ? ` · ${N} tours` : ""}</span></div>
    ${D.vide ? `<div class="bloc vide">${esc(D.vide)}</div>` : !J.length ? `<div class="bloc vide">Aucune carte pour l'instant.${D.note ? `<br><span class="meta">${esc(D.note)}</span>` : ""}</div>` : `
    <div class="bloc di-bloc"><div class="defile"><table class="di-table"><thead><tr><th></th><th>Joueur</th><th title="trous saisis">Trou</th><th title="score par rapport au par">± Par</th>${N > 1 ? Array.from({ length: N }, (_, k) => `<th>T${k + 1}</th>`).join("") : ""}<th>Total</th></tr></thead>
      <tbody>${lignes}</tbody></table></div>
      <p class="meta di-aide">Touche un joueur pour voir sa carte trou par trou.${D.note ? " " + esc(D.note) : ""}</p></div>`}
    ${D.organisateur && !annule ? `<div class="bloc di-public"><b>Lien public</b> <span class="meta">pour les parents, sans compte : ils voient ce classement (prénom et initiale) et les cartes.</span>
      <div class="di-public-b">${D.jeton ? `<input id="di-lien" readonly value="${esc(location.origin + location.pathname + "#evtdirect=" + D.jeton)}" aria-label="Lien public"><button type="button" class="btn plein" id="di-copier">Copier</button><button type="button" class="lien vo-suppr" id="di-couper">Couper le lien</button>`
        : `<button type="button" class="btn" id="di-activer">🔗 Créer le lien public</button>`}</div>
      <label class="di-option"><input type="checkbox" id="di-complet" ${D.complet ? "checked" : ""}> Carte complète sur le lien public <small class="meta">(sinon : score et putts seulement ; fairways, greens en régulation, pénalités et bunkers restent réservés aux coachs et aux participants)</small></label></div>` : ""}
    ${di.publicJeton ? `<p class="meta pt-pied">Classement partagé par l'organisateur (lecture seule) · <a href="../">GolfNexus</a></p>` : `<div class="vo-actions"><button type="button" class="btn" data-ecran="lives">← Tous les directs</button><button type="button" class="btn" data-ecran="liste">← Mes cartes</button></div>`}`);
  if (annule) arreterDirect();
}
$("di-contenu").addEventListener("click", async (e) => {
  const l = e.target.closest("[data-di]");
  if (l) { const k = l.dataset.di; di.ouverts.has(k) ? di.ouverts.delete(k) : di.ouverts.add(k); rendreDirect(); return; }
  const id = e.target.id;
  if (id === "di-activer" || id === "di-couper") {
    if (id === "di-couper" && !confirm("Couper le lien public ? Les personnes qui l'ont ne verront plus rien.")) return;
    const { error } = await sb.rpc("evenement_lien", { ev: di.src.evt, actif: id === "di-activer" });
    signaler(error ? "Impossible : " + error.message : id === "di-activer" ? "Lien public créé : copie-le et envoie-le." : "Lien public coupé.");
    rendreDirect(); return;
  }
  if (id === "di-complet") {
    const { error } = await sb.from("club_evenements").update({ public_complet: e.target.checked }).eq("id", di.src.evt);
    signaler(error ? "Impossible : " + error.message : e.target.checked ? "Le lien public montre maintenant la carte complète." : "Le lien public ne montre plus que le score et les putts.");
    rendreDirect(); return;
  }
  if (id === "di-copier") { const v = $("di-lien").value; try { await navigator.clipboard.writeText(v); } catch { $("di-lien").select(); document.execCommand("copy"); } signaler("Lien copié."); }
});
$("di-contenu").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-di]")) { e.preventDefault(); e.target.click(); } });
document.addEventListener("visibilitychange", () => { if (!document.hidden && etat.ecran === "direct") rendreDirect(); });
// ------------------------------------------------------------------ onglet « En direct » : tout ce qui se joue aujourd'hui (11/11)
// Événements du jour visibles (droits de la base : organisateur, participant, coach du club ou d'un participant ; l'admin :
// le club sur lequel il est positionné) + pour un coach, tournois ffgolf du jour où ses joueurs suivis saisissent une carte.
// Pas de nouvelle donnée : on s'appuie sur carte_direct et sur la lecture des cartes des joueurs suivis.
async function chargerLives() {
  const L = [];
  const E = await sb.from("club_evenements").select("id,nom,type,golf_nom,debut,fin,nb_tours,statut,structure_id,cree_par").lte("debut", JOUR).neq("statut", "annule");
  let evs = (E.data || []).filter((e) => (e.fin || e.debut) >= JOUR);
  if (Compte.role === "admin") evs = evs.filter((e) => e.cree_par === Compte.moi.id || (Compte.structure?.id && e.structure_id === Compte.structure.id));
  await Promise.all(evs.map(async (e) => {
    const { data } = await sb.rpc("carte_direct", { ev: e.id });
    const R = data || [], joueurs = new Set(R.map((r) => r.cle)), avec = R.filter((r) => r.trous);
    L.push({ evt: e.id, nom: e.nom, lieu: titre(e.golf_nom || ""), quoi: NX_TYPES_EV[e.type] || "Événement", inscrits: joueurs.size,
      saisissent: new Set(avec.map((r) => r.cle)).size, enCours: avec.some((r) => !r.terminee && bilan(r).n), maj: avec.reduce((m, r) => (r.modifie_le > m ? r.modifie_le : m), "") });
  }));
  const suivis = Compte.joueurs || [];
  if (suivis.length) {
    const { data } = await sb.from("carte_parties").select("tournoi_id,user_id,terminee,modifie_le,trous").eq("jour", JOUR).in("user_id", suivis.map((j) => j.joueur_id));
    const parT = {};
    for (const c of data || []) if (c.tournoi_id && !String(c.tournoi_id).startsWith("club:")) (parT[c.tournoi_id] ||= []).push(c);
    for (const [id, C] of Object.entries(parT)) {
      const t = etat.tournois.find((x) => x.id === id);
      L.push({ tournoi: id, nom: t ? titre(t.nom) : "Tournoi ffgolf", lieu: titre(t?.golf_nom || ""), quoi: "Tournoi ffgolf · tes joueurs", inscrits: null,
        saisissent: new Set(C.map((c) => c.user_id)).size, enCours: C.some((c) => !c.terminee && bilan(c).n), maj: C.reduce((m, c) => (c.modifie_le > m ? c.modifie_le : m), "") });
    }
  }
  return L.sort((a, b) => b.enCours - a.enCours || b.maj.localeCompare(a.maj) || a.nom.localeCompare(b.nom, "fr"));
}
function majBadgeLives(L) { const n = L.filter((x) => x.enCours).length, b = $("v-lives-nb"); if (b) { b.textContent = n; b.hidden = !n; } }
async function rendreLives() {
  const box = $("lv-contenu");
  if (!box.innerHTML.trim()) box.innerHTML = `<p class="meta">Chargement…</p>`;   // pas de clignotement à chaque mise à jour
  let L;
  try { L = await chargerLives(); } catch (e) { box.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(e.message || String(e))}</div>`; return; }
  majBadgeLives(L);
  const heure = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  majBlocs(box, L.length ? `<div class="lv-liste">${L.map((x) => `<button type="button" class="lv-ligne${x.enCours ? " live" : ""}" ${x.evt ? `data-lv-evt="${esc(x.evt)}"` : `data-lv-tournoi="${esc(x.tournoi)}"`}>
      <span class="lv-etat">${x.enCours ? "● En direct" : x.maj ? "Terminé ou en pause" : "Pas encore commencé"}</span>
      <b>${esc(x.nom)}</b><small>${esc(x.quoi)}${x.lieu ? " · " + esc(x.lieu) : ""}</small>
      <small>${x.saisissent} joueur${x.saisissent > 1 ? "s" : ""} avec une carte${x.inscrits != null ? ` sur ${x.inscrits}` : ""}${x.maj ? ` · dernière saisie ${heure(x.maj)}` : ""}</small>
      <span class="lv-aller">Ouvrir le direct →</span></button>`).join("")}</div>`
    : `<div class="bloc vide"><p><b>Rien ne se joue aujourd'hui.</b></p><p class="meta">Ici s'affichent les événements du jour${(Compte.joueurs || []).length ? " et les tournois ffgolf où tes joueurs saisissent leur carte" : " auxquels tu participes"}.</p></div>`);
}
$("lv-contenu").addEventListener("click", (e) => {
  const b = e.target.closest(".lv-ligne"); if (!b) return;
  allerDirect(b.dataset.lvEvt ? { evt: b.dataset.lvEvt } : { tournoi: b.dataset.lvTournoi });
});
// ------------------------------------------------------------------ lien marqueur (11/11, galaxy/MD_DOC/EVENEMENTS.md § 7)
// #marqueur=<jeton> : sans compte, le marqueur (parent, joueur, accompagnateur) saisit les scores de chaque joueur de SA partie.
// Fonctions marqueur_partie / marqueur_saisir (club/supabase/club-parties.sql) : la base contrôle le jeton (cette partie,
// jusqu'au jour de l'événement) et fusionne trou par trou dans la carte de chaque joueur, qui la complète ensuite.
const mq = { jeton: null, D: null, i: 0, complet: false, envoi: new Map(), minuteur: null, etat: "", erreur: false };
try { mq.complet = localStorage.getItem("carte-marqueur-complet") === "1"; } catch { /* */ }
async function chargerMarqueur() {
  const { data, error } = await sb.rpc("marqueur_partie", { j: mq.jeton });
  if (error) throw error;
  if (!data?.length) return null;
  const e = data[0], pars = Array.isArray(e.pars) ? e.pars : [];
  const tour = tourDuJour({ debut: e.ev_debut, nb_tours: e.ev_nb_tours || 1 }, JOUR);
  const J = new Map();
  for (const r of data) {
    const j = J.get(r.cle) || { cle: r.cle, nom: r.nom, trous: pars.map((x) => ({ t: x.t, par: x.par })) }; J.set(r.cle, j);
    if (r.trous && (r.tour || 1) === tour) j.trous = pars.map((x) => ({ t: x.t, par: x.par, ...((r.trous || []).find((y) => y.t === x.t) || {}) }));
  }
  // départ du trou 10 : on commence au 10 et on finit par le 9
  const ordre = pars.map((_, k) => k); const k10 = pars.findIndex((x) => x.t === 10);
  if (e.depart === 10 && k10 > 0) ordre.push(...ordre.splice(0, k10));
  return { nom: e.ev_nom, golf: titre(e.ev_golf_nom || ""), numero: e.numero, heure: e.heure, depart: e.depart, parcours: e.parcours_nom, repere: e.repere,
    nbTours: e.ev_nb_tours || 1, tour, pars, ordre, joueurs: [...J.values()] };
}
function rendreMarqueur() {
  const box = $("mq-contenu"), D = mq.D;
  if (!D.pars.length) { box.innerHTML = `<div class="bloc vide">La partie n'a pas encore de trous : demande au coach de recréer le lien marqueur.</div>`; return; }
  const k = D.ordre[mq.i] ?? 0, P = D.pars[k];
  const tot = (j) => { const T = j.trous.filter((t) => t.score); return { n: T.length, s: T.reduce((a, t) => a + t.score, 0), e: T.reduce((a, t) => a + t.score - t.par, 0) }; };
  const fait = (kk) => D.joueurs.length && D.joueurs.every((j) => j.trous[kk]?.score);
  const bouton = (cle, cleJ, v, lib, actif) => `<button type="button" data-mq-cle="${cle}" data-mq-j="${esc(cleJ)}" data-val="${v}" aria-pressed="${actif}">${lib}</button>`;
  box.innerHTML = `
    <div class="mq-tete"><div><h2>${esc(D.nom)}</h2><p class="meta">Partie ${D.numero}${D.heure ? " · " + esc(D.heure.slice(0, 5)) : ""} · départ du ${D.depart} · ${esc(D.golf)}${D.parcours ? " · " + esc(D.parcours) : ""}${D.repere ? " · " + esc(D.repere) : ""}${D.nbTours > 1 ? ` · tour ${D.tour}` : ""}</p></div>
      <span class="mq-etat ${mq.erreur ? "err" : ""}" id="mq-etat">${esc(mq.etat || "marqueur")}</span></div>
    <div class="seg mq-mode" role="group" aria-label="Saisie"><button type="button" data-mq-mode="0" aria-pressed="${!mq.complet}">Score seul</button><button type="button" data-mq-mode="1" aria-pressed="${mq.complet}">Saisie complète</button></div>
    <div class="sa-trous mq-trous" role="tablist" aria-label="Trous">${D.ordre.map((kk, n) => `<button type="button" class="${n === mq.i ? "actif" : ""} ${fait(kk) ? "mq-fait" : ""}" data-mq-aller="${n}">${D.pars[kk].t}</button>`).join("")}</div>
    <div class="mq-trou"><span>Trou <b>${P.t}</b></span><span>Par <b>${P.par}</b></span></div>
    <div class="mq-joueurs">${D.joueurs.map((j) => {
      const t = j.trous[k] || {}, T = tot(j), sc = [P.par - 1, P.par, P.par + 1, P.par + 2].filter((v) => v >= 1);
      if (t.score && !sc.includes(t.score)) sc.push(t.score);
      sc.sort((a, b) => a - b);
      const nomS = (v) => { const d = v - P.par; return d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : d === 2 ? "double" : "+" + d; };
      return `<div class="bloc mq-j"><div class="mq-j-tete"><b>${esc(j.nom)}</b><span class="meta">${T.n ? `${T.s} · ${ecartPar(T.e)} · ${T.n} trou${T.n > 1 ? "s" : ""}` : "pas encore de score"}</span></div>
        <div class="sa-choix mq-scores">${sc.map((v) => bouton("score", j.cle, v, `<b>${v}</b><small>${nomS(v)}</small>`, t.score === v)).join("")}<button type="button" class="sa-plus" data-mq-plus data-mq-j="${esc(j.cle)}" aria-label="Score plus élevé">+</button></div>
        ${mq.complet ? `<div class="mq-details"><div><h3>Putts</h3><div class="sa-choix">${[0, 1, 2, 3, 4].map((v) => bouton("putts", j.cle, v, v, t.putts === v)).join("")}</div></div>
          <div><h3>Pénalités</h3><div class="sa-choix">${[0, 1, 2, 3].map((v) => bouton("pen", j.cle, v, v, t.pen === v)).join("")}</div></div>
          <div><h3>Bunker</h3><div class="sa-choix">${bouton("bunker", j.cle, false, "Non", t.bunker === false)}${bouton("bunker", j.cle, true, "Oui", t.bunker === true)}</div></div>
          ${P.par > 3 ? `<div class="mq-fw" data-mq-fw="${esc(j.cle)}"><h3>Mise en jeu</h3>${terrainFw(t.fw)}</div>` : ""}</div>` : ""}</div>`; }).join("")}</div>
    <div class="sa-nav mq-nav"><button type="button" class="btn" data-mq-pas="-1" ${mq.i === 0 ? "disabled" : ""}>← Trou ${mq.i ? D.pars[D.ordre[mq.i - 1]].t : ""}</button>
      ${mq.i < D.ordre.length - 1 ? `<button type="button" class="btn plein" data-mq-pas="1">Trou ${D.pars[D.ordre[mq.i + 1]].t} →</button>` : `<span class="meta">Dernier trou</span>`}</div>
    <p class="meta pt-pied">Lien marqueur de la partie ${D.numero} : il ne sert que pour cette partie et expire après le jour de l'événement. Chaque joueur complète ensuite sa carte (putts, mise en jeu…). · <a href="../">GolfNexus</a></p>`;
}
function etatMarqueur(txt, err = false) { mq.etat = txt; mq.erreur = err; const e = $("mq-etat"); if (e) { e.textContent = txt; e.classList.toggle("err", err); } }
// envoi groupé par joueur (anti-rebond court) ; en cas d'échec réseau, on garde et on renvoie
function envoyerMarqueur(cleJ, t) {
  const L = mq.envoi.get(cleJ) || new Map(); L.set(t.t, { ...(L.get(t.t) || {}), ...t }); mq.envoi.set(cleJ, L);
  etatMarqueur("enregistrement…");
  clearTimeout(mq.minuteur); mq.minuteur = setTimeout(viderMarqueur, 400);
}
async function viderMarqueur() {
  const lots = [...mq.envoi.entries()]; mq.envoi.clear();
  let echec = false;
  for (const [cle, L] of lots) {
    const { error } = await sb.rpc("marqueur_saisir", { j: mq.jeton, cle, tour: mq.D.tour, trous: [...L.values()] });
    if (error) {
      echec = true;
      if (/lien/.test(error.message)) { etatMarqueur("lien expiré ou coupé", true); return; }
      const R = mq.envoi.get(cle) || new Map(); for (const [k, v] of L) R.set(k, { ...v, ...(R.get(k) || {}) }); mq.envoi.set(cle, R);
    }
  }
  if (echec) { etatMarqueur("hors ligne : nouvel essai…", true); clearTimeout(mq.minuteur); mq.minuteur = setTimeout(viderMarqueur, 5000); }
  else etatMarqueur("✓ enregistré");
}
async function modeMarqueur(jeton) {
  mq.jeton = jeton; etat.ecran = "marqueur";
  finReprise(); document.body.classList.remove("verrou"); document.body.classList.add("partage", "marqueur");
  for (const k of ["liste", "nouvelle", "saisie", "voir", "direct", "lives"]) $("ecran-" + k).hidden = true;
  $("ecran-marqueur").hidden = false;
  const box = $("mq-contenu"); box.innerHTML = `<p class="meta">Chargement…</p>`;
  try { mq.D = await chargerMarqueur(); }
  catch (e) { box.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(e.message || String(e))}</div>`; return; }
  if (!mq.D) { box.innerHTML = `<div class="bloc vide"><p><b>Ce lien marqueur n'est plus valable.</b></p><p class="meta">Il a expiré (il ne sert que jusqu'au jour de l'événement) ou le coach l'a coupé. Demande-lui un nouveau lien.</p><a class="btn" href="../">GolfNexus</a></div>`; return; }
  // reprendre au premier trou où il manque un score
  const n = mq.D.ordre.findIndex((kk) => mq.D.joueurs.some((j) => !j.trous[kk]?.score));
  mq.i = n < 0 ? 0 : n;
  rendreMarqueur();
  addEventListener("online", () => { if (mq.envoi.size) viderMarqueur(); });
}
$("mq-contenu").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || !mq.D) return;
  const D = mq.D, k = D.ordre[mq.i];
  if (b.dataset.mqMode != null) { mq.complet = b.dataset.mqMode === "1"; try { localStorage.setItem("carte-marqueur-complet", mq.complet ? "1" : "0"); } catch { /* */ } rendreMarqueur(); return; }
  if (b.dataset.mqAller != null) { mq.i = +b.dataset.mqAller; rendreMarqueur(); return; }
  if (b.dataset.mqPas) { mq.i = Math.max(0, Math.min(D.ordre.length - 1, mq.i + +b.dataset.mqPas)); rendreMarqueur(); window.scrollTo({ top: 0 }); return; }
  // le joueur : sur le bouton (data-mq-j) ou sur la zone de mise en jeu (data-mq-fw)
  const cleJ = b.dataset.mqJ || b.closest("[data-mq-fw]")?.dataset.mqFw; if (!cleJ) return;
  const j = D.joueurs.find((x) => x.cle === cleJ), t = j?.trous[k]; if (!t) return;
  let cle = b.dataset.mqCle || (b.dataset.cle === "fw" ? "fw" : null), v;
  if ("mqPlus" in b.dataset) { cle = "score"; v = Math.max(t.score || 0, t.par + 2) + 1; }
  else if (cle === "bunker") v = b.dataset.val === "true";
  else if (cle === "fw") v = t.fw === b.dataset.val ? null : b.dataset.val;
  else if (cle) v = +b.dataset.val;
  if (!cle) return;
  if (cle !== "score" && cle !== "fw" && t[cle] === v) v = null;   // second appui : on efface (sauf le score)
  t[cle] = v;
  envoyerMarqueur(cleJ, { t: t.t, [cle]: v });
  rendreMarqueur();
});
async function modeDirectPublic(jeton) {
  di.publicJeton = jeton; etat.ecran = "direct";
  finReprise(); document.body.classList.remove("verrou"); document.body.classList.add("partage");
  for (const k of ["liste", "nouvelle", "saisie", "voir"]) $("ecran-" + k).hidden = true;
  $("ecran-direct").hidden = false;
  rendreDirect();
}

const jetonPartage = new URLSearchParams(location.hash.slice(1)).get("direct");
const jetonEvt = new URLSearchParams(location.hash.slice(1)).get("evtdirect");
const jetonMarqueur = new URLSearchParams(location.hash.slice(1)).get("marqueur");
if (sb && jetonMarqueur) modeMarqueur(jetonMarqueur);
else if (sb && jetonEvt) modeDirectPublic(jetonEvt);
else if (sb && jetonPartage) modePartage(jetonPartage);
else { nexusBrancherAccueil(); if (sb) nexusDemarrer(entrer); }
