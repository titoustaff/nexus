"use strict";
// Club — module n° 2 de la suite GolfNexus : espace coach (joueurs, équipes de l'AS, calendrier d'équipe,
// invitations, mon club) et administration. Code repris tel quel de Saison (app.js), où il était depuis GolfNexus.
// S'appuie sur les briques communes (../commun/v1/nexus.js : sb, esc, signaler, accueil, profil, panneau du compte).
// Ce qui affiche une saison ou un tournoi renvoie vers Saison (../saison/#vue=<joueur>, ../saison/#t=<tournoi>).

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const AUJ = new Date().toISOString().slice(0, 10);
const etat = { tournois: [], parId: new Map(), clubs: [], ecran: "coach" };
const $ = (id) => document.getElementById(id);
function fmtDate(d) { const x = new Date(d + "T12:00:00"); return `${x.getDate()} ${MOIS_COURT[x.getMonth()]}`; }
// Noms FFGolf en MAJUSCULES → casse normale (« GOLF DE ST DONAT » → « Golf de St Donat »).
const PETITS = new Set(["de", "du", "des", "la", "le", "les", "et", "sur", "en", "au", "aux", "à", "d", "l", "sous"]);
const SIGLES = new Set(["gc", "cc", "ugolf", "ucpa", "ffgolf", "pga", "paca"]);
function titre(s) {
  if (!s) return "";
  if (s !== s.toUpperCase()) return s;                      // déjà en casse mixte
  return s.toLowerCase().split(/(\s+|-|'|’|\/|\()/).map((w, i) => {
    if (!w || /^(\s+|-|'|’|\/|\()$/.test(w)) return w;
    if (SIGLES.has(w)) return w === "ugolf" ? "UGolf" : w.toUpperCase();
    if (i > 0 && PETITS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join("");
}
// circuits ffgolf collectés (pipeline/ffgolf.py CIRCUITS) ; les données d'avant le 04/11 n'ont que des Grands Prix
// libellés choisis par l'utilisateur (04/11) : Jeunes, Adultes, Mid-Amateurs, Seniors
const CIRCUITS = { jeunes: "Jeunes", gp: "Adultes", mid: "Mid-Amateurs", seniors: "Seniors" };
// précision affichée : catégorie d'âge pour les jeunes (U14…), type d'épreuve pour les seniors (Trophée Vétéran…)
const circuitLib = (t) => { const c = circuitDe(t);
  return CIRCUITS[c] + (c === "jeunes" && t.categorie ? " · " + t.categorie : c === "seniors" && t.type ? " · " + t.type : ""); };
const circuitDe = (t) => t.circuit || "gp";
const plier = (x) => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const tuileSt = (val, lib, sous = "") => `<div class="st-tuile"><b>${val}</b><span>${lib}</span>${sous ? `<small>${sous}</small>` : ""}</div>`;
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
  $("v-admin").hidden = Compte.role !== "admin";
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
  if (compte.ouvert && !e.target.closest("#b-pan")) { compte.ouvert = false; rendreCompte(); }   // clic ailleurs : on referme
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && compte.ouvert) { compte.ouvert = false; rendreCompte(); } });

// ---- navigation entre écrans (#coach, #admin)
function ecran(nom) {
  if (nom === "admin" && Compte.role !== "admin") nom = "coach";
  etat.ecran = nom;
  $("ecran-coach").hidden = nom !== "coach";
  $("ecran-admin").hidden = nom !== "admin";
  for (const b of document.querySelectorAll(".vues button[data-ecran]"))
    if (b.dataset.ecran === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  history.replaceState(null, "", location.pathname + location.search + "#" + nom);
  rendreCompte();
  if (nom === "admin") rendreAdmin(); else rendreCoach();
  window.scrollTo({ top: 0 });
}
document.querySelector(".vues").addEventListener("click", (e) => { const b = e.target.closest("[data-ecran]"); if (b) ecran(b.dataset.ecran); });

// ---- accès aux joueurs, côté coach (repris de Saison : clicAcces / envoiAcces, partie coach)
// « Voir » un joueur : sa saison et ses stats s'affichent dans Saison, en lecture seule.
$("co-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.voir) { location.href = `../saison/#vue=${encodeURIComponent(b.dataset.voir)}&cible=${encodeURIComponent(b.dataset.cible || "saison")}`; return; }
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

// ---- onglet Coach (coachs et administrateur) : structure, joueurs suivis, invitations ; plus tard les équipes
const co = { onglet: "joueurs", equipe: "", eqSel: "", annee: new Date().getFullYear(), candidats: {}, voir: 50 };
async function rendreCoach() {
  const box = $("co-contenu"); if (!box) return;
  if (Compte.role !== "coach" && Compte.role !== "admin") { box.innerHTML = "<div class='bloc vide'>Réservé aux coachs.</div>"; return; }
  // « Ma structure » obligatoire pour un coach (06/11) : tant qu'elle manque, on y ouvre et les autres onglets y renvoient
  const stOk = !!Compte.structure?.id;
  if (!stOk && !co.vuStructure) { co.onglet = "structure"; co.vuStructure = true; }
  box.innerHTML = `<div class="seg co-onglets" role="group" aria-label="Espace coach">${[["joueurs", "Joueurs"], ["equipes", "Équipes de l'AS"], ["calendrier", "Calendrier d'équipe"], ["invitations", "Invitations"], ["structure", "Mon club"]]
    .map(([k, v]) => `<button type="button" data-co-onglet="${k}" aria-pressed="${co.onglet === k}">${v}${k === "structure" && !stOk ? ' <span class="nb" title="pas encore rattaché">!</span>' : ""}</button>`).join("")}</div><div id="co-corps"><p class="meta">Chargement…</p></div>`;
  const corps = $("co-corps");
  try {
    if (co.onglet === "structure") corps.innerHTML = htmlStructure();
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
function htmlStructure() {
  const st = Compte.structure;
  if (!st) return `<div class="bloc p-parent"><h3>Mon club</h3><p>Tu n'es rattaché à aucun club pour l'instant. C'est l'administrateur qui rattache un coach à son club (ou le déclare coach indépendant) : demande-lui de le faire.</p></div>`;
  const club = st.club ? titre(st.club) : null;
  return `<div class="bloc"><h3>${esc(st.nom)} <small>${st.type === "independant" ? "coach indépendant" : `club ffgolf : ${esc(club)}`}</small></h3>
    ${st.type === "independant" ? `<p>Tu suis tes joueurs à titre personnel ; pas d'équipes.</p>` : `
    <div class="co-club">
      <div><h4>Académie</h4><p>${st.principal ? `Coach principal : <b>${esc(st.principal)}</b><br>` : ""}Coachs : ${esc(st.coachs || "—")}</p>
        <p class="meta">Les coachs de l'académie voient tous les <b>Joueurs AS</b> (licenciés à ${esc(club)}) et composent les équipes. Les <b>joueurs hors club</b> que tu suis ne sont visibles que par toi.</p></div>
      <div><h4>AS</h4><p>Les équipes de l'AS (onglet « Équipes de l'AS ») n'accueillent que les licenciés à ${esc(club)}.</p></div>
    </div>`}
    <p class="meta">Rattachement, club et coach principal sont gérés par l'administrateur.</p></div>`;
}
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
      <td class="co-td-actions"><span class="co-actions">${ok ? `<button type="button" class="btn" data-voir="${esc(j.joueur_id)}">Saison</button><button type="button" class="btn" data-voir="${esc(j.joueur_id)}" data-cible="stats">Stats</button>` : ""}
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
            <span class="co-actions"><button type="button" class="btn" data-voir="${esc(id)}">Saison</button><button type="button" class="btn" data-voir="${esc(id)}" data-cible="stats">Stats</button>
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
    <span class="st-legende"><span><i class="lg s-envisage"></i>envisagé</span><span><i class="lg s-inscrit"></i>inscrit</span><span><i class="lg s-joue"></i>joué</span></span></div>`;
  if (!ids.length) return h + `<div class="bloc vide">Pas de joueur dans ${eq ? "cette équipe" : "ta liste"}.</div>`;
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
  if (!liste.length) return h + `<div class="bloc vide">Aucun tournoi${esc(quoi)} prévu par ces joueurs en ${co.annee}.</div>`;
  let mois = -1; h += `<div class="bloc">`;
  for (const { t, j } of liste) {
    const m = +t.debut.slice(5, 7) - 1;
    if (m !== mois) { if (mois >= 0) h += "</ol>"; h += `<h4 class="s-mois">${MOIS[m]}</h4><ol class="co-cal">`; mois = m; }
    h += `<li class="${t.fin < AUJ ? "passe" : ""} ${j.length > 1 ? "commun" : ""}"><div class="date"><b>${new Date(t.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[m]}</span></div>
      <div><button type="button" class="s-nom" data-co-ouvrir="${esc(t.id)}">${esc(titre(t.nom))}</button>
      <div class="meta">${esc(titre(t.golf_nom))} · ${esc(t.departement || "")} · <span class="tag circuit c-${circuitDe(t)}">${esc(circuitLib(t))}</span></div>
      <div class="co-puces">${j.sort((a, b) => nom(a.id).localeCompare(nom(b.id))).map((x) => { const r = res[x.id + "|" + t.id];
        return `<span class="co-puce s-${x.statut}">${esc(nom(x.id))}${r ? ` <small>${esc(String(r.place).replace(/^(\d+)/, "$1ᵉ"))}${r.classes ? "/" + r.classes : ""}</small>` : ""}</span>`; }).join("")}</div></div></li>`;
  }
  return h + "</ol></div>";
}
$("co-contenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
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

// ---- Administration : invitations et comptes
async function rendreAdmin() {
  if (Compte.role !== "admin") { $("ad-membres").innerHTML = "<p class='meta'>Réservé à l'administrateur.</p>"; return; }
  const [M, I] = await Promise.all([sb.rpc("admin_membres"), sb.rpc("admin_invitations")]);
  const roles = { admin: "Administrateur", coach: "Coach", joueur: "Joueur" };
  $("ad-invits").innerHTML = (I.data || []).length ? (I.data || []).map((i) => `<div class="acces-ligne"><div class="qui"><b>${esc(i.email)}</b><small>${esc(i.nom || "")} · ${roles[i.role]}${i.mineur ? " (moins de 18 ans)" : ""}${i.licence ? " · licence " + esc(i.licence) : ""} · invité le ${fmtDate(String(i.cree_le).slice(0, 10))}</small></div>
    <button type="button" class="btn" data-reinviter="${esc(i.email)}" data-role="${i.mineur ? "mineur" : i.role}" data-nom="${esc(i.nom || "")}" data-licence="${esc(i.licence || "")}">Renvoyer</button></div>`).join("") : "<p class='meta'>Aucune invitation en attente.</p>";
  if (M.error) { $("ad-membres").innerHTML = `<p class="meta">${esc(M.error.message)}</p>`; return; }
  // clubs (06/11) : créer / modifier une structure, choisir son coach principal ; rattacher les coachs (colonne « Club »)
  const S = await sb.from("structures").select("id,type,nom,club,coach_principal").order("nom"), structs = S.data || [];
  const coachsDe = (sid) => (M.data || []).filter((m) => m.structure_id === sid);
  const ed = ad.edition ? structs.find((x) => x.id === ad.edition) : null;
  $("ad-structures").innerHTML = `${structs.length ? `<div class="st-table"><table><thead><tr><th>Nom</th><th>Club ffgolf</th><th>Coach principal</th><th>Coachs (académie)</th><th></th></tr></thead><tbody>
    ${structs.map((x) => `<tr><td><b>${esc(x.nom)}</b>${x.type === "independant" ? ' <span class="tag">indépendant</span>' : ""}</td><td>${x.club ? esc(titre(x.club)) : "—"}</td>
      <td>${esc((coachsDe(x.id).find((m) => m.id === x.coach_principal) || {}).nom || "—")}</td><td>${coachsDe(x.id).map((m) => esc(m.nom || m.email)).join(", ") || "—"}</td>
      <td><button type="button" class="lien" data-ad-edit="${esc(x.id)}">Modifier</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Aucun club pour l'instant.</p>`}
    <form id="ad-st-form" class="c-form ad-st-form" autocomplete="off"><b>${ed ? "Modifier « " + esc(ed.nom) + " »" : "Nouveau club"}</b>
      <select id="ad-st-type" aria-label="Type"><option value="club" ${ed?.type !== "independant" ? "selected" : ""}>Club (académie + AS)</option><option value="independant" ${ed?.type === "independant" ? "selected" : ""}>Coach indépendant</option></select>
      <input id="ad-st-nom" required maxlength="80" placeholder="Nom affiché (ex. Pic Saint-Loup)" value="${esc(ed?.nom || "")}" aria-label="Nom">
      <input id="ad-st-club" list="ad-clubs-liste" placeholder="Club ffgolf (liste du Mérite)" value="${esc(ed?.club || "")}" aria-label="Club ffgolf">
      <datalist id="ad-clubs-liste">${(etat.clubs || []).map((c) => `<option value="${esc(c.nom)}">`).join("")}</datalist>
      ${ed ? `<select id="ad-st-principal" aria-label="Coach principal"><option value="">Coach principal…</option>${coachsDe(ed.id).map((m) => `<option value="${esc(m.id)}" ${m.id === ed.coach_principal ? "selected" : ""}>${esc(m.nom || m.email)}</option>`).join("")}</select>` : ""}
      <button type="submit" class="btn plein">${ed ? "Enregistrer" : "Créer le club"}</button>${ed ? ' <button type="button" class="lien" data-ad-edit="">Annuler</button>' : ""}</form>
    <p class="meta">Le club ffgolf s'écrit comme dans le Mérite (ex. « PIC SAINT-LOUP ») : c'est lui qui reconnaît les Joueurs AS (club de licence).</p>`;
  ad.structs = structs;
  $("ad-membres").innerHTML = `<table><thead><tr><th>Compte</th><th>Nom</th><th>Rôle</th><th>Moins de 18 ans</th><th>Licence</th><th>Club (coach)</th><th>Parent validé</th><th>Dernière connexion</th></tr></thead><tbody>
    ${(M.data || []).map((m) => `<tr><td>${esc(m.email)}</td><td>${esc(m.nom || "")}</td>
      <td><select class="ad-role" data-membre="${esc(m.id)}">${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${k === m.role ? "selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><input type="checkbox" class="ad-mineur" data-membre="${esc(m.id)}" ${m.mineur ? "checked" : ""}></td>
      <td>${esc(m.licence || "—")} <button type="button" class="lien" data-corriger-lic="${esc(m.id)}" data-lic="${esc(m.licence || "")}" data-email="${esc(m.email)}">corriger</button></td><td>${m.role !== "joueur" ? `<select data-rattacher="${esc(m.id)}" aria-label="Club du coach"><option value="">—</option>${structs.map((x) => `<option value="${esc(x.id)}" ${x.id === m.structure_id ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</select>` : (m.club_licence ? `<span class="meta">licence : ${esc(titre(m.club_licence))}</span>` : "")}</td><td>${m.mineur ? (m.parent_valide_le ? "✓ " + fmtDate(String(m.parent_valide_le).slice(0, 10)) : "en attente") : "—"}</td>
      <td>${m.derniere_connexion ? fmtDate(String(m.derniere_connexion).slice(0, 10)) : "jamais"}</td></tr>`).join("")}</tbody></table>`;
}
// licence : obligatoire pour un joueur (06/11), fixée à l'invitation, non modifiable par le joueur
async function inviter(email, role, nom, licence = "") {
  const { data, error } = await sb.functions.invoke("inviter", { body: { email, role: role === "mineur" ? "joueur" : role, mineur: role === "mineur", nom, licence: String(licence || "").replace(/\s/g, ""),
    site: location.origin + location.pathname } });
  const msg = error ? (await error.context?.json?.().catch(() => null))?.erreur || error.message : data?.erreur;
  return msg || null;
}
$("ad-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const m = $("ad-msg"), btn = $("ad-ok"); btn.disabled = true; m.textContent = "Envoi…"; m.classList.remove("erreur");
  const err = await inviter($("ad-email").value.trim().toLowerCase(), $("ad-role").value, $("ad-nom").value.trim(), $("ad-lic").value);
  btn.disabled = false;
  if (err) { m.textContent = "Invitation impossible : " + err; m.classList.add("erreur"); return; }
  m.textContent = `Invitation envoyée à ${$("ad-email").value.trim()}.`; $("ad-form").reset(); rendreAdmin();
});
const ad = { edition: null, structs: [] };
$("ecran-admin").addEventListener("submit", async (e) => {
  if (e.target.id !== "ad-st-form") return;
  e.preventDefault();
  const { error } = await sb.rpc("admin_structure", { sid: ad.edition || null, t: $("ad-st-type").value, n: $("ad-st-nom").value.trim(),
    c: $("ad-st-club").value.trim(), principal: $("ad-st-principal")?.value || null });
  signaler(error ? (/structures_club|duplicate/i.test(error.message) ? "Ce club ffgolf a déjà sa structure." : "Enregistrement impossible : " + error.message) : "Club enregistré.");
  if (!error) ad.edition = null; rendreAdmin();
});
$("ecran-admin").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-ad-edit]"); if (ed) { ad.edition = ed.dataset.adEdit || null; rendreAdmin(); return; }
  const c = e.target.closest("[data-corriger-lic]");
  if (c) {   // licence fixée : seul l'administrateur la corrige
    const n = prompt(`Nouvelle licence pour ${c.dataset.email} (vide = aucune) :`, c.dataset.lic || ""); if (n == null) return;
    if (n.trim() && !/^\d{6,12}$/.test(n.replace(/\s/g, ""))) { signaler("Licence : 6 à 12 chiffres."); return; }
    const { error } = await sb.rpc("admin_licence", { uid: c.dataset.corrigerLic, lic: n });
    signaler(error ? (error.code === "23505" ? "Cette licence est déjà celle d'un autre compte." : "Correction impossible : " + error.message) : "Licence corrigée (ses places seront relevées à nouveau).");
    rendreAdmin(); return;
  }
  const b = e.target.closest("[data-reinviter]"); if (!b) return;
  const err = await inviter(b.dataset.reinviter, b.dataset.role, b.dataset.nom, b.dataset.licence);
  signaler(err ? "Renvoi impossible : " + err : "Invitation renvoyée.");
});
$("ecran-admin").addEventListener("change", async (e) => {
  if (e.target.dataset.rattacher !== undefined) {
    const { error } = await sb.rpc("admin_rattacher", { uid: e.target.dataset.rattacher, sid: e.target.value || null });
    signaler(error ? "Rattachement impossible : " + error.message : e.target.value ? "Coach rattaché au club." : "Coach détaché de son club (ses Joueurs AS restent au club).");
    rendreAdmin(); return;
  }
  const id = e.target.dataset.membre; if (!id) return;
  const ligne = e.target.closest("tr"), role = ligne.querySelector(".ad-role").value, mineur = ligne.querySelector(".ad-mineur").checked;
  const { error } = await sb.rpc("admin_role", { uid: id, r: role, m: mineur });
  signaler(error ? "Modification impossible : " + error.message : "Compte mis à jour.");
  rendreAdmin();
});

// ------------------------------------------------------------------ démarrage
// Après connexion : données publiées (tournois pour le calendrier d'équipe, clubs ffgolf pour l'admin), puis le compte.
let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  $("accueil").classList.add("chargement");
  let D;
  try { D = await telechargerDonnees(); }
  catch (e) { demarre = false; $("accueil").classList.remove("chargement"); msgAccueil("Données inaccessibles : " + (e.message || e), true); return; }
  etat.tournois = D.tournois || []; etat.clubs = D.clubs || []; etat.parId = new Map(etat.tournois.map((t) => [t.id, t]));
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  if (!estCoach()) { $("ecran-coach").hidden = false; $("co-contenu").innerHTML = `<div class="bloc vide">Club est réservé aux coachs et à l'administrateur. <a href="../saison/">Retour à Saison</a></div>`; rendreCompte(); return; }
  ecran(location.hash.slice(1) === "admin" ? "admin" : "coach");
}
nexusBrancherAccueil();
if (sb) nexusDemarrer(entrer);
