"use strict";
// MOIS, MOIS_COURT, AUJ, fmtDate, titre, circuits, plier, tuileSt : briques communes (../commun/v1/nexus.js).
// Club — module n° 2 de la suite GolfNexus : espace coach (joueurs, équipes de l'AS, calendrier d'équipe,
// invitations, mon club). L'administration est dans le module Admin (../admin/). Code repris tel quel de Saison (app.js), où il était depuis GolfNexus.
// S'appuie sur les briques communes (../commun/v1/nexus.js : sb, esc, signaler, accueil, profil, panneau du compte).
// Ce qui affiche une saison ou un tournoi renvoie vers Saison (../saison/#vue=<joueur>, ../saison/#t=<tournoi>).

const etat = { tournois: [], parId: new Map(), clubs: [], golfs: {}, ecran: "coach" };
const $ = (id) => document.getElementById(id);
const tournoiDe = (id) => etat.parId.get(id);
const STRUCTURES = { club: "club", ligue: "ligue", academie: "académie", pole: "pôle / comité", independant: "coach indépendant" };

// ------------------------------------------------------------------ compte (coach ou administrateur)
// Même lecture que Saison : profil (brique commune) + joueurs suivis (accès accepté).
const Compte = {
  moi: null, user: null, role: "joueur", structure: null, fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, mineur: P.mineur, parentValide: P.parentValide, structure: P.structure, fiche: P.fiche });
    this.joueurs = [];
    if (this.role !== "joueur") { const J = await sb.rpc("mes_joueurs"); this.joueurs = (J.data || []).filter((j) => j.statut === "accepte"); }
  },
  // fiche joueur partagée avec Saison (colonne profils.fiche) ; ici seulement « equipesTypes »
  setFiche(champs) {
    this.fiche = { ...this.fiche, ...champs };
    for (const [k, v] of Object.entries(this.fiche)) if (v === null || v === "" || v === undefined) delete this.fiche[k];
    sb.from("profils").update({ fiche: this.fiche, modifie_le: new Date().toISOString() }).eq("id", this.moi.id)
      .then(({ error }) => { if (error) signaler("Enregistrement impossible (profil) : " + error.message); });
  },
};
const estCoach = () => Compte.role === "coach" || Compte.role === "admin";

// ---- bandeau : compte en haut à droite, onglets Coach / Admin
function rendreCompte() {
  const b = $("b-compte"), pan = $("b-pan");
  pan.hidden = !compte.ouvert;
  if (!Compte.user) { b.innerHTML = ""; pan.innerHTML = nexusPanneauConnexion(); return; }
  const mel = Compte.user.email || "", nom = Compte.fiche.nom || mel;
  b.innerHTML = `${selecteurClub()}<button type="button" class="b-btn b-moi" id="c-ouvrir" aria-haspopup="menu" aria-expanded="${compte.ouvert}" aria-controls="b-pan" title="${esc(mel)}">
      <span class="b-init" aria-hidden="true">${esc((nom.trim()[0] || "?").toUpperCase())}</span><span class="b-qui">${esc(nom)}</span><span aria-hidden="true">▾</span></button>`;
  pan.innerHTML = nexusPanneauConnecte(mel);
  brancherClub();
}
nexusBrancherPanneau(rendreCompte, Compte);
document.addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id || e.target.id;
  if (nexusClicPanneau(id, rendreCompte)) return;
  if (id === "c-ouvrir") { compte.ouvert = !compte.ouvert; rendreCompte(); return; }
  if (compte.ouvert && !e.target.closest("#b-pan")) { compte.ouvert = false; rendreCompte(); }   // clic ailleurs : on referme
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && compte.ouvert) { compte.ouvert = false; rendreCompte(); } });

// ---- deux entrées dans le bandeau : Coach (joueurs, équipes, calendrier, invitations) et Mon club (administration du club)
// (l'ancien lien #admin mène au module Admin)
if (location.hash === "#admin") location.replace("../admin/");
function ecran(nom = "coach") {
  if (nom === "vue") { vueClub(); return; }
  mb.acces = null;
  etat.ecran = "coach";
  if (nom === "club") co.onglet = "structure"; else if (co.onglet === "structure") co.onglet = "joueurs";
  $("ecran-coach").hidden = false;
  rendreCompte(); rendreCoach();
  window.scrollTo({ top: 0 });
}
document.querySelector(".vues").addEventListener("click", (e) => { const b = e.target.closest("[data-ecran]"); if (b) ecran(b.dataset.ecran); });
// bandeau et adresse suivent l'onglet affiché (« Mon club » peut aussi s'ouvrir seul : coach pas encore rattaché)
// « Tableau de bord » (08/11) : la même vue que les membres AS, avec tous les onglets (un coach voit tout dans Club)
async function vueClub() {
  const st = await clubCourant();
  for (const b of document.querySelectorAll(".vues button[data-ecran]")) if (b.dataset.ecran === "vue") b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  history.replaceState(null, "", location.pathname + location.search + "#vue");
  $("ecran-coach").hidden = false; rendreCompte(); window.scrollTo({ top: 0 });
  if (!st?.id || st.type !== "club") { mb.acces = null; $("co-titre").textContent = "Tableau de bord"; $("co-contenu").innerHTML = `<div class="bloc vide">Le tableau de bord existe pour un coach rattaché à un club (pas en indépendant).</div>`; return; }
  if (mb.acces?.structure_id !== st.id) mb.cache = {};
  mb.acces = { structure_id: st.id, structure_nom: st.nom, groupe: "coach", cases: CASES.map(([k]) => k) };
  if (!mb.onglet) mb.onglet = "joueurs";
  rendreMembre();
}
function majBandeau(stOk) {
  const club = co.onglet === "structure";
  for (const b of document.querySelectorAll(".vues button[data-ecran]"))
    if ((b.dataset.ecran === "club") === club) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  $("v-club").innerHTML = "Mon club" + (stOk ? "" : ' <span class="nb" title="pas encore rattaché">!</span>');
  history.replaceState(null, "", location.pathname + location.search + (club ? "#club" : "#coach"));
}

// ---- accès aux joueurs, côté coach (repris de Saison : clicAcces / envoiAcces, partie coach)
// « Voir » un joueur (08/11) : raccourcis Saison · Carte · Stats ; le joueur est retenu (bande jaune, nexusJoueurVu) et
// le module s'ouvre sur lui, en lecture seule. Seulement les joueurs dont le coach a l'accès (coach_de).
const liensJoueur = (id) => `<span class="co-voir" role="group" aria-label="Ouvrir le joueur">${[["saison", "Saison"], ["carte", "Carte"], ["stats", "Stats"]]
  .map(([m, l]) => `<button type="button" class="btn" data-voir="${esc(id)}" data-module="${m}">${l}</button>`).join("")}</span>`;
function voirJoueurDans(id, module) {
  const j = (Compte.joueurs || []).find((x) => x.joueur_id === id) || (co.data?.joueurs || []).find((x) => x.joueur_id === id) || {};
  nexusJoueurVu.ecrire(Compte.moi?.id, id, j.nom || j.libelle);
  location.href = module === "saison" ? `../saison/#vue=${encodeURIComponent(id)}&cible=saison` : module === "stats" ? `../stats/#joueur=${encodeURIComponent(id)}` : "../carte/";
}
$("co-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.voir) { voirJoueurDans(b.dataset.voir, b.dataset.module || "saison"); return; }
  if (!b.dataset.accesCoachFin) return;
  const moi = Compte.moi?.id, id = b.dataset.accesCoachFin, j = (co.data?.joueurs || Compte.joueurs || []).find((x) => x.joueur_id === id) || {};
  const nom = j.nom || j.libelle || "ce joueur", eqs = (co.data?.eqDe?.[id] || []).map((e) => e.nom);
  const msg = j.statut === "demande" ? `Annuler ta demande d'accès à ${nom} ?`
    : `Ne plus suivre ${nom} ?\n\nTu ne verras plus sa saison ni ses stats${eqs.length ? `, et il sortira de tes équipes (${eqs.join(", ")})` : ""}.\nPour le suivre à nouveau, il faudra refaire une demande et qu'il l'accepte.`
  if (!confirm(msg)) return;
  const r = await sb.from("acces_coach").delete().eq("coach_id", moi).eq("joueur_id", id);
  if (!r.error && j.statut !== "demande") signaler(`Tu ne suis plus ${nom}.`);
  if (r?.error) signaler("Impossible : " + r.error.message);
  const J = await sb.rpc("mes_joueurs"); Compte.joueurs = (J.data || []).filter((x) => x.statut === "accepte");
  rendreCoach();
});
$("co-contenu").addEventListener("submit", async (e) => {
  if (e.target.id === "p-inviter") {
    e.preventDefault();
    const err = await inviter($("p-inv-email").value.trim().toLowerCase(), $("p-inv-mineur").checked ? "mineur" : "joueur", $("p-inv-nom").value.trim(), $("p-inv-lic").value);
    signaler(err ? (/déjà un compte/.test(err) ? "Ce joueur a déjà un compte : demande l'accès avec sa licence." : "Invitation impossible : " + err)
      : "Invitation envoyée (lien valable 24 heures). Ta demande de suivi l'attendra à son inscription.");
    if (!err) { e.target.reset(); rendreCoach(); }
    return;
  }
  if (e.target.id !== "p-demande") return;
  e.preventDefault();
  const lic = $("p-demande-lic").value.replace(/\s/g, "");
  if (!/^\d{6,12}$/.test(lic)) { signaler("Licence : chiffres uniquement."); return; }
  const { error } = await sb.rpc("demander_acces", { lic, nom: $("p-demande-nom").value.trim() || null });
  signaler(error ? (/structure_manquante/.test(error.message) ? "Renseigne d'abord ta structure (club, ligue, académie…) : les joueurs doivent savoir qui tu représentes." : "Demande impossible : " + error.message) : "Demande envoyée. Si ce joueur a un compte GolfNexus, il la verra dans son profil.");
  rendreCoach();
});

// club affiché dans Mon club et le Tableau de bord : le sien ; l'administrateur (qui aide tous les clubs) choisit le club
async function clubCourant() {
  if (Compte.role !== "admin") return Compte.structure;
  if (!co.clubs) { const S = await sb.from("structures").select("id,type,nom,club,coach_principal").eq("type", "club").order("nom"); co.clubs = S.data || []; }
  // l'administrateur est positionné sur le club de son rattachement (profils.structure_id) : c'est lui que suivent tous les onglets
  co.clubId = Compte.structure?.type === "club" && co.clubs.some((c) => c.id === Compte.structure.id) ? Compte.structure.id : "";
  return co.clubs.find((c) => c.id === co.clubId) || null;
}
// sélecteur de l'administrateur, dans le bandeau à côté de son nom : il se positionne sur un club = il s'y rattache
// (droit admin du cœur sur son propre profil, sans transférer ses joueurs : ils restent à son club d'origine et
// redeviennent visibles quand il y revient). Tous les onglets suivent : Coach (joueurs, équipes), Tableau de bord, Mon club.
const selecteurClub = () => (Compte.role === "admin" && co.clubs?.length ? `<div class="nx-vue-qui b-club"><span aria-hidden="true">🏌️</span>
  <button type="button" class="nx-vue-choix" aria-haspopup="listbox" aria-expanded="false" title="Administrateur : club sur lequel tu es positionné"><b>${esc(co.clubs.find((c) => c.id === co.clubId)?.nom || "Choisir un club")}</b> ▾</button>
  <div class="nx-vue-pop" hidden><input type="search" placeholder="Rechercher un club…" aria-label="Rechercher un club" autocomplete="off"><ul role="listbox"></ul></div></div>` : "");
// après chaque dessin du bandeau : branche la recherche (commun : nxBrancherChoix)
const brancherClub = () => { const c = document.querySelector("#b-compte .b-club");
  if (c) nxBrancherChoix(c, co.clubs.map((x) => ({ id: x.id, nom: x.nom, info: x.club && plier(x.club) !== plier(x.nom) ? titre(x.club) : "" })), (id) => { if (id !== co.clubId) positionnerAdmin(id); }); };
