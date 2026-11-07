"use strict";
// Admin — module de la suite GolfNexus réservé à l'administrateur : inviter, invitations en attente, clubs
// (structures), comptes. Code repris tel quel de Saison (via Club), où il était depuis GolfNexus.
// S'appuie sur les briques communes (../commun/v1/nexus.js : sb, esc, signaler, accueil, profil, panneau, inviter).

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const AUJ = new Date().toISOString().slice(0, 10);
const etat = { clubs: [], ecran: "admin" };
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
// ------------------------------------------------------------------ compte (coach ou administrateur)
// Profil (brique commune) ; joueurs suivis inutiles ici.
const Compte = {
  moi: null, user: null, role: "joueur", structure: null, fiche: {}, joueurs: [],
  async connecter(user) {
    const P = await nexusLireProfil(user);
    Object.assign(this, { moi: user, user, role: P.role, mineur: P.mineur, parentValide: P.parentValide, structure: P.structure, fiche: P.fiche });
  },
  // fiche joueur partagée avec Saison (colonne profils.fiche) ; ici seulement « equipesTypes »
  setFiche(champs) {
    this.fiche = { ...this.fiche, ...champs };
    for (const [k, v] of Object.entries(this.fiche)) if (v === null || v === "" || v === undefined) delete this.fiche[k];
    sb.from("profils").update({ fiche: this.fiche, modifie_le: new Date().toISOString() }).eq("id", this.moi.id)
      .then(({ error }) => { if (error) signaler("Enregistrement impossible (profil) : " + error.message); });
  },
};

// ---- bandeau : compte en haut à droite
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
  if (compte.ouvert && !e.target.closest("#b-pan")) { compte.ouvert = false; rendreCompte(); }   // clic ailleurs : on referme
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && compte.ouvert) { compte.ouvert = false; rendreCompte(); } });

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
// inviter() : briques communes (../commun/v1/nexus.js)
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
// Après connexion : liste des clubs ffgolf (données publiées, pour la saisie d'un club), puis le compte.
let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  $("accueil").classList.add("chargement");
  let D;
  try { D = await telechargerDonnees(); }
  catch (e) { demarre = false; $("accueil").classList.remove("chargement"); msgAccueil("Données inaccessibles : " + (e.message || e), true); return; }
  etat.clubs = D.clubs || [];
  const { data } = await sb.auth.getSession();
  try { await Compte.connecter(data.session.user); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  document.body.classList.remove("verrou");
  rendreCompte();
  if (Compte.role !== "admin") { $("ecran-admin").innerHTML = `<div class="bloc vide">Admin est réservé à l'administrateur. <a href="../saison/">Retour à Saison</a></div>`; return; }
  rendreAdmin();
}
nexusBrancherAccueil();
if (sb) nexusDemarrer(entrer);