async function positionnerAdmin(sid) {
  const { error } = await sb.from("profils").update({ structure_id: sid, modifie_le: new Date().toISOString() }).eq("id", Compte.moi.id);
  if (error) { signaler("Positionnement impossible : " + error.message); return; }
  try { await Compte.connecter(Compte.moi); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  co.clubId = sid; co.data = null; co.sel = new Set(); co.eqSel = ""; co.equipe = ""; mb.cache = {};
  signaler(`Positionné sur ${co.clubs.find((c) => c.id === sid)?.nom || "ce club"} : tu y agis comme un coach (joueurs, équipes, invitations).`);
  rendreCompte(); if (mb.acces?.groupe === "coach") vueClub(); else rendreCoach();
}
// ---- onglet Coach (coachs et administrateur) : structure, joueurs suivis, invitations ; plus tard les équipes
const co = { onglet: "joueurs", equipe: "", eqSel: "", annee: new Date().getFullYear(), candidats: {}, voir: 50 };
async function rendreCoach() {
  const box = $("co-contenu"); if (!box) return;
  if (Compte.role !== "coach" && Compte.role !== "admin") { box.innerHTML = "<div class='bloc vide'>Réservé aux coachs.</div>"; return; }
  // « Ma structure » obligatoire pour un coach (06/11) : tant qu'elle manque, on y ouvre et les autres onglets y renvoient
  const stOk = !!Compte.structure?.id;
  if (!stOk && !co.vuStructure) { co.onglet = "structure"; co.vuStructure = true; }
  majBandeau(stOk);   // « Mon club » est dans le bandeau, à côté de Coach (07/11)
  $("co-titre").textContent = co.onglet === "structure" ? "Mon club" : "Coach";
  box.innerHTML = `${co.onglet === "structure" ? "" : `<div class="seg co-onglets" role="group" aria-label="Espace coach">${[["joueurs", "Joueurs"], ["equipes", "Équipes de l'AS"], ["calendrier", "Calendrier d'équipe"], ["invitations", "Invitations"]]
    .map(([k, v]) => `<button type="button" data-co-onglet="${k}" aria-pressed="${co.onglet === k}">${v}</button>`).join("")}</div>`}<div id="co-corps"><p class="meta">Chargement…</p></div>`;
  const corps = $("co-corps");
  try {
    if (co.onglet === "structure") {
      const st = await clubCourant(); co.sid = st?.id || null;
      const CC = st?.type === "club" ? await sb.rpc("club_coachs", { sid: st.id }) : { error: true };
      corps.innerHTML = htmlStructure(st, CC) + (st?.type === "club" ? await htmlMembres(st, CC) : "");
    }
    else if (!stOk) corps.innerHTML = `<div class="bloc p-parent"><h3>Tu n'es rattaché à aucun club</h3><p>Un coach travaille dans un club (son académie) ou en indépendant. C'est l'administrateur qui te rattache : demande-lui de le faire. Ensuite, tu verras les joueurs et les équipes de ton club.</p></div>`;
    else corps.innerHTML = co.onglet === "equipes" ? await htmlEquipes() : co.onglet === "calendrier" ? await htmlCalendrierEquipe() : co.onglet === "invitations" ? await htmlInvitations() : await htmlJoueurs();
    if (stOk && co.onglet === "joueurs") majTableJoueurs(); }
  catch (e) { corps.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(e.message || String(e))}</div>`; }
}
const majMots = (x) => x.toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
const infoJoueur = (j) => [j.categorie && majMots(j.categorie), j.naissance && `né${j.sexe === "D" ? "e" : ""} en ${j.naissance}`,
  j.index_golf != null && `index ${String(j.index_golf).replace(".", ",")}`].filter(Boolean).join(" · ");
// ---- onglet Joueurs : tableau compact filtrable (clubs de 300 joueurs), ajout et rangement en masse
const GROUPES = { U12: "U12", U14: "U14", U16: "U16", Adultes: "Adultes", Mid: "Mid-Am (25+)", Seniors: "Seniors (50+)" };
function groupeDe(j) {
  if (!j.naissance) return "";
  const a = new Date().getFullYear() - j.naissance;
  return a <= 12 ? "U12" : a <= 14 ? "U14" : a <= 16 ? "U16" : a < 25 ? "Adultes" : a < 50 ? "Mid" : "Seniors";
}
async function htmlJoueurs() {
  const [J, E] = await Promise.all([sb.rpc("mes_joueurs"), sb.from("equipes").select("id,nom,equipe_joueurs(joueur_id)").order("nom")]);
  const joueurs = J.data || [], equipes = E.data || [];
  const eqDe = {}; for (const e of equipes) for (const m of e.equipe_joueurs || []) (eqDe[m.joueur_id] ||= []).push(e);
  co.data = { joueurs, equipes, eqDe };
  co.f ||= { q: "", groupe: "", sexe: "", eq: "", statut: "", tri: "nom", type: "" };
  co.sel ||= new Set();
  const st = Compte.structure || {}, f = co.f;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="bloc"><div class="co-eq-tete"><h3>Mes joueurs <small>${joueurs.filter((x) => x.statut === "accepte").length} suivis${joueurs.some((x) => x.statut === "demande") ? ` · ${joueurs.filter((x) => x.statut === "demande").length} en attente` : ""}</small></h3>
      <button type="button" class="btn plein" data-co-onglet="invitations">+ Inviter des joueurs</button></div>
      <div class="co-filtres co-barre">
        <input type="search" id="co-f-q" class="co-cherche" placeholder="Nom, prénom, licence…" value="${esc(f.q)}" aria-label="Rechercher" autocomplete="off">
        <select id="co-f-groupe" aria-label="Catégorie">${opt("", "Toutes catégories", f.groupe)}${Object.entries(GROUPES).map(([k, v]) => opt(k, v, f.groupe)).join("")}</select>
        <select id="co-f-sexe" aria-label="Sexe">${opt("", "Tous", f.sexe)}${opt("H", "Messieurs / garçons", f.sexe)}${opt("D", "Dames / filles", f.sexe)}</select>
        <select id="co-f-eq" aria-label="Équipe">${opt("", "Toutes équipes", f.eq)}${opt("-", "Sans équipe", f.eq)}${equipes.map((e) => opt(e.id, e.nom, f.eq)).join("")}</select>
        <select id="co-f-type" aria-label="Joueurs">${opt("", "Tous mes joueurs", f.type)}${opt("as", "Joueurs AS", f.type)}${opt("hors", "Mes joueurs hors club", f.type)}${opt("moi", "Dont je suis le coach", f.type)}</select>
        <select id="co-f-statut" aria-label="Statut">${opt("", "Tous statuts", f.statut)}${opt("accepte", "Accès accordé", f.statut)}${opt("demande", "En attente", f.statut)}</select>
        <select id="co-f-tri" aria-label="Trier par">${opt("nom", "Tri : nom", f.tri)}${opt("index", "Tri : index", f.tri)}${opt("groupe", "Tri : catégorie", f.tri)}</select>
      </div>
      <div class="co-selbarre" id="co-selbarre"></div>
      <div class="st-table co-table"><table><thead><tr><th><input type="checkbox" id="co-tout" aria-label="Tout sélectionner"></th><th>Joueur</th><th>Catégorie</th><th>Index</th><th>Coach</th><th>Équipes</th><th>Statut</th><th></th></tr></thead>
        <tbody id="co-tbody"></tbody></table></div>
      <div id="co-pied"></div></div>`;
}
// ---- onglet « Mon club » (06/11) : la structure du coach, en lecture seule (rattachement par l'administrateur)
function htmlStructure(st, CC = { error: true }) {
  if (!st) return `<div class="bloc p-parent"><h3>Mon club</h3><p>Tu n'es rattaché à aucun club pour l'instant. C'est l'administrateur qui rattache un coach à son club (ou le déclare coach indépendant) : demande-lui de le faire.</p></div>`;
  const club = st.club ? titre(st.club) : null;
  const initiales = (n) => esc(String(n || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase());
  // coachs du club (club_coachs : sans l'administrateur) ; sans le script club-coachs.sql : la fiche du club
  const coachs = !CC.error ? (CC.data || []).map((c) => c.nom) : String(st.coachs || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!CC.error) st = { ...st, principal: (CC.data || []).find((c) => c.principal)?.nom || null };
  const pastille = (n, principal = false) => `<span class="mc-coach${principal ? " principal" : ""}"><i aria-hidden="true">${initiales(n)}</i>${esc(n)}${principal ? ' <small>principal</small>' : ""}</span>`;
  if (st.type === "independant") return `<div class="bloc mc-club"><div class="mc-tete"><div><h3>${esc(st.nom)}</h3><span class="mc-badge">Coach indépendant</span></div></div>
    <p class="meta">Tu suis tes joueurs à titre personnel ; pas d'équipes.</p></div>`;
  return `<div class="bloc mc-club">
    <div class="mc-tete"><div class="mc-blason" aria-hidden="true">${initiales(st.nom)}</div>
      <div><h3>${esc(st.nom)}</h3><span class="mc-badge">Club ffgolf · ${esc(club)}</span></div></div>
    <div class="mc-cartes">
      <section class="mc-carte"><h4><span aria-hidden="true">🎓</span> Académie <small>${coachs.length} coach${coachs.length > 1 ? "s" : ""}</small></h4>
        <div class="mc-coachs">${st.principal ? pastille(st.principal, true) : ""}${coachs.filter((n) => n !== st.principal).map((n) => pastille(n)).join("")}</div>
        <p>Les coachs voient tous les <b>joueurs AS</b> (licenciés à ${esc(club)}) et composent les équipes. Tes <b>joueurs hors club</b> ne sont visibles que par toi.</p></section>
      <section class="mc-carte"><h4><span aria-hidden="true">⛳</span> AS</h4>
        <p>Les équipes de l'AS (onglet Coach → « Équipes de l'AS ») n'accueillent que les licenciés à ${esc(club)}.</p>
        <p>Les membres de l'AS suivent le club dans le <b>Tableau de bord</b>, avec ce que les coachs leur ouvrent.</p></section>
      <section class="mc-carte"><h4><span aria-hidden="true">👥</span> Qui fait quoi</h4>
        <ul class="mc-roles"><li><b>Coach principal</b> invite coachs, membres AS et direction ; règle leur visibilité.</li>
          <li><b>Coachs</b> invitent les joueurs et composent les équipes.</li>
          <li><b>Membres AS · Direction</b> consultent le Tableau de bord, en lecture seule.</li></ul></section>
    </div>
    <p class="meta mc-pied">Rattachement au club et choix du coach principal : l'administrateur.</p></div>`;
}
// ---- Mon club : membres du club et visibilité par groupe (08/11, script supabase/club-membres.sql)
// Seul le coach principal (ou l'admin) fait entrer quelqu'un, directement : fonction Edge du module, club-inviter
// (invitation par e-mail ; compte existant : accès ouvert ; coach : rattaché au club). Membres AS : lecture seule de ce qui
// est coché pour leur groupe (tout décoché par défaut).
const CASES = [["joueurs", "Joueurs", "nom, catégorie, index des joueurs AS"], ["equipes", "Équipes", "équipes de l'AS et leur composition"],
  ["calendrier", "Calendrier", "tournois prévus par les joueurs (envisagé, inscrit)"], ["scores", "Scores", "scores et places en tournoi, une fois joués"],
  ["merite", "Mérite", "classement au Mérite, mois par mois"], ["evenements", "Événements", "rencontres et compétitions du club"]];
const GROUPE_LIB = { coach: "Coach", as: "Membre AS", club: "Direction du club" };
const STATUT_LIB = { demande: "en attente", invite: "invitation envoyée", actif: "actif", refuse: "refusée" };
// invitation dans le club (coach principal, administrateur) : fonction Edge club-inviter ; renvoie le message d'erreur ou null
async function clubInviter(structure_id, groupe, email, nom, licence) {
  const { data, error } = await sb.functions.invoke("club-inviter", { body: { structure_id, groupe, email, nom, licence, site: new URL("../saison/", location.href).href } });
  const msg = error ? (await error.context?.json?.().catch(() => null))?.erreur || error.message : data?.erreur;
  return msg ? { erreur: msg } : data || {};
}
async function htmlMembres(st, CC) {
  const sid = st.id;
  const [G, M, V] = await Promise.all([sb.rpc("club_gere", { sid }), sb.from("club_membres").select("*").eq("structure_id", sid).order("cree_le"),
    sb.from("club_visibilite").select("groupe,cases").eq("structure_id", sid)]);
  if (M.error) return `<div class="bloc"><h3>Membres du club</h3><p class="meta">${/club_membres|schema cache|does not exist/.test(M.error.message) ? "À activer : script supabase/club-membres.sql à lancer dans Supabase." : "Lecture impossible : " + esc(M.error.message)}</p></div>`;
  const gere = co.gere = !!G.data;
  // coachs : tous ceux rattachés au club (club_coachs, club-coachs.sql), y compris par l'administrateur ; statut de l'invitation
  // s'il y en a une. Sans le script : noms seulement (fiche du club).
  const invites = M.data || [];
  const parUid = Object.fromEntries(invites.filter((m) => m.user_id).map((m) => [m.user_id, m]));
  const coachs = !CC.error ? (CC.data || []).map((c) => ({ ...(parUid[c.user_id] || {}), groupe: "coach", nom: c.nom, email: c.email, user_id: c.user_id,
      statut: parUid[c.user_id]?.statut || "actif", depuis: c.depuis, principal: c.principal }))
    : String(st.coachs || "").split(",").map((x) => x.trim()).filter(Boolean).map((n) => ({ nom: n, groupe: "coach", statut: "actif", principal: n === st.principal }));
  const vus = new Set(coachs.map((c) => c.user_id).filter(Boolean));
  const membres = [...coachs, ...invites.filter((m) => !(m.groupe === "coach" && (vus.has(m.user_id) || CC.error)))];
  const casesDe = (g) => new Set((V.data || []).find((v) => v.groupe === g)?.cases || []);
  const date = (d) => (d ? fmtDate(String(d).slice(0, 10)) : "");
  const ligne = (m) => `<tr><td><b>${esc(m.nom || "—")}</b>${m.principal ? ' <span class="tag">principal</span>' : ""}</td><td>${esc(m.email || "—")}</td>
        <td><span class="tag ${m.statut === "actif" ? "" : "ok-att"}">${STATUT_LIB[m.statut] || m.statut}</span></td><td>${date(m.depuis || m.valide_le || m.cree_le) || "—"}</td>
        ${gere ? `<td class="co-act">${m.statut === "invite" && m.id ? `<button type="button" class="btn" data-membre-renvoyer="${esc(m.id)}">Renvoyer</button> ` : ""}${m.principal ? ""
          : m.groupe === "coach" ? (m.user_id ? `<button type="button" class="lien vo-suppr" data-coach-retirer="${esc(m.user_id)}" data-nom="${esc(m.nom || m.email)}">Retirer</button>` : "")
          : `<button type="button" class="lien vo-suppr" data-membre-suppr="${esc(m.id)}" data-nom="${esc(m.nom || m.email)}">Retirer</button>`}</td>` : ""}</tr>`;
  const liste = (g, titreL, vide) => { const L = membres.filter((m) => m.groupe === g && m.statut !== "refuse");
    return `<h4 class="mb-liste-t">${titreL} <small>${L.length}</small></h4>${L.length ? `<div class="st-table"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Statut</th><th>Depuis</th>${gere ? "<th></th>" : ""}</tr></thead><tbody>
      ${L.map(ligne).join("")}</tbody></table></div>` : `<p class="meta">${vide}</p>`}`; };
  return `<div class="bloc mb-bloc"><h3>Membres du club</h3>
    ${liste("coach", "Coachs", "Aucun coach.")}
    ${liste("as", "Membres AS", "Aucun membre AS pour l'instant.")}
    ${liste("club", "Direction du club", "Personne de la direction pour l'instant.")}
    ${gere ? `<h4 class="co-suivi-t">Inviter dans le club</h4>
      <div class="mb-form">
        <input id="mb-nom" placeholder="Prénom Nom" aria-label="Nom" maxlength="60" autocomplete="off">
        <input id="mb-email" type="email" placeholder="e-mail" aria-label="E-mail" autocomplete="off">
        <input id="mb-licence" inputmode="numeric" placeholder="licence ffgolf" aria-label="Licence ffgolf" maxlength="14" autocomplete="off">
        <select id="mb-groupe" aria-label="Rôle"><option value="as">Membre AS</option><option value="coach">Coach</option><option value="club">Direction du club</option></select>
        <button type="button" class="btn plein" id="mb-inviter">Inviter</button></div>
      <p class="meta">L'invitation part tout de suite par e-mail (lien valable 24 h). Si la personne a déjà un compte GolfNexus, son accès est ouvert sans e-mail. Un coach invité est rattaché au club. Licence obligatoire pour un membre AS, facultative pour un coach ou la direction du club.</p>`
    : `<p class="meta">Le coach principal invite les coachs et les membres de l'AS.</p>`}
  </div>
  ${[["as", "membres AS"], ["club", "membres de la direction du club"]].map(([g, lib]) => { const cases = casesDe(g);
    return `<div class="bloc mb-bloc"><h3>Ce que voient les ${lib} <small>dans le Tableau de bord, en lecture seule, même réglage pour tout le groupe</small></h3>
    <div class="mb-cases">${CASES.map(([k, l, d]) => `<label class="mb-case${cases.has(k) ? " oui" : ""}"><input type="checkbox" data-vis="${g}" value="${k}" ${cases.has(k) ? "checked" : ""} ${gere ? "" : "disabled"}>
      <span><b>${l}</b><small>${d}</small></span></label>`).join("")}</div>
    <p class="meta">Jamais visibles : stats, cartes de score, notes du coach, coordonnées. Seuls les joueurs AS qui ont accepté le suivi du club apparaissent.${gere ? "" : " Réglé par le coach principal."}</p>
  </div>`; }).join("")}`;
}
document.addEventListener("change", async (e) => {
  const c = e.target.closest("[data-vis]"); if (!c || !co.gere) return;
  const g = c.dataset.vis, cases = [...document.querySelectorAll(`[data-vis="${g}"]:checked`)].map((x) => x.value);
  c.closest(".mb-case")?.classList.toggle("oui", c.checked);
  const { error } = await sb.from("club_visibilite").upsert({ structure_id: co.sid, groupe: g, cases, modifie_le: new Date().toISOString() });
  const qui = g === "club" ? "Direction du club" : "Membres AS";
  signaler(error ? "Enregistrement impossible : " + error.message : cases.length ? `${qui} : ${cases.length} élément${cases.length > 1 ? "s" : ""} visible${cases.length > 1 ? "s" : ""}.` : `${qui} : rien de visible.`);
});
document.addEventListener("click", async (e) => {
  if (e.target.id === "mb-inviter") {
    const nom = $("mb-nom").value.trim(), email = $("mb-email").value.trim().toLowerCase(), licence = $("mb-licence").value.replace(/\s/g, ""), groupe = $("mb-groupe").value;
    if (!nom) { signaler("Indique le nom."); $("mb-nom").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { signaler("Adresse e-mail invalide."); $("mb-email").focus(); return; }
    if (licence && !/^\d{6,12}$/.test(licence)) { signaler("Licence : 6 à 12 chiffres."); $("mb-licence").focus(); return; }
    if (groupe === "as" && !licence) { signaler("Licence ffgolf obligatoire pour un membre AS."); $("mb-licence").focus(); return; }
    e.target.disabled = true; e.target.textContent = "Envoi…";
    const r = await clubInviter(co.sid, groupe, email, nom, licence || null);
    if (r.erreur) { signaler("Invitation impossible : " + r.erreur); e.target.disabled = false; e.target.textContent = "Inviter"; return; }
    signaler(r.deja_compte ? `${nom} a déjà un compte : accès ouvert${groupe === "coach" ? ", rattaché au club" : ""}.` : `Invitation envoyée à ${email}.`); rendreCoach(); return;
  }
  const rv = e.target.closest("[data-membre-renvoyer]");
  if (rv) {
    const m = (await sb.from("club_membres").select("*").eq("id", rv.dataset.membreRenvoyer).maybeSingle()).data; if (!m) return;
    rv.disabled = true;
    const r = await clubInviter(m.structure_id, m.groupe, m.email, m.nom, m.licence);
    signaler(r.erreur ? "Renvoi impossible : " + r.erreur : r.deja_compte ? "Cette personne s'est connectée : accès ouvert." : "Invitation renvoyée."); rendreCoach(); return;
  }
  const cr = e.target.closest("[data-coach-retirer]");
  if (cr) {
    if (!confirm(`Retirer ${cr.dataset.nom} du club ? Ses joueurs AS restent au club avec un autre coach référent ; ses joueurs hors club le suivent.`)) return;
    cr.disabled = true;
    const { data, error } = await sb.functions.invoke("club-inviter", { body: { action: "retirer", structure_id: co.sid, user_id: cr.dataset.coachRetirer } });
    const msg = error ? (await error.context?.json?.().catch(() => null))?.erreur || error.message : data?.erreur;
    signaler(msg ? "Retrait impossible : " + msg : `${cr.dataset.nom} ne fait plus partie du club.`); rendreCoach(); return;
  }
  const s = e.target.closest("[data-membre-suppr]");
  if (s) {
    if (!confirm(`Retirer ${s.dataset.nom} des membres du club ?`)) return;
    const { error } = await sb.from("club_membres").delete().eq("id", s.dataset.membreSuppr);
    signaler(error ? "Impossible : " + error.message : "Retiré des membres du club."); rendreCoach();
  }
});
// ---- onglet « Invitations » (06/11) : inviter (pas encore de compte), demander l'accès (déjà un compte), suivi
async function htmlInvitations() {
  const [I, J] = await Promise.all([sb.rpc("mes_invitations"), sb.rpc("mes_joueurs")]);
  const inv = I.data || [], dem = (J.data || []).filter((j) => j.statut !== "accepte");
  const attente = inv.filter((i) => !i.connecte), parJoueur = Object.fromEntries(inv.filter((i) => i.joueur_id).map((i) => [i.joueur_id, i]));
  // demandes d'accès en attente des joueurs déjà inscrits (celles des invités pas encore connectés sont dans la 1re liste)
  const dem2 = dem.filter((j) => !(parJoueur[j.joueur_id] && !parJoueur[j.joueur_id].connecte));
  const date = (d) => (d ? fmtDate(String(d).slice(0, 10)) : "");
  return `${panneauAjout()}
    <div class="bloc"><h3>Suivi <small>${attente.length} invitation${attente.length > 1 ? "s" : ""} en attente · ${dem2.length} demande${dem2.length > 1 ? "s" : ""} en attente</small></h3>
      <h4 class="co-suivi-t">Invitations envoyées, pas encore ouvertes</h4>
      ${attente.length ? `<div class="st-table"><table><thead><tr><th>Joueur</th><th>E-mail</th><th>Licence</th><th></th><th>Envoyée le</th><th></th></tr></thead><tbody>
        ${attente.map((i) => `<tr><td><b>${esc(i.nom || "—")}</b></td><td>${esc(i.email)}</td><td>${esc(i.licence || "—")}</td><td>${i.mineur ? '<span class="tag">moins de 18 ans</span>' : ""}</td><td>${date(i.cree_le)}</td>
          <td class="co-act"><button type="button" class="btn" data-reinviter-co="${esc(i.email)}" data-mineur="${i.mineur ? 1 : ""}" data-nom="${esc(i.nom || "")}" data-licence="${esc(i.licence || "")}">Renvoyer</button></td></tr>`).join("")}
        </tbody></table></div><p class="meta">Le lien de l'e-mail est valable 24 heures : passé ce délai, « Renvoyer » en envoie un nouveau.</p>` : `<p class="meta">Aucune invitation en attente.</p>`}
      <h4 class="co-suivi-t">Demandes d'accès en attente de réponse</h4>
      ${dem2.length ? `<div class="st-table"><table><thead><tr><th>Joueur</th><th>Licence</th><th>Demandée le</th><th>Statut</th><th></th></tr></thead><tbody>
        ${dem2.map((j) => `<tr><td><b>${esc(j.nom || j.libelle || "—")}</b></td><td>${esc(j.licence || "—")}</td><td>${date(j.demande_le)}</td>
          <td>${j.statut === "refuse" ? '<span class="tag">refusée</span>' : '<span class="tag ok-att">en attente</span>'}</td>
          <td class="co-act"><button type="button" class="lien" data-acces-coach-fin="${esc(j.joueur_id)}">Annuler</button></td></tr>`).join("")}
        </tbody></table></div><p class="meta">Le joueur (ou son parent pour un mineur) accepte dans « Mon profil ».</p>` : `<p class="meta">Aucune demande en attente.</p>`}
    </div>`;
}
function panneauAjout() {
  return `<div class="bloc"><h3>Inviter des joueurs <small>joueurs majeurs, ou mineurs via l'e-mail du parent</small></h3><div class="co-ajout-grille co-inv-d">
    <form class="co-ajout-bloc" id="p-inviter"><h4>Inviter un joueur</h4><p class="meta">Il reçoit un e-mail GolfNexus (lien valable 24 heures) ; ta demande de suivi l'attend à son inscription. La licence est fixée ici.</p>
      <div class="c-form"><input id="p-inv-email" type="email" placeholder="e-mail (du parent si moins de 18 ans)" aria-label="E-mail" required>
      <input id="p-inv-nom" maxlength="60" placeholder="nom du joueur" aria-label="Nom du joueur">
      <input id="p-inv-lic" inputmode="numeric" maxlength="12" pattern="[0-9 ]{6,14}" required placeholder="licence ffgolf" aria-label="Licence ffgolf du joueur" title="obligatoire : fixée à l'invitation, le joueur ne pourra pas la changer">
      <label class="p-inv-mineur"><input id="p-inv-mineur" type="checkbox"> moins de 18 ans</label><button type="submit" class="btn plein">Inviter</button></div></form>
    <div class="co-ajout-bloc"><h4>Invitations en masse</h4><p class="meta">Une ligne par joueur : <code>e-mail ; licence ; nom ; mineur</code> (licence obligatoire ; « mineur » si moins de 18 ans).</p>
      <textarea id="co-masse-inv" rows="4" placeholder="parent.leo@exemple.fr ; 123456789 ; Léo Martin ; mineur&#10;paul.durand@exemple.fr ; 987654321 ; Paul Durand" aria-label="Invitations"></textarea>
      <button type="button" class="btn plein" id="co-masse-invit">Envoyer les invitations</button></div>
  </div></div>
  <div class="bloc"><h3>Ils ont déjà un compte GolfNexus <small>demander l'accès à leur saison et à leurs stats</small></h3><div class="co-ajout-grille co-inv-d">
    <form class="co-ajout-bloc" id="p-demande"><h4>Demander l'accès</h4><p class="meta">Le joueur (ou son parent) accepte dans son profil.</p>
      <div class="c-form"><input id="p-demande-lic" inputmode="numeric" placeholder="licence ffgolf" aria-label="Licence du joueur" required>
      <input id="p-demande-nom" maxlength="60" placeholder="nom (pour toi)" aria-label="Nom du joueur"><button type="submit" class="btn plein">Demander</button></div></form>
    <div class="co-ajout-bloc"><h4>Demandes en masse</h4><p class="meta">Colle des licences (une par ligne, ou copiées d'un tableur).</p>
      <textarea id="co-masse-lic" rows="4" placeholder="533104300&#10;123456789&#10;…" aria-label="Licences"></textarea>
      <button type="button" class="btn plein" id="co-masse-dem">Envoyer les demandes</button></div>
  </div></div>`;
}
function joueursFiltres() {
  const { joueurs, eqDe } = co.data || { joueurs: [], eqDe: {} }, f = co.f;
  const mots = plier(f.q).trim().split(/\s+/).filter(Boolean);
  const L = joueurs.filter((j) => {
    if (f.statut && j.statut !== f.statut) return false;
    if (f.type === "as" && !j.du_club) return false;
    if (f.type === "hors" && j.du_club) return false;
    if (f.type === "moi" && !j.moi_referent) return false;
    if (f.sexe && j.sexe !== f.sexe) return false;
    if (f.groupe && groupeDe(j) !== f.groupe) return false;
    if (f.eq === "-" && (eqDe[j.joueur_id] || []).length) return false;
    if (f.eq && f.eq !== "-" && !(eqDe[j.joueur_id] || []).some((e) => e.id === f.eq)) return false;
    if (mots.length) { const q = plier([j.nom, j.libelle, j.licence, j.categorie].filter(Boolean).join(" ")); if (!mots.every((w) => q.includes(w))) return false; }
    return true;
  });
  const nom = (j) => j.nom || j.libelle || "";
  const ordreG = Object.keys(GROUPES);
  return L.sort((a, b) => f.tri === "index" ? (a.index_golf ?? 99) - (b.index_golf ?? 99) || nom(a).localeCompare(nom(b), "fr")
    : f.tri === "groupe" ? ordreG.indexOf(groupeDe(a)) - ordreG.indexOf(groupeDe(b)) || nom(a).localeCompare(nom(b), "fr")
    : nom(a).localeCompare(nom(b), "fr"));
}
function majTableJoueurs() {
  const tb = $("co-tbody"); if (!tb) return;
  const L = joueursFiltres(), { eqDe, equipes } = co.data, vus = L.slice(0, co.voir);
  const lib = { demande: "en attente", accepte: "accordé", refuse: "refusé" };
  tb.innerHTML = vus.map((j) => { const ok = j.statut === "accepte";
    return `<tr><td>${ok ? `<input type="checkbox" class="co-sel" data-j="${esc(j.joueur_id)}" ${co.sel.has(j.joueur_id) ? "checked" : ""} aria-label="Sélectionner">` : ""}</td>
      <td>${ok ? `<button type="button" class="s-nom" data-voir="${esc(j.joueur_id)}" title="Voir sa saison">${esc(j.nom || j.libelle || "joueur")}</button>` : `<b>${esc(j.libelle || "Joueur")}</b>`}<small class="co-lic">${esc(j.licence || "")}</small></td>
      <td>${ok ? esc([j.categorie && majMots(j.categorie), j.naissance].filter(Boolean).join(" · ")) : "—"}</td>
      <td>${ok && j.index_golf != null ? String(j.index_golf).replace(".", ",") : "—"}</td>
      <td>${j.moi_referent ? "<b>toi</b>" : esc(j.referent_nom || "—")}${ok && !j.du_club ? ' <span class="tag" title="licencié dans un autre club : visible seulement par son coach">hors club</span>' : ""}</td>
      <td>${(eqDe[j.joueur_id] || []).map((e) => `<span class="co-mini">${esc(e.nom)}</span>`).join(" ") || (ok ? `<span class="meta">—</span>` : "")}</td>
      <td><span class="statut-acces ${j.statut}">${lib[j.statut]}</span></td>
      <td class="co-td-actions"><span class="co-actions">${ok ? `${liensJoueur(j.joueur_id)}` : ""}
        ${ok && j.du_club && !j.moi_referent ? `<button type="button" class="lien" data-referent="${esc(j.joueur_id)}" title="Tu deviens le coach référent de ce joueur">Devenir son coach</button>` : ""}
        <button type="button" class="lien" data-acces-coach-fin="${esc(j.joueur_id)}">${ok ? "Ne plus suivre" : "Annuler"}</button></span></td></tr>`; }).join("")
    || `<tr><td colspan="8" class="meta">${(co.data.joueurs || []).length ? "Aucun joueur pour ces critères." : "Aucun joueur : onglet « Invitations » pour en inviter ou demander l'accès."}</td></tr>`;
  $("co-pied").innerHTML = `<p class="meta">${L.length} joueur${L.length > 1 ? "s" : ""}${L.length > co.voir ? ` · ${co.voir} affichés <button type="button" class="lien" data-co-plus>Afficher ${Math.min(100, L.length - co.voir)} de plus</button>` : ""}</p>`;
  const tout = $("co-tout"), sel = vus.filter((j) => j.statut === "accepte");
  tout.checked = sel.length > 0 && sel.every((j) => co.sel.has(j.joueur_id));
  const n = co.sel.size;
  $("co-selbarre").innerHTML = n ? `<b>${n} sélectionné${n > 1 ? "s" : ""}</b> · Ajouter à l'équipe
    <select id="co-sel-eq">${equipes.map((e) => `<option value="${esc(e.id)}">${esc(e.nom)}</option>`).join("")}</select>
    <button type="button" class="btn plein" id="co-sel-ok">Ajouter</button> <button type="button" class="lien" id="co-sel-vider">Désélectionner</button>` : "";
}

// ---- Équipes : le coach range ses joueurs (accès accepté) ; un joueur peut être dans plusieurs équipes
// équipes types proposées au coach (créées une seule fois, à sa première visite ; ensuite libre de tout changer)
const EQUIPES_TYPES = ["Équipe 1 Messieurs", "Équipe 1 Dames", "Mid-Am Messieurs", "Mid-Am Dames", "Seniors Messieurs", "Seniors Dames", "U16 Garçons", "U16 Filles"];
async function equipesTypes(existantes = []) {
  const manquent = EQUIPES_TYPES.filter((n) => !existantes.includes(n));
  if (manquent.length) { const { error } = await sb.from("equipes").insert(manquent.map((nom) => ({ nom }))); if (error) throw error; }
}
// joueurs qui correspondent à l'équipe d'après son nom (sexe : Messieurs/Garçons, Dames/Filles ; âge : U12/U14/U16, Mid-Am 25+, Seniors 50+)
// catégorie de tournois d'une équipe, déduite de son nom (06/11) : « Équipe 1 Messieurs » → Adultes + hommes,
// « U16 Filles » → Jeunes + filles, « Mid-Am Dames » → Mid-Amateurs + femmes, « Seniors… » → Seniors ; sinon tout
function tournoisEquipe(nom) {
  const n = plier(nom || "");
  const circuit = /\bu1\d|\bu\d\b|garcons|filles|jeunes|benjamin|minime|poussin/.test(n) ? "jeunes" : /mid/.test(n) ? "mid" : /senior/.test(n) ? "seniors"
    : /equipe|messieurs|dames|hommes|femmes|adulte/.test(n) ? "gp" : null;
  const sexe = /messieurs|garcons|hommes/.test(n) ? "H" : /dames|filles|femmes/.test(n) ? "D" : null;
  return { circuit, sexe, ok: (t) => (!circuit || circuitDe(t) === circuit) && (!sexe || (sexe === "H" ? t.sexe !== "Femme" : t.sexe !== "Homme")) };
}
function correspondEquipe(nom, j) {
  const n = plier(nom), an = new Date().getFullYear(), age = j.naissance ? an - j.naissance : null;
  if (/messieurs|garcons|hommes/.test(n) && j.sexe === "D") return false;
  if (/dames|filles|femmes/.test(n) && j.sexe === "H") return false;
  const u = n.match(/u(\d\d)/); if (u && age != null && age > +u[1]) return false;
  if (/mid/.test(n) && age != null && age < 25) return false;
  if (/senior/.test(n) && age != null && age < 50) return false;
  return true;
}
// résultats de recherche pour l'ajout (au plus 8 : un club peut avoir 300 joueurs)
function resultatsAjout(eqId, texte) {
  const L = co.candidats[eqId] || [], q = plier(texte).trim(), mots = q ? q.split(/\s+/) : [];
  const t = mots.length ? L.filter((c) => mots.every((w) => c.q.includes(w))) : L;
  if (!mots.length && L.length > 8) return `<p class="meta">${L.length} joueurs correspondent à cette équipe : tape un nom, un prénom ou une licence.</p>`;
  if (!t.length) return `<p class="meta">Aucun joueur trouvé.</p>`;
  return t.slice(0, 8).map((c) => `<div class="co-ligne"><div><b>${esc(c.nom)}</b>${c.info ? `<small>${esc(c.info)}</small>` : ""}</div>
    <button type="button" class="btn plein" data-eq-ajouter="${esc(eqId)}" data-j="${esc(c.id)}">Ajouter</button></div>`).join("")
    + (t.length > 8 ? `<p class="meta">… et ${t.length - 8} autres : précise la recherche.</p>` : "");
}
async function htmlEquipes() {
  let [E, J] = await Promise.all([sb.from("equipes").select("id,nom,equipe_joueurs(joueur_id)").order("nom"), sb.rpc("mes_joueurs")]);
  if (E.error) throw E.error;
  if (!(E.data || []).length && !Compte.fiche.equipesTypes) {   // première visite : équipes types
    await equipesTypes(); Compte.setFiche({ equipesTypes: true });
    E = await sb.from("equipes").select("id,nom,equipe_joueurs(joueur_id)").order("nom");
  }
  const ordre = (n) => { const i = EQUIPES_TYPES.indexOf(n); return i < 0 ? 99 : i; };
  E.data = (E.data || []).sort((a, b) => ordre(a.nom) - ordre(b.nom) || a.nom.localeCompare(b.nom, "fr"));
  const tous = (J.data || []).filter((j) => j.statut === "accepte"), nomDe = (id) => tous.find((j) => j.joueur_id === id);
  // équipes de l'AS : seuls les Joueurs AS (licenciés au club de la structure) peuvent y entrer
  const club = Compte.structure?.club, ok = club ? tous.filter((j) => j.du_club) : tous;
  // une équipe à la fois : onglets (≤ 8 équipes) ou liste déroulante au-delà ; « + Nouvelle équipe » = création
  const eqs = E.data || [];
  if (co.eqSel !== "nouvelle" && !eqs.some((e) => e.id === co.eqSel)) co.eqSel = eqs[0]?.id || "nouvelle";
  const n = (e) => (e.equipe_joueurs || []).length;
  let h = eqs.length <= 8
    ? `<div class="co-eq-onglets co-eq-pastilles" role="tablist">${eqs.map((e) => `<button type="button" role="tab" data-eq-sel="${esc(e.id)}" aria-selected="${e.id === co.eqSel}">${esc(e.nom)} <small>${n(e)}</small></button>`).join("")}
       <button type="button" role="tab" class="nouvelle" data-eq-sel="nouvelle" aria-selected="${co.eqSel === "nouvelle"}">+ Nouvelle équipe</button></div>
       <div class="co-eq-onglets co-eq-mobile"><select id="co-eq-liste" aria-label="Équipe">${eqs.map((e) => `<option value="${esc(e.id)}" ${e.id === co.eqSel ? "selected" : ""}>${esc(e.nom)} (${n(e)})</option>`).join("")}
         <option value="nouvelle" ${co.eqSel === "nouvelle" ? "selected" : ""}>+ Nouvelle équipe</option></select></div>`
    : `<div class="co-eq-onglets"><select id="co-eq-liste" aria-label="Équipe">${eqs.map((e) => `<option value="${esc(e.id)}" ${e.id === co.eqSel ? "selected" : ""}>${esc(e.nom)} (${n(e)})</option>`).join("")}</select>
       <button type="button" role="tab" class="nouvelle" data-eq-sel="nouvelle" aria-selected="${co.eqSel === "nouvelle"}">+ Nouvelle équipe</button></div>`;
  if (!ok.length) h += `<div class="bloc vide">${club ? `Aucun Joueur AS (licencié à ${esc(titre(club))}) suivi pour l'instant : invite-les ou demande l'accès dans l'onglet « Invitations », puis range-les ici.` : "Aucun joueur suivi pour l'instant : invite-les ou demande l'accès dans l'onglet « Invitations », puis range-les ici."}</div>`;
  else if (club) h += `<p class="meta">Équipes de l'AS : seuls les licenciés à ${esc(titre(club))} peuvent y entrer ; elles sont partagées par tous les coachs de l'académie.</p>`;
  if (co.eqSel === "nouvelle") return h + `<form class="bloc" id="co-eq-form"><h3>Nouvelle équipe</h3><div class="c-form"><input id="co-eq-nom" maxlength="60" required placeholder="ex. Équipe 2, U14 Garçons, Interclubs" aria-label="Nom de l'équipe">
    <button type="submit" class="btn plein">Créer l'équipe</button></div>
    ${EQUIPES_TYPES.some((x) => !eqs.some((e) => e.nom === x)) ? `<p class="meta">Équipes types manquantes : ${EQUIPES_TYPES.filter((x) => !eqs.some((e) => e.nom === x)).map(esc).join(", ")}.
      <button type="button" class="lien" id="co-eq-types">Les ajouter</button></p>` : ""}
    <p class="meta">Astuce : le nom guide les joueurs proposés (Messieurs / Dames, U12 / U14 / U16, Mid-Am, Seniors).</p></form>`;
  for (const e of eqs.filter((x) => x.id === co.eqSel)) {
    const membres = (e.equipe_joueurs || []).map((m) => m.joueur_id), dispo = ok.filter((j) => !membres.includes(j.joueur_id));
    h += `<div class="bloc co-equipe"><div class="co-eq-tete"><h3>${esc(e.nom)} <small>${membres.length} joueur${membres.length > 1 ? "s" : ""}</small></h3>
      <button type="button" class="lien" data-eq-cal="${esc(e.id)}">Calendrier</button><button type="button" class="lien" data-eq-nom="${esc(e.id)}" data-nom="${esc(e.nom)}">Renommer</button><button type="button" class="lien" data-eq-suppr="${esc(e.id)}">Supprimer</button></div>
      <div class="co-deux">
        <div><h4>Dans l'équipe <small>${membres.length}</small></h4>
          ${membres.length > 10 ? `<input type="search" class="co-cherche" data-filtre="co-membres-${esc(e.id)}" placeholder="Filtrer l'équipe…" aria-label="Filtrer l'équipe" autocomplete="off">` : ""}
          <div class="co-defile" id="co-membres-${esc(e.id)}">${membres.map((id) => nomDe(id)).sort((a, b) => (a?.nom || "").localeCompare(b?.nom || "", "fr")).map((j) => j && j.joueur_id).filter(Boolean).concat(membres.filter((id) => !nomDe(id))).map((id) => { const j = nomDe(id); return `<div class="co-ligne" data-q="${esc(plier([j?.nom, j?.libelle, j?.licence, j?.categorie].filter(Boolean).join(" ")))}"><div><b>${esc(j?.nom || j?.libelle || "joueur")}</b>${j && infoJoueur(j) ? `<small>${esc(infoJoueur(j))}</small>` : ""}</div>
            <span class="co-actions">${liensJoueur(id)}
            <button type="button" class="lien" data-eq-retirer="${esc(e.id)}|${esc(id)}">Retirer</button></span></div>`; }).join("") || `<p class="meta">Personne pour l'instant : cherche un joueur à droite et clique sur « Ajouter ».</p>`}</div></div>
        <div>${(() => { const ok2 = dispo.filter((j) => correspondEquipe(e.nom, j));
          co.candidats[e.id] = ok2.map((j) => ({ id: j.joueur_id, nom: j.nom || j.libelle || j.licence, info: infoJoueur(j),
            q: plier([j.nom, j.libelle, j.licence, j.categorie].filter(Boolean).join(" ")) })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
          return `<h4>Joueurs à ajouter <small>${ok2.length}</small></h4>` + (ok2.length
          ? `<input type="search" class="co-cherche" data-eq-cherche="${esc(e.id)}" placeholder="Rechercher : nom, prénom, licence, catégorie…" aria-label="Rechercher un joueur à ajouter" autocomplete="off">
             <div data-eq-props="${esc(e.id)}">${resultatsAjout(e.id, "")}</div>`
          : `<p class="meta">Aucun autre Joueur AS ne correspond à cette équipe (sexe, âge).</p>`); })()}</div>
      </div></div>`;
  }
  return h;
}
// ---- Parties et lien marqueur d'un événement (11/11, galaxy/MD_DOC/EVENEMENTS.md § 7, club/supabase/club-parties.sql) :
// le coach compose les parties (heure, départ 1 ou 10), y range les invités, et envoie un LIEN MARQUEUR par partie à qui il
// veut (parent, joueur…, sans compte) ; le marqueur saisit les scores de la partie dans Carte (#marqueur=<jeton>).
function lienMarqueur(jeton) { return new URL("../carte/", location.href).href + "#marqueur=" + jeton; }
// trous joués relevés dans les données publiées (parcours de l'événement, sinon le premier du golf)
function parsDeLEvenement(ev) {
  const g = etat.golfs[ev.golf], P = g?.parcours || [], p = P.find((x) => x.code === ev.parcours) || P[0];
  if (!p) return null;
  const nb = p.trous === 9 ? 9 : 18, par = p.par_trous || [];
  return { pars: Array.from({ length: nb }, (_, k) => ({ t: k + 1, par: par[k] || 4 })), nb_trous: nb, parcours: p.code, parcours_nom: p.nom,
    repere: ev.repere || null, golf: ev.golf, golf_nom: ev.golf_nom || g?.nom || null };
}
async function ouvrirParties(ev) {
  const nomJ = (id) => (co.calJoueurs || []).find((j) => j.id === id)?.nom || "joueur";
  const f = document.createElement("div"); f.className = "nx-ev-fond";
  f.innerHTML = `<div class="nx-ev-boite pa-boite" role="dialog" aria-modal="true" aria-labelledby="pa-t"><h2 id="pa-t">Parties · marqueurs</h2><div id="pa-corps"><p class="meta">Chargement…</p></div>
    <div class="nx-ev-pied"><button type="button" class="btn" id="pa-fermer">Fermer</button></div></div>`;
  document.body.append(f);
  const corps = f.querySelector("#pa-corps");
  const fermer = () => { f.remove(); document.removeEventListener("keydown", touche); rendreCoach(); };
  const touche = (e) => { if (e.key === "Escape") fermer(); };
  document.addEventListener("keydown", touche);
  let P = [], I = [];
  const rendre = async () => {
    const [A, B] = await Promise.all([sb.from("club_evenement_parties").select("*").eq("evenement_id", ev.id).order("numero"),
      sb.from("club_evenement_joueurs").select("joueur_id,statut,partie_id").eq("evenement_id", ev.id)]);
    if (A.error || B.error) {
      const m = (A.error || B.error).message;
      corps.innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(m)}${/club_evenement_parties|partie_id/.test(m) ? "<br>Script <b>club/supabase/club-parties.sql</b> à lancer dans Supabase." : ""}</div>`; return;
    }
    P = A.data || []; I = (B.data || []).filter((x) => x.statut !== "refuse").sort((a, b) => nomJ(a.joueur_id).localeCompare(nomJ(b.joueur_id), "fr"));
    const opt = (x) => `<option value="">— pas de partie</option>${P.map((p) => `<option value="${esc(p.id)}" ${p.id === x.partie_id ? "selected" : ""}>Partie ${p.numero}</option>`).join("")}`;
    corps.innerHTML = `<p class="meta"><b>${esc(ev.nom)}</b> · ${esc(fmtDate(ev.debut))}. Range chaque invité dans une partie, puis envoie à chaque marqueur (parent, joueur, accompagnateur) le lien de sa partie : il saisit les scores sans compte. Le lien ne marche que pour cette partie et expire après le jour de l'événement.</p>
      <div class="pa-parties">${P.map((p) => { const J = I.filter((x) => x.partie_id === p.id);
        return `<div class="pa-partie" data-pa="${esc(p.id)}"><div class="pa-tete"><b>Partie ${p.numero}</b>
          <label>Heure <input type="time" data-pa-heure value="${esc((p.heure || "").slice(0, 5))}"></label>
          <label>Départ <select data-pa-depart><option value="1" ${p.depart === 1 ? "selected" : ""}>trou 1</option><option value="10" ${p.depart === 10 ? "selected" : ""}>trou 10</option></select></label>
          <button type="button" class="lien vo-suppr" data-pa-suppr>Supprimer</button></div>
          <div class="pa-joueurs">${J.length ? J.map((x) => `<span class="co-puce ev-${esc(x.statut)}">${esc(nomJ(x.joueur_id))}</span>`).join("") : `<span class="meta">aucun joueur : range-les ci-dessous</span>`}</div>
          <div class="pa-lien">${p.jeton ? `<input readonly value="${esc(lienMarqueur(p.jeton))}" aria-label="Lien marqueur de la partie ${p.numero}"><button type="button" class="btn plein" data-pa-copier>Copier</button>${navigator.share ? `<button type="button" class="btn" data-pa-envoyer>Envoyer…</button>` : ""}<button type="button" class="lien vo-suppr" data-pa-couper>Couper le lien</button>`
            : `<button type="button" class="btn" data-pa-lien ${J.length ? "" : "disabled"}>🔗 Créer le lien marqueur</button>`}</div></div>`; }).join("")}</div>
      <button type="button" class="btn" id="pa-plus">+ Ajouter une partie</button>
      ${I.length ? `<h3 class="pa-h3">Invités</h3><div class="pa-invites">${I.map((x) => `<label><span>${esc(nomJ(x.joueur_id))}${x.statut === "invite" ? " <small>(pas encore répondu)</small>" : ""}</span><select data-pa-joueur="${esc(x.joueur_id)}" ${P.length ? "" : "disabled"}>${opt(x)}</select></label>`).join("")}</div>`
        : `<p class="meta">Aucun invité : invite d'abord des joueurs (« Modifier · inviter »).</p>`}`;
  };
  const err = (e) => signaler("Impossible : " + nxErreurEv(e));
  f.addEventListener("click", async (e) => {
    if (e.target === f || e.target.id === "pa-fermer") { fermer(); return; }
    const b = e.target.closest("button"); if (!b) return;
    const p = P.find((x) => x.id === b.closest("[data-pa]")?.dataset.pa);
    if (b.id === "pa-plus") {
      const { error } = await sb.from("club_evenement_parties").insert({ evenement_id: ev.id, numero: Math.max(0, ...P.map((x) => x.numero)) + 1, heure: ev.heure || null });
      if (error) err(error); return rendre();
    }
    if (!p) return;
    if (b.hasAttribute("data-pa-suppr")) {
      if (!confirm(`Supprimer la partie ${p.numero} ? Ses joueurs n'auront plus de partie et son lien marqueur ne marchera plus.`)) return;
      const { error } = await sb.from("club_evenement_parties").delete().eq("id", p.id); if (error) err(error); return rendre();
    }
    if (b.hasAttribute("data-pa-lien")) {
      const g = parsDeLEvenement(ev);
      if (!g) { signaler("Parcours inconnu pour ce golf : impossible de préparer la carte du marqueur."); return; }
      const u = await sb.from("club_evenement_parties").update(g).eq("id", p.id); if (u.error) { err(u.error); return; }
      const { error } = await sb.rpc("partie_lien", { p: p.id, actif: true }); if (error) err(error); else signaler("Lien marqueur créé : copie-le et envoie-le au marqueur.");
      return rendre();
    }
    if (b.hasAttribute("data-pa-couper")) {
      if (!confirm("Couper ce lien ? Le marqueur ne pourra plus saisir (les scores déjà saisis restent).")) return;
      const { error } = await sb.rpc("partie_lien", { p: p.id, actif: false }); if (error) err(error); return rendre();
    }
    if (b.hasAttribute("data-pa-copier")) { const v = lienMarqueur(p.jeton); try { await navigator.clipboard.writeText(v); } catch { b.parentElement.querySelector("input").select(); document.execCommand("copy"); } signaler("Lien copié."); return; }
    if (b.hasAttribute("data-pa-envoyer")) { navigator.share({ title: `Marqueur · ${ev.nom}`, text: `Lien marqueur de la partie ${p.numero} (${ev.nom}) : saisis les scores de ta partie.`, url: lienMarqueur(p.jeton) }).catch(() => {}); }
  });
  f.addEventListener("change", async (e) => {
    const t = e.target, p = P.find((x) => x.id === t.closest("[data-pa]")?.dataset.pa);
    if (t.dataset.paJoueur) { const { error } = await sb.rpc("partie_affecter", { ev: ev.id, p_joueur: t.dataset.paJoueur, p_partie: t.value || null }); if (error) err(error); return rendre(); }
    if (p && t.hasAttribute("data-pa-heure")) { const { error } = await sb.from("club_evenement_parties").update({ heure: t.value || null }).eq("id", p.id); if (error) err(error); }
    if (p && t.hasAttribute("data-pa-depart")) { const { error } = await sb.from("club_evenement_parties").update({ depart: +t.value }).eq("id", p.id); if (error) err(error); }
  });
  rendre();
}
// ---- Calendrier d'équipe : les saisons des joueurs superposées, par tournoi (qui y va, avec quel statut, quelle place)
async function htmlCalendrierEquipe() {
  const [E, J] = await Promise.all([sb.from("equipes").select("id,nom,equipe_joueurs(joueur_id)").order("nom"), sb.rpc("mes_joueurs")]);
  const ok = (J.data || []).filter((j) => j.statut === "accepte"), eq = (E.data || []).find((e) => e.id === co.equipe);
  if (co.equipe && !eq) co.equipe = "";
  const ids = eq ? (eq.equipe_joueurs || []).map((m) => m.joueur_id) : ok.map((j) => j.joueur_id);
  const nom = (id) => { const j = ok.find((x) => x.joueur_id === id); return j?.nom || j?.libelle || "joueur"; };
  const annees = [...new Set(etat.tournois.map((t) => t.annee))].sort();
  // choix de l'équipe : même présentation que « Équipes de l'AS » (pastilles ; liste déroulante sur téléphone)
  const ordre = (n) => { const i = EQUIPES_TYPES.indexOf(n); return i < 0 ? 99 : i; };
  const eqs = (E.data || []).slice().sort((a, b) => ordre(a.nom) - ordre(b.nom) || a.nom.localeCompare(b.nom, "fr")), nb = (e) => (e.equipe_joueurs || []).length;
  let h = `<div class="co-eq-onglets co-eq-pastilles" role="tablist"><button type="button" role="tab" data-cal-eq="" aria-selected="${!co.equipe}">Tous les joueurs <small>${ok.length}</small></button>
      ${eqs.map((e) => `<button type="button" role="tab" data-cal-eq="${esc(e.id)}" aria-selected="${e.id === co.equipe}">${esc(e.nom)} <small>${nb(e)}</small></button>`).join("")}</div>
    <div class="co-eq-onglets co-eq-mobile"><select id="co-cal-eq" aria-label="Équipe"><option value="">Tous les joueurs (${ok.length})</option>${eqs.map((e) =>
    `<option value="${esc(e.id)}" ${e.id === co.equipe ? "selected" : ""}>${esc(e.nom)} (${nb(e)})</option>`).join("")}</select></div>
    <div class="bloc co-filtres"><label>Année <select id="co-cal-an">${annees.map((a) => `<option ${a === co.annee ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <span class="st-legende"><span><i class="lg s-envisage"></i>envisagé</span><span><i class="lg s-inscrit"></i>inscrit</span><span><i class="lg s-joue"></i>joué</span><span><i class="lg s-evt"></i>événement</span></span>
    <button type="button" class="btn plein co-ev-plus" data-ev-nouveau>+ Ajouter un événement</button></div>`;
  co.calJoueurs = ok.map((j) => ({ id: j.joueur_id, nom: j.nom || j.libelle || "joueur", info: j.categorie || "" })); co.calIds = eq ? ids : []; co.calEquipe = eq?.nom || "";
  if (!ids.length) return h + `<div class="bloc vide">Pas de joueur dans ${eq ? "cette équipe" : "ta liste"}.</div>`;
  // événements (galaxy/MD_DOC/EVENEMENTS.md) : ceux du club et ceux que j'ai créés, de l'année ; invités et réponses
  const sidClub = Compte.structure?.id, moi = Compte.moi?.id;
  const EV = await sb.from("club_evenements").select("*,club_evenement_joueurs(joueur_id,statut)")
    .or([sidClub && `structure_id.eq.${sidClub}`, moi && `cree_par.eq.${moi}`].filter(Boolean).join(","))
    .gte("debut", `${co.annee}-01-01`).lte("debut", `${co.annee}-12-31`);
  co.evs = (EV.data || []).filter((e) => !eq || !(e.club_evenement_joueurs || []).length || e.club_evenement_joueurs.some((x) => ids.includes(x.joueur_id)));
  co.avecCartes = await nexusEvenementsAvecCartes(co.evs.filter((e) => e.statut !== "annule").map((e) => e.id));
  const S = await sb.from("saisons").select("id,user_id,annee").in("user_id", ids).eq("annee", co.annee);
  const sid = (S.data || []).map((x) => x.id), qui = Object.fromEntries((S.data || []).map((x) => [x.id, x.user_id]));
  const [I, R] = await Promise.all([sid.length ? sb.from("saison_tournois").select("saison_id,tournoi_id,statut").in("saison_id", sid) : { data: [] },
    sb.from("resultats_perso").select("user_id,tournoi_id,place,classes").in("user_id", ids)]);
  const res = {}; for (const r of R.data || []) res[r.user_id + "|" + r.tournoi_id] = r;
  const parT = {};
  for (const r of I.data || []) { const t = tournoiDe(r.tournoi_id); if (!t) continue; (parT[t.id] ||= { t, j: [] }).j.push({ id: qui[r.saison_id], statut: r.statut }); }
  // une équipe ne montre que les tournois de sa catégorie (« Équipe 1 Messieurs » : Adultes ouverts aux hommes, pas les GP Jeunes)
  const te = eq ? tournoisEquipe(eq.nom) : null;
  const liste = Object.values(parT).filter((x) => !te || te.ok(x.t)).sort((a, b) => a.t.debut.localeCompare(b.t.debut));
  const communs = liste.filter((x) => x.j.length > 1).length, avenir = liste.filter((x) => x.t.fin >= AUJ);
  h += `<div class="st-tuiles petites">${tuileSt(ids.length, "joueurs")}${tuileSt(liste.length, `tournois en ${co.annee}`)}${tuileSt(communs, "tournois à plusieurs", "rendez-vous de l'équipe")}${tuileSt(avenir.length, "à venir")}</div>`;
  const quoi = te && (te.circuit || te.sexe) ? ` ${[te.circuit ? CIRCUITS[te.circuit] : "", te.sexe === "H" ? "messieurs" : te.sexe === "D" ? "dames" : ""].filter(Boolean).join(" ")}` : "";
  if (quoi) h += `<p class="meta">Équipe « ${esc(eq.nom)} » : seulement les tournois${esc(quoi)} de ses joueurs.</p>`;
  const jourL = nxIsoLocal(new Date());
  const tout = [...liste, ...co.evs.map((ev) => ({ ev, t: { debut: ev.debut, fin: ev.fin || ev.debut } }))].sort((a, b) => a.t.debut.localeCompare(b.t.debut));
  if (!tout.length) return h + `<div class="bloc vide">Aucun tournoi${esc(quoi)} ni événement prévu par ces joueurs en ${co.annee}.</div>`;
  let mois = -1; h += `<div class="bloc">`;
  for (const { t, j, ev } of tout) {
    if (ev) {   // événement créé dans GolfNexus
      const m = +ev.debut.slice(5, 7) - 1;
      if (m !== mois) { if (mois >= 0) h += "</ol>"; h += `<h4 class="s-mois">${MOIS[m]}</h4><ol class="co-cal">`; mois = m; }
      const auj = ev.debut <= jourL && jourL <= (ev.fin || ev.debut), annule = ev.statut === "annule";
      const gere = (ev.cree_par === moi || (sidClub && ev.structure_id === sidClub)) && nxEvOuvert(ev, Compte.role === "admin"), fini = (ev.fin || ev.debut) < jourL;
      const I = (ev.club_evenement_joueurs || []).slice().sort((a, b) => nom(a.joueur_id).localeCompare(nom(b.joueur_id)));
      h += `<li class="co-cal-ev${(ev.fin || ev.debut) < jourL ? " passe" : ""}${annule ? " annule" : ""}"><div class="date"><b>${new Date(ev.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[m]}</span></div>
        <div><b class="co-ev-nom">${esc(ev.nom)}</b>${annule ? ` <span class="tag">annulé</span>` : fini ? ` <span class="tag">terminé</span>` : ""}
        <div class="meta"><span class="tag tag-evt">${esc(NX_TYPES_EV[ev.type] || "Événement")}</span> ${ev.categorie ? `<span class="tag">${esc(ev.categorie)}</span> ` : ""}${esc(titre(ev.golf_nom || ""))}${ev.heure ? " · " + esc(ev.heure.slice(0, 5)) : ""}${ev.nb_tours > 1 ? ` · ${ev.nb_tours} tours` : ""}${ev.note ? " · " + esc(ev.note) : ""}</div>
        <div class="co-puces">${I.map((x) => `<span class="co-puce ev-${esc(x.statut || "accepte")}" title="${esc({ invite: "invité, pas encore répondu", accepte: "a accepté", refuse: "a refusé" }[x.statut] || "")}">${esc(nom(x.joueur_id))}${x.statut === "invite" ? " <small>?</small>" : x.statut === "refuse" ? " <small>✕</small>" : ""}</span>`).join("") || `<span class="meta">aucun invité</span>`}</div>
        <div class="co-ev-actions">${auj && !annule ? `<a class="btn plein" href="../carte/#evt=${esc(ev.id)}">📡 En direct</a>` : ""}${gere && !annule ? `<button type="button" class="btn" data-ev-modifier="${esc(ev.id)}">Modifier · inviter</button><button type="button" class="btn" data-ev-parties="${esc(ev.id)}">Parties · marqueurs</button>${co.avecCartes?.has(ev.id) ? `<span class="meta" title="Des cartes ont été saisies : l'événement ne peut plus être supprimé">cartes saisies</span>` : `<button type="button" class="lien vo-suppr" data-ev-annuler="${esc(ev.id)}">Supprimer</button>`}` : ""}</div></div></li>`;
      continue;
    }
    const m = +t.debut.slice(5, 7) - 1;
    if (m !== mois) { if (mois >= 0) h += "</ol>"; h += `<h4 class="s-mois">${MOIS[m]}</h4><ol class="co-cal">`; mois = m; }
    h += `<li class="${t.fin < AUJ ? "passe" : ""} ${j.length > 1 ? "commun" : ""}"><div class="date"><b>${new Date(t.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[m]}</span></div>
      <div><button type="button" class="s-nom" data-co-ouvrir="${esc(t.id)}">${esc(titre(t.nom))}</button>
      <div class="meta">${esc(titre(t.golf_nom))} · ${esc(t.departement || "")} · <span class="tag circuit c-${circuitDe(t)}">${esc(circuitLib(t))}</span></div>
      <div class="co-puces">${j.sort((a, b) => nom(a.id).localeCompare(nom(b.id))).map((x) => { const r = res[x.id + "|" + t.id];
        return `<span class="co-puce s-${x.statut}">${esc(nom(x.id))}${r ? ` <small>${esc(String(r.place).replace(/^(\d+)/, "$1ᵉ"))}${r.classes ? "/" + r.classes : ""}</small>` : ""}</span>`; }).join("")}</div>
      ${t.debut <= jourL && jourL <= (t.fin || t.debut) ? `<div class="co-ev-actions"><a class="btn plein" href="../carte/#tournoi=${encodeURIComponent(t.id)}">📡 En direct</a></div>` : ""}</div></li>`;
  }
  return h + "</ol></div>";
}
$("co-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  // événements du Calendrier d'équipe (11/11, galaxy/MD_DOC/EVENEMENTS.md)
  if (b.hasAttribute("data-ev-nouveau") || b.dataset.evModifier) {
    const ev = b.dataset.evModifier ? (co.evs || []).find((x) => x.id === b.dataset.evModifier) : null;
    const deja = new Set((ev?.club_evenement_joueurs || []).map((x) => x.joueur_id));
    const r = await nexusFormEvenement({ golfs: etat.golfs, ev, joueurs: (co.calJoueurs || []).filter((j) => !deja.has(j.id)), coches: ev ? [] : co.calIds || [], categorie: co.calEquipe || "" });
    if (!r) return;
    if (!ev && Compte.role !== "admin" && !Compte.structure?.id) { signaler("Tu dois être rattaché à un club pour créer un événement."); return; }
    try {
      const { erreurs } = await nexusEnregistrerEvenement({ ev, champs: r.champs, structure_id: Compte.structure?.id || null, joueurs: r.joueurs });
      signaler((ev ? "Événement modifié." : "Événement créé : les joueurs l'acceptent dans leur Saison.") + (erreurs.length ? " Invitations impossibles — " + erreurs.join(" ; ") : ""));
    } catch (err) { signaler("Enregistrement impossible : " + nxErreurEv(err) + (/column|relation|check/.test(err.message || "") ? " (script club-evenements-v2.sql à lancer)" : "")); }
    rendreCoach(); return;
  }
  if (b.dataset.evParties) { const ev = (co.evs || []).find((x) => x.id === b.dataset.evParties); if (ev) ouvrirParties(ev); return; }
  if (b.dataset.evAnnuler) {
    const ev = (co.evs || []).find((x) => x.id === b.dataset.evAnnuler); if (!ev) return;
    if (!confirm(`Supprimer « ${ev.nom} » ? Il disparaît du calendrier de tous les invités.`)) return;
    try { await nexusSupprimerEvenement(ev); signaler("Événement supprimé."); } catch (err) { signaler("Impossible : " + nxErreurEv(err)); }
    rendreCoach(); return;
  }
  if (b.dataset.coOnglet) { co.onglet = b.dataset.coOnglet; rendreCoach(); return; }
  if (b.dataset.referent) {
    const { error } = await sb.rpc("changer_referent", { j: b.dataset.referent });
    signaler(error ? "Impossible : " + error.message : "Tu es maintenant son coach référent."); rendreCoach(); return;
  }
  if (b.dataset.reinviterCo) {
    b.disabled = true; const err = await inviter(b.dataset.reinviterCo, b.dataset.mineur ? "mineur" : "joueur", b.dataset.nom, b.dataset.licence); b.disabled = false;
    signaler(err ? "Renvoi impossible : " + err : `Invitation renvoyée à ${b.dataset.reinviterCo} (nouveau lien valable 24 heures).`); return;
  }
  if (b.dataset.eqSel) { co.eqSel = b.dataset.eqSel; rendreCoach(); return; }
  if ("coPlus" in b.dataset) { co.voir += 100; majTableJoueurs(); return; }
  if (b.id === "co-sel-vider") { co.sel.clear(); majTableJoueurs(); return; }
  if (b.id === "co-sel-ok") {
    const eq = $("co-sel-eq").value, ids = [...co.sel];
    const { error } = await sb.from("equipe_joueurs").upsert(ids.map((j) => ({ equipe_id: eq, joueur_id: j })), { onConflict: "equipe_id,joueur_id", ignoreDuplicates: true });
    signaler(error ? (/row-level security|policy/i.test(error.message) ? "Impossible : seuls les Joueurs AS (licenciés au club) peuvent entrer dans les équipes de l'AS." : "Impossible : " + error.message)
      : `${ids.length} joueur${ids.length > 1 ? "s" : ""} ajouté${ids.length > 1 ? "s" : ""} à l'équipe.`);
    if (!error) co.sel.clear();
    rendreCoach(); return;
  }
  if (b.id === "co-masse-dem") {
    const lics = $("co-masse-lic").value.split(/[\s,;]+/).map((x) => x.replace(/\D/g, "")).filter((x) => /^\d{6,12}$/.test(x));
    if (!lics.length) { signaler("Aucune licence reconnue (6 à 12 chiffres)."); return; }
    b.disabled = true;
    const { data, error } = await sb.rpc("demander_acces_masse", { lics: [...new Set(lics)] });
    b.disabled = false;
    signaler(error ? (/structure_manquante/.test(error.message) ? "Renseigne d'abord ta structure." : "Impossible : " + error.message)
      : `${data} demande${data > 1 ? "s" : ""} envoyée${data > 1 ? "s" : ""}. Les joueurs qui ont un compte GolfNexus les verront dans leur profil.`);
    if (!error) $("co-masse-lic").value = "";
    rendreCoach(); return;
  }
  if (b.id === "co-masse-invit") {
    const lignes = $("co-masse-inv").value.split("\n").map((l) => l.split(/[;\t]/).map((x) => x.trim())).filter((x) => x[0] && x[0].includes("@"));
    if (!lignes.length) { signaler("Aucune ligne avec un e-mail."); return; }
    b.disabled = true; let ok = 0; const ko = [];
    for (const [email, lic, nom, m] of lignes) {
      b.textContent = `Envoi ${ok + ko.length + 1}/${lignes.length}…`;
      const err = !/^\d{6,12}$/.test(String(lic || "").replace(/\s/g, "")) ? "licence manquante ou invalide (2e colonne)"
        : await inviter(email.toLowerCase(), /mineur|oui|^x$|^1$/i.test(m || "") ? "mineur" : "joueur", nom || "", lic);
      if (err) ko.push(`${email} (${err})`); else ok++;
    }
    b.disabled = false; b.textContent = "Envoyer les invitations";
    signaler(`${ok} invitation${ok > 1 ? "s" : ""} envoyée${ok > 1 ? "s" : ""}` + (ko.length ? ` · ${ko.length} en échec : ${ko.slice(0, 3).join(", ")}${ko.length > 3 ? "…" : ""}` : "."));
    if (!ko.length) $("co-masse-inv").value = "";
    rendreCoach(); return;
  }
  if (b.dataset.coOuvrir) { location.href = "../saison/#t=" + encodeURIComponent(b.dataset.coOuvrir); return; }   // fiche du tournoi : dans Saison
  if (b.dataset.eqCal) { co.equipe = b.dataset.eqCal; co.onglet = "calendrier"; rendreCoach(); return; }
  if (b.dataset.calEq !== undefined) { co.equipe = b.dataset.calEq; rendreCoach(); return; }
  if (b.id === "co-eq-types") {
    const E = await sb.from("equipes").select("nom");
    try { await equipesTypes((E.data || []).map((e) => e.nom)); signaler("Équipes types ajoutées."); } catch (err) { signaler("Impossible : " + err.message); }
    rendreCoach(); return;
  }
  let r = null;
  if (b.dataset.eqNom) { const n = prompt("Nouveau nom de l'équipe :", b.dataset.nom || ""); if (!n || !n.trim()) return;
    r = await sb.from("equipes").update({ nom: n.trim().slice(0, 60) }).eq("id", b.dataset.eqNom); }
  else if (b.dataset.eqSuppr) { if (!confirm("Supprimer cette équipe ? (les joueurs restent suivis)")) return; r = await sb.from("equipes").delete().eq("id", b.dataset.eqSuppr); }
  else if (b.dataset.eqRetirer) { const [eq, j] = b.dataset.eqRetirer.split("|"); r = await sb.from("equipe_joueurs").delete().eq("equipe_id", eq).eq("joueur_id", j); }
  else if (b.dataset.eqAjouter) r = await sb.from("equipe_joueurs").insert({ equipe_id: b.dataset.eqAjouter, joueur_id: b.dataset.j });
  else return;
  if (r?.error) signaler("Impossible : " + r.error.message);
  // après un ajout : on garde la recherche pour enchaîner
  const eqId = b.dataset.eqAjouter, texte = eqId ? document.querySelector(`[data-eq-cherche="${CSS.escape(eqId)}"]`)?.value || "" : "";
  await rendreCoach();
  if (eqId) { const inp = document.querySelector(`[data-eq-cherche="${CSS.escape(eqId)}"]`);
    if (inp) { inp.value = texte; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.focus(); } }
});
// recherche dans les joueurs à ajouter (seulement ceux qui correspondent à l'équipe)
$("co-contenu").addEventListener("input", (e) => {
  if (e.target.id === "co-f-q") { co.f.q = e.target.value; co.voir = 50; majTableJoueurs(); return; }
  if (e.target.dataset.filtre) {   // filtre d'une liste affichée (membres, joueurs suivis)
    const q = plier(e.target.value).trim().split(/\s+/).filter(Boolean);
    for (const l of document.querySelectorAll(`#${CSS.escape(e.target.dataset.filtre)} [data-q]`)) l.hidden = !!q.length && !q.every((w) => l.dataset.q.includes(w));
    $(e.target.dataset.filtre)?.classList.toggle("filtre-actif", !!q.length);
    return;
  }
  const id = e.target.dataset.eqCherche; if (!id) return;
  document.querySelector(`[data-eq-props="${CSS.escape(id)}"]`).innerHTML = resultatsAjout(id, e.target.value);
});
$("co-contenu").addEventListener("change", (e) => {
  const t = e.target;
  if (t.classList.contains("co-sel")) { t.checked ? co.sel.add(t.dataset.j) : co.sel.delete(t.dataset.j); majTableJoueurs(); return; }
  if (t.id === "co-tout") { for (const c of document.querySelectorAll(".co-sel")) { c.checked = t.checked; t.checked ? co.sel.add(c.dataset.j) : co.sel.delete(c.dataset.j); } majTableJoueurs(); return; }
  const k = { "co-f-groupe": "groupe", "co-f-sexe": "sexe", "co-f-eq": "eq", "co-f-statut": "statut", "co-f-tri": "tri" }[t.id];
  if (k) { co.f[k] = t.value; co.voir = 50; majTableJoueurs(); return; }
  if (e.target.id === "co-cal-eq") { co.equipe = e.target.value; rendreCoach(); }
  if (e.target.id === "co-eq-liste") { co.eqSel = e.target.value; rendreCoach(); }
  if (e.target.id === "co-cal-an") { co.annee = +e.target.value; rendreCoach(); }
});
$("co-contenu").addEventListener("submit", async (e) => {
  if (e.target.id !== "co-eq-form") return;
  e.preventDefault();
  const { data, error } = await sb.from("equipes").insert({ nom: $("co-eq-nom").value.trim() }).select("id").maybeSingle();
  if (error) signaler("Création impossible : " + error.message); else { co.eqSel = data?.id || ""; signaler("Équipe créée : ajoute-lui des joueurs."); }
  rendreCoach();
});

// ---- Administration : module Admin (../admin/), depuis le 07/11

// ------------------------------------------------------------------ démarrage
// Après connexion : données publiées (tournois pour le calendrier d'équipe), puis le compte.
let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  $("accueil").classList.add("chargement");
  let D;
  try { D = await telechargerDonnees(); }
  catch (e) { demarre = false; $("accueil").classList.remove("chargement"); msgAccueil("Données inaccessibles : " + (e.message || e), true); return; }
  etat.tournois = D.tournois || []; etat.clubs = D.clubs || []; etat.golfs = Object.fromEntries((D.golfs || []).map((g) => [g.slug, g])); etat.parId = new Map(etat.tournois.map((t) => [t.id, t]));
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  if (!estCoach()) {   // membre AS / club (08/11) : lecture seule de ce que le coach principal a ouvert à son groupe
    const A = await sb.rpc("club_mon_acces");
    if (!A.error && A.data?.length) { modeMembre(A.data[0]); return; }
    $("ecran-coach").hidden = false; $("co-contenu").innerHTML = `<div class="bloc vide">Club est réservé aux coachs, à l'administrateur et aux membres de l'AS invités par le club. <a href="../saison/">Retour à Saison</a></div>`; rendreCompte(); return;
  }
  if (Compte.role === "admin") await clubCourant();   // liste des clubs pour le sélecteur du bandeau
  // liens directs (notice aide.html, 10/11) : #club, #vue, ou un sous-onglet Coach : #joueurs #equipes #calendrier #invitations
  const h = location.hash.slice(1);
  if (["joueurs", "equipes", "calendrier", "invitations"].includes(h)) { co.onglet = h; co.vuStructure = true; }
  ecran(h === "club" ? "club" : h === "vue" ? "vue" : "coach");
}
// ------------------------------------------------------------------ membres AS / club : Club en lecture seule (08/11)
// Un onglet par case cochée par le coach principal (club_visibilite) ; données par les fonctions club_vue_* (club-membres.sql),
// qui ne renvoient que les joueurs AS ayant accepté le suivi du club, et rien de ce qui n'est pas coché.
const mb = { acces: null, onglet: "", annee: new Date().getFullYear(), liste: "", ouvert: "", f: {}, cache: {} };
function modeMembre(acces) {
  mb.acces = acces; mb.onglet = CASES.map(([k]) => k).find((k) => acces.cases.includes(k)) || "";
  document.body.classList.add("membre");
  document.querySelector(".vues").innerHTML = `<a class="vers-module" href="../saison/">← Saison</a><button type="button" aria-current="page">Tableau de bord</button>`;
  $("ecran-coach").hidden = false; rendreCompte(); rendreMembre();
}
async function rendreMembre() {
  const a = mb.acces, box = $("co-contenu");
  $("co-titre").textContent = `Tableau de bord · ${a.structure_nom}`;
  const ong = CASES.filter(([k]) => a.cases.includes(k));
  if (!ong.length) { box.innerHTML = `<div class="bloc vide"><p>Le coach principal n'a encore rien ouvert aux ${a.groupe === "as" ? "membres de l'AS" : "membres de la direction du club"}.</p></div>`; return; }
  box.innerHTML = `<div class="seg co-onglets" role="group" aria-label="Club">${ong.map(([k, l]) => `<button type="button" data-mb-onglet="${k}" aria-pressed="${mb.onglet === k}">${l}</button>`).join("")}</div>
    <div id="mb-corps"><p class="meta">Chargement…</p></div><p class="meta mb-lecture">${a.groupe === "coach" ? "Lecture seule · les membres AS voient les onglets cochés dans Mon club." : `Lecture seule · ouvert par le coach principal de ${esc(a.structure_nom)}.`}</p>`;
  try { $("mb-corps").innerHTML = await (VUES_MB[mb.onglet] || (async () => ""))(a.structure_id); }
  catch (e) { $("mb-corps").innerHTML = `<div class="bloc vide">Lecture impossible : ${esc(e.message || String(e))}</div>`; }
}
// lecture (gardée en mémoire : un clic sur une bulle ne relit pas la base)
const lire = async (cle, q) => { if (mb.cache[cle]) return mb.cache[cle]; const r = await q(); if (r.error) throw r.error; return (mb.cache[cle] = r.data || []); };
const nomsDe = async (sid) => Object.fromEntries((await lire("joueurs", () => sb.rpc("club_vue_joueurs", { sid }))).map((j) => [j.joueur_id, j]));
const nomT = (id) => { const t = etat.parId.get(id); return t ? titre(t.nom) : "Tournoi " + id; };
// bulles de filtre (une rangée au-dessus du tableau) : « Tout » puis une bulle par valeur présente, avec son nombre
function bulles(cle, valeurs, libelle = (v) => v, ordre = null) {
  const n = new Map(); for (const v of valeurs) if (v) n.set(v, (n.get(v) || 0) + 1);
  if (n.size < 2) { mb.f[cle] = ""; return ""; }
  const L = [...n.keys()].sort((x, y) => (ordre ? ordre.indexOf(x) - ordre.indexOf(y) : String(libelle(x)).localeCompare(String(libelle(y)))));
  if (mb.f[cle] && !n.has(mb.f[cle])) mb.f[cle] = "";
  return `<div class="mb-bulles" role="group" aria-label="Filtrer">${[["", "Tout", valeurs.length], ...L.map((v) => [v, libelle(v), n.get(v)])].map(([v, l, c]) =>
    `<button type="button" data-mb-f="${cle}" data-v="${esc(v)}" aria-pressed="${(mb.f[cle] || "") === v}">${esc(l)} <small>${c}</small></button>`).join("")}</div>`;
}
const garde = (cle, v) => !mb.f[cle] || mb.f[cle] === v;
const ORDRE_GROUPES = Object.keys(GROUPES), ORDRE_CIRCUITS = Object.keys(CIRCUITS);
const LISTES_MERITE = { jeunes: "Jeunes", amateurs: "Amateurs", midams: "Mid-Amateurs", seniors: "Seniors" };
const VUES_MB = {
  async joueurs(sid) {
    const J = Object.values(await nomsDe(sid)).sort((x, y) => (x.nom || "").localeCompare(y.nom || ""));
    const V = J.filter((j) => garde("joueurs", groupeDe(j))), voitDonnees = mb.acces?.groupe === "coach";   // coach : ouvrir le joueur
    return `<div class="bloc"><div class="co-eq-tete"><h3>Joueurs AS <small>${V.length}${V.length !== J.length ? ` sur ${J.length}` : ""}</small></h3>
      <input type="search" id="mb-q" class="co-cherche" placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur" autocomplete="off"></div>
      ${bulles("joueurs", J.map(groupeDe), (g) => GROUPES[g] || g, ORDRE_GROUPES)}
      ${V.length ? `<div class="st-table"><table><thead><tr><th>Joueur</th><th>Catégorie</th><th>Index</th>${voitDonnees ? "<th></th>" : ""}</tr></thead><tbody>
      ${V.map((j) => `<tr data-nom="${esc(plier(j.nom))}"><td><b>${esc(j.nom || "—")}</b></td><td>${GROUPES[groupeDe(j)] || "—"}</td><td>${j.index_golf != null ? String(j.index_golf).replace(".", ",") : "—"}</td>
        ${voitDonnees ? `<td class="co-td-actions">${(Compte.joueurs || []).some((x) => x.joueur_id === j.joueur_id) ? liensJoueur(j.joueur_id) : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<p class="meta">Aucun joueur AS.</p>`}</div>`;
  },
  async equipes(sid) {
    const [E, N] = await Promise.all([lire("equipes", () => sb.rpc("club_vue_equipes", { sid })), nomsDe(sid)]);
    const eq = new Map(); for (const r of E) { if (!eq.has(r.equipe_id)) eq.set(r.equipe_id, { nom: r.nom, j: [] }); if (r.joueur_id) eq.get(r.equipe_id).j.push(N[r.joueur_id]?.nom || "—"); }
    const L = [...eq.values()].sort((x, y) => x.nom.localeCompare(y.nom));
    return L.length ? `<div class="mb-equipes">${L.map((e) => `<div class="bloc"><h3>${esc(e.nom)} <small>${e.j.length} joueur${e.j.length > 1 ? "s" : ""}</small></h3>
      ${e.j.length ? `<ul class="mb-liste">${e.j.sort().map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="meta">Pas encore de joueur.</p>`}</div>`).join("")}</div>` : `<div class="bloc vide">Aucune équipe pour l'instant.</div>`;
  },
  async calendrier(sid) {
    const [C, N] = await Promise.all([lire("calendrier:" + mb.annee, () => sb.rpc("club_vue_calendrier", { sid, an: mb.annee })), nomsDe(sid)]);
    const parT = new Map(); for (const r of C) { if (!parT.has(r.tournoi_id)) parT.set(r.tournoi_id, []); parT.get(r.tournoi_id).push(r); }
    const T = [...parT.entries()].map(([id, R]) => ({ id, t: etat.parId.get(id), R })).sort((x, y) => (x.t?.debut || "9").localeCompare(y.t?.debut || "9"));
    const L = T.filter((x) => garde("calendrier", x.t ? circuitDe(x.t) : ""));
    const lib = { envisage: "envisagé", inscrit: "inscrit", joue: "joué" };
    return `<div class="bloc"><div class="co-eq-tete"><h3>Calendrier ${mb.annee} <small>${L.length} tournoi${L.length > 1 ? "s" : ""}</small></h3>
      <div class="seg">${[mb.annee - 1, mb.annee, mb.annee + 1].map((a) => `<button type="button" data-mb-annee="${a}" aria-pressed="${a === mb.annee}">${a}</button>`).join("")}</div></div>
      ${bulles("calendrier", T.map((x) => (x.t ? circuitDe(x.t) : "")), (c) => CIRCUITS[c] || c, ORDRE_CIRCUITS)}
      ${L.length ? `<div class="st-table"><table><thead><tr><th>Date</th><th>Tournoi</th><th>Catégorie</th><th>Golf</th><th>Joueurs</th></tr></thead><tbody>
      ${L.map(({ id, t, R }) => `<tr><td>${t?.debut ? fmtDate(t.debut) : "—"}</td><td><b>${esc(nomT(id))}</b></td><td>${t ? esc(circuitLib(t)) : "—"}</td><td>${esc(t ? titre(t.golf_nom || t.golf || "") : "")}</td>
        <td>${R.map((r) => `<span class="tag ${r.statut === "inscrit" ? "" : r.statut === "joue" ? "mb-joue" : "ok-att"}">${esc(N[r.joueur_id]?.nom || "—")} · ${lib[r.statut] || r.statut}</span>`).join(" ")}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="meta">Aucun tournoi prévu par les joueurs AS ${mb.f.calendrier ? "dans cette catégorie" : "cette année"}.</p>`}</div>`;
  },
  async scores(sid) {
    const [S, N] = await Promise.all([lire("scores", () => sb.rpc("club_vue_scores", { sid })), nomsDe(sid)]);
    const T = S.map((r) => ({ ...r, t: etat.parId.get(r.tournoi_id) })).sort((x, y) => (y.t?.debut || "").localeCompare(x.t?.debut || ""));
    const L = T.filter((r) => garde("scores", r.t ? circuitDe(r.t) : "")).slice(0, 300);
    const ecart = (p) => (p == null ? "" : p === 0 ? "par" : (p > 0 ? "+" : "−") + Math.abs(p));
    return `<div class="bloc"><h3>Scores en tournoi <small>${L.length} résultat${L.length > 1 ? "s" : ""}, du plus récent</small></h3>
      ${bulles("scores", T.map((r) => (r.t ? circuitDe(r.t) : "")), (c) => CIRCUITS[c] || c, ORDRE_CIRCUITS)}
      ${L.length ? `<div class="st-table"><table><thead><tr><th>Date</th><th>Tournoi</th><th>Catégorie</th><th>Joueur</th><th>Tours</th><th>Total</th><th>Place</th></tr></thead><tbody>
      ${L.map((r) => `<tr><td>${r.t?.debut ? fmtDate(r.t.debut) : "—"}</td><td>${esc(nomT(r.tournoi_id))}</td><td>${r.t ? esc(circuitLib(r.t)) : "—"}</td><td><b>${esc(N[r.joueur_id]?.nom || "—")}</b></td><td>${(r.tours || []).join(" · ") || "—"}</td>
        <td>${r.total != null ? `<b>${r.total}</b> <small>${ecart(r.par)}</small>` : "—"}</td><td>${esc(r.place || "—")}${r.classes ? ` <small>/ ${r.classes}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Aucun résultat relevé.</p>`}</div>`;
  },
  async merite(sid) {
    const [M, N] = await Promise.all([lire("merite", () => sb.rpc("club_vue_merite", { sid })), nomsDe(sid)]);
    const nb = (l) => new Set(M.filter((m) => m.liste === l).map((m) => m.joueur_id)).size;
    if (!mb.liste || !LISTES_MERITE[mb.liste]) mb.liste = Object.keys(LISTES_MERITE).find((l) => nb(l)) || "jeunes";
    const parJ = new Map(); for (const m of M.filter((x) => x.liste === mb.liste)) { if (!parJ.has(m.joueur_id)) parJ.set(m.joueur_id, []); parJ.get(m.joueur_id).push(m); }
    const T = [...parJ.entries()].map(([j, H]) => { H.sort((a, b) => b.mois.localeCompare(a.mois)); return { j, H, d: H[0] }; }).sort((a, b) => (a.d.place || 1e9) - (b.d.place || 1e9));
    const L = T.filter((x) => garde("merite:" + mb.liste, x.d.categorie || ""));
    const moisLib = (m) => `${MOIS_COURT[+m.slice(4) - 1]} ${m.slice(2, 4)}`;
    return `<div class="seg co-onglets mb-listes" role="group" aria-label="Mérite">${Object.entries(LISTES_MERITE).map(([l, lib]) => `<button type="button" data-mb-liste="${l}" aria-pressed="${l === mb.liste}">Mérite ${lib} <small>${nb(l)}</small></button>`).join("")}</div>
      <div class="bloc"><h3>Mérite ${LISTES_MERITE[mb.liste]}${T[0] ? ` · ${moisLib(T[0].d.mois)}` : ""} <small>${L.length} joueur${L.length > 1 ? "s" : ""}</small></h3>
      ${bulles("merite:" + mb.liste, T.map((x) => x.d.categorie || ""))}
      ${L.length ? `<div class="st-table"><table><thead><tr><th>Joueur</th><th>Catégorie</th><th class="n">Rang</th><th class="n">Évolution</th><th class="n">Index</th></tr></thead><tbody>
      ${L.map(({ j, H, d }) => { const ev = d.place && d.place_prec ? d.place_prec - d.place : null;
        return `<tr class="mb-ligne" data-mb-ouvrir="${esc(j)}"><td><b>${esc(N[j]?.nom || "—")}</b> <small class="meta">▸ historique</small></td><td>${esc(d.categorie || "—")}</td><td class="n"><b>${d.place ?? "—"}</b></td>
          <td class="n ${ev > 0 ? "mb-monte" : ev < 0 ? "mb-baisse" : ""}">${ev == null ? "—" : ev > 0 ? `▲ ${ev}` : ev < 0 ? `▼ ${-ev}` : "="}</td><td class="n">${d.index_golf != null ? String(d.index_golf).replace(".", ",") : "—"}</td></tr>
          ${mb.ouvert === j ? `<tr class="mb-histo"><td colspan="5">${H.slice(0, 13).reverse().map((h) => `<span><small>${moisLib(h.mois)}</small><b>${h.place ?? "—"}</b></span>`).join("")}</td></tr>` : ""}`; }).join("")}
      </tbody></table></div><p class="meta">Rang national dans le Mérite ${LISTES_MERITE[mb.liste]} ; évolution par rapport au mois précédent. Clique un joueur pour son historique.</p>` : `<p class="meta">Aucun joueur AS classé dans ce Mérite.</p>`}</div>`;
  },
  async evenements(sid) {
    const E = (await lire("evenements", () => sb.from("club_evenements").select("id,type,nom,golf_nom,debut,fin,nb_tours,categorie,statut").eq("structure_id", sid).order("debut", { ascending: false }))).filter((e) => e.statut !== "annule");
    const lib = NX_TYPES_EV;
    const L = E.filter((e) => garde("evenements", e.categorie || ""));
    return `<div class="bloc"><h3>Événements du club <small>${L.length}</small></h3>
      ${bulles("evenements", E.map((e) => e.categorie || ""))}
      ${L.length ? `<div class="st-table"><table><thead><tr><th>Date</th><th>Événement</th><th>Catégorie</th><th>Type</th><th>Golf</th></tr></thead><tbody>
      ${L.map((e) => `<tr><td>${fmtDate(e.debut)}${e.fin && e.fin !== e.debut ? ` → ${fmtDate(e.fin)}` : ""}</td><td><b>${esc(e.nom)}</b></td><td>${esc(e.categorie || "—")}</td><td>${lib[e.type] || e.type}</td><td>${esc(titre(e.golf_nom || ""))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Aucun événement.</p>`}</div>`;
  },
};
document.addEventListener("input", (e) => {
  if (e.target.id !== "mb-q") return;
  const q = plier(e.target.value);
  for (const tr of document.querySelectorAll("#mb-corps tr[data-nom]")) tr.hidden = !!q && !tr.dataset.nom.includes(q);
});
document.addEventListener("click", (e) => {
  if (!mb.acces) return;
  const o = e.target.closest("[data-mb-onglet]"); if (o) { mb.onglet = o.dataset.mbOnglet; rendreMembre(); return; }
  const a = e.target.closest("[data-mb-annee]"); if (a) { mb.annee = +a.dataset.mbAnnee; rendreMembre(); return; }
  const l = e.target.closest("[data-mb-liste]"); if (l) { mb.liste = l.dataset.mbListe; mb.ouvert = ""; rendreMembre(); return; }
  const f = e.target.closest("[data-mb-f]"); if (f) { mb.f[f.dataset.mbF] = f.dataset.v; rendreMembre(); return; }
  const r = e.target.closest("[data-mb-ouvrir]"); if (r) { mb.ouvert = mb.ouvert === r.dataset.mbOuvrir ? "" : r.dataset.mbOuvrir; rendreMembre(); }
});
nexusBrancherAccueil();
if (sb) nexusDemarrer(entrer);
