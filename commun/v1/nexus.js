// Briques communes de la suite GolfNexus — v1 (https://titoustaff.github.io/nexus/commun/v1/nexus.js)
// Script classique (pas un module) : ses constantes sont visibles des scripts chargés après lui.
// Ordre dans la page d'un module : supabase-js (CDN) → ../commun/v1/nexus.js → script du module.
// Source : repris tel quel du GolfNexus gelé (site/app.js, commit 81f8116).
"use strict";

// ------------------------------------------------------------------ configuration et client Supabase
// Une seule base pour toute la suite. storageKey « gn-auth » : la session est partagée avec l'ancien site
// (même origine titoustaff.github.io) et entre tous les modules.
const SB_URL = "https://wnawfquocmmuymwptctn.supabase.co";
const SB_CLE = "sb_publishable_74pMkWHpBVFYMgVl5lt0LA_gs2YFGKa";   // clé publique : la base filtre par compte (RLS)
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_CLE,
  { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, storageKey: "gn-auth" } }) : null;

// ------------------------------------------------------------------ outils (repris de Saison)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// mémoire du navigateur ; les clés « gn-* » sont partagées par tous les modules et l'ancien site (même origine)
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } };
const jsonLs = (k) => { try { return JSON.parse(lsGet(k) || "null"); } catch { return null; } };
// joueur regardé par un coach (« Vue » de Saison, Carte, Stats) : il suit d'un module à l'autre ; propre au compte connecté (08/11)
const nexusJoueurVu = {
  lire(moi) { const v = jsonLs("nx-joueur-vu"); return v && moi && v.u === moi ? v.j || "" : ""; },
  nom(moi) { const v = jsonLs("nx-joueur-vu"); return v && moi && v.u === moi && v.j ? v.nom || "Joueur" : ""; },   // pour afficher la bande tout de suite
  ecrire(moi, j, nom = "") { if (moi) lsSet("nx-joueur-vu", JSON.stringify({ u: moi, j: j || "", nom: j ? nom || "" : "" })); },
};
// bande jaune « tu regardes <joueur> · lecture seule » sous l'en-tête, avec les raccourcis vers les modules qui suivent ce
// joueur (modules.json : vueJoueur, ouverts) et « Mon compte ». nom vide : la bande disparaît. ici : id du module courant.
const NX_MODULES_URL = new URL("modules.json", document.currentScript?.src || location.href).href;
let nxModulesJoueur = null, nxBandeTour = 0;
// joueurs + choisir(id) : le nom devient un sélecteur avec recherche (passer d'un joueur à l'autre sans changer de module)
async function nexusBandeVue(nom, ici, revenir, joueurs = [], choisir = null) {
  const tour = ++nxBandeTour;   // plusieurs appels rapprochés : seul le dernier dessine, toujours dans UNE seule bande
  if (!nom) { document.getElementById("nx-vue")?.remove(); return; }
  nxModulesJoueur ||= fetch(NX_MODULES_URL).then((r) => r.json()).then((d) => (d.modules || []).filter((m) => m.vueJoueur && m.etat === "ouvert" && m.adresse))
    .catch(() => [{ id: "saison", nom: "Saison", adresse: "saison/" }, { id: "carte", nom: "Carte", adresse: "carte/" }, { id: "stats", nom: "Stats", adresse: "stats/" }]);
  const M = await nxModulesJoueur;
  if (tour !== nxBandeTour) return;
  let b = document.getElementById("nx-vue");
  if (!b) { b = document.createElement("div"); b.id = "nx-vue"; b.className = "nx-vue"; (document.querySelector("header.bandeau") || document.body.firstElementChild).after(b); }
  const liste = choisir ? (joueurs || []).filter((j) => j.id && j.nom).sort((x, y) => x.nom.localeCompare(y.nom, "fr")) : [];
  b.innerHTML = `<span class="nx-vue-qui">👁 ${liste.length > 1 ? `<button type="button" class="nx-vue-choix" aria-haspopup="listbox" aria-expanded="false" title="Changer de joueur"><b>${esc(nom)}</b> ▾</button>
      <div class="nx-vue-pop" hidden><input type="search" placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur" autocomplete="off"><ul role="listbox"></ul></div>` : `<b>${esc(nom)}</b>`} <small>lecture seule</small></span>
    <nav aria-label="Modules du joueur">${M.map((m) => m.id === ici ? `<span aria-current="page">${esc(m.nom)}</span>` : `<a href="${esc(new URL("../../" + m.adresse, NX_MODULES_URL).href)}">${esc(m.nom)}</a>`).join("")}</nav>
    <button type="button" id="nx-vue-retour">← Mon compte</button>`;
  b.querySelector("#nx-vue-retour").onclick = revenir;
  if (liste.length > 1) nxBrancherChoix(b, liste, choisir);
}
// sélecteur avec recherche (joueur de la bande ; club de l'administrateur dans Club) : nom et précision, sans accents ;
// flèches, Entrée, Échap. Balisage attendu dans b : .nx-vue-choix (bouton), .nx-vue-pop (input + ul).
function nxBrancherChoix(b, liste, choisir) {
  const btn = b.querySelector(".nx-vue-choix"), pop = b.querySelector(".nx-vue-pop"), q = pop.querySelector("input"), ul = pop.querySelector("ul");
  let actif = 0, vus = liste;
  const dessiner = () => {
    const t = plier(q.value); vus = liste.filter((j) => !t || plier(j.nom + " " + (j.info || "")).includes(t)); actif = Math.min(actif, Math.max(0, vus.length - 1));
    ul.innerHTML = vus.length ? vus.slice(0, 50).map((j, i) => `<li role="option" data-id="${esc(j.id)}" aria-selected="${i === actif}">${esc(j.nom)}${j.info ? ` <small>${esc(j.info)}</small>` : ""}</li>`).join("") : `<li class="vide">Aucun joueur</li>`;
  };
  const ouvrir = (oui) => { pop.hidden = !oui; btn.setAttribute("aria-expanded", String(oui)); if (oui) { q.value = ""; actif = 0; dessiner(); q.focus(); } };
  btn.onclick = (e) => { e.stopPropagation(); ouvrir(pop.hidden); };
  q.oninput = () => { actif = 0; dessiner(); };
  q.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); actif = Math.max(0, Math.min(vus.length - 1, actif + (e.key === "ArrowDown" ? 1 : -1))); dessiner(); ul.children[actif]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" && vus[actif]) { e.preventDefault(); ouvrir(false); choisir(vus[actif].id); }
    else if (e.key === "Escape") { ouvrir(false); btn.focus(); }
  };
  ul.onmousedown = (e) => { const li = e.target.closest("li[data-id]"); if (li) { e.preventDefault(); ouvrir(false); choisir(li.dataset.id); } };
  const dehors = (e) => { if (!pop.isConnected) return document.removeEventListener("click", dehors); if (!pop.hidden && !b.contains(e.target)) ouvrir(false); };
  document.addEventListener("click", dehors);
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g,
  (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
// message en bas de l'écran (élément #toast de la page), 6 secondes
let toastMinuteur;
function signaler(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastMinuteur); toastMinuteur = setTimeout(() => { t.hidden = true; }, 6000);
}

// ------------------------------------------------------------------ outils golf (repris de Saison, communs à tous les modules)
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const AUJ = new Date().toISOString().slice(0, 10);
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
// tuile chiffrée (Mes stats, Coach)
const tuileSt = (val, lib, sous = "") => `<div class="st-tuile"><b>${val}</b><span>${lib}</span>${sous ? `<small>${sous}</small>` : ""}</div>`;

// ------------------------------------------------------------------ accueil : connexion, liens reçus, démarrage
// Repris de Saison (« accueil et démarrage », 05/11). La page du module fournit le balisage de l'accueil
// (#accueil, #a-form, #a-email, #a-mdp, #a-ok, #a-lien, #a-msg) et sa fonction entrer() (chargement après connexion).
// Plus de mot de passe de page : la page publique n'a aucune donnée ; après connexion, on télécharge
// gn-data.json.gz depuis l'espace privé Supabase (lisible par les comptes connectés seulement).
const nx$ = (id) => document.getElementById(id);
// invite : arrivé par un lien d'invitation ; mdpConnu : connecté par mot de passe (l'assistant ne le redemande pas)
const nexus = { invite: false, mdpConnu: false, demandeMdp: false, role: null };
async function telechargerDonnees() {
  const { data, error } = await sb.storage.from("donnees").download("gn-data.json.gz");
  if (error) throw error;
  return JSON.parse(await new Response(data.stream().pipeThrough(new DecompressionStream("gzip"))).text());
}
function msgAccueil(t, err = false) { finReprise(); const m = nx$("a-msg"); m.textContent = t; m.classList.toggle("erreur", err); }
// Reprise de session (07/11) : la page pose body.reprise dès <body> si une session « gn-auth » existe ; on montre alors
// un écran de chargement au lieu de l'accueil. On le retire dès qu'il faut l'accueil (pas de session, message, erreur)
// et, par sécurité, au bout de 10 secondes.
function finReprise() { document.body.classList.remove("reprise"); }
setTimeout(finReprise, 10000);
// Liens directs (#connexion=<jeton>, fonction Edge connexion-demo ; #invitation=<token_hash>), puis session :
// connecté → entrer() ; sinon on attend la connexion depuis l'accueil.
async function nexusDemarrer(entrer) {
  const h = new URLSearchParams(location.hash.slice(1));
  // lien de connexion directe (#connexion=<jeton>, fonction Edge connexion-demo) ou invitation (#invitation=<token_hash>)
  const jc = h.get("connexion"), inv = h.get("invitation");
  if (jc || inv || h.has("cle")) {
    for (const k of ["connexion", "invitation", "cle"]) h.delete(k);   // cle : reste des anciens liens (mot de passe de page)
    history.replaceState(null, "", location.pathname + location.search + (h.toString() ? "#" + h : ""));
  }
  try {
    if (jc) {
      msgAccueil("Connexion…");
      const d = await fetch(`${SB_URL}/functions/v1/connexion-demo`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_CLE },
        body: JSON.stringify({ jeton: jc }) }).then((r) => r.json());
      if (!d.token_hash) throw new Error(d.erreur || "refusé");
      const { error } = await sb.auth.verifyOtp({ token_hash: d.token_hash, type: "magiclink" });
      if (error) throw error;
    } else if (inv) {
      msgAccueil("Ouverture de ton invitation…");
      const { error } = await sb.auth.verifyOtp({ token_hash: inv, type: "invite" });
      if (error) throw error;
      nexus.invite = true;
    }
  } catch (e) { msgAccueil((jc ? "Lien de connexion refusé : " : "Invitation expirée ou déjà utilisée : ") + (e.message || e), true); }
  const { data } = await sb.auth.getSession();
  if (data.session) { entrer(); return; }
  finReprise();   // pas (ou plus) de session : l'accueil
  sb.auth.onAuthStateChange((ev, session) => { if (session) setTimeout(entrer, 0); });
}
// Formulaire de l'accueil : mot de passe, ou lien par e-mail (retour sur la page qui l'a demandé).
function nexusBrancherAccueil() {
  nx$("a-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = nx$("a-email").value.trim().toLowerCase(), mdp = nx$("a-mdp").value;
    if (!mdp) { msgAccueil("Saisis ton mot de passe, ou reçois un lien par e-mail.", true); nx$("a-mdp").focus(); return; }
    nx$("a-ok").disabled = true; msgAccueil("Connexion…");
    nexus.mdpConnu = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
    nx$("a-ok").disabled = false;
    if (error) msgAccueil(/invalid login/i.test(error.message) ? "E-mail ou mot de passe incorrect." : "Connexion impossible : " + error.message, true);
  });
  nx$("a-lien").addEventListener("click", async () => {
    const email = nx$("a-email").value.trim().toLowerCase();
    if (!email) { nx$("a-email").focus(); msgAccueil("Saisis d'abord ton e-mail.", true); return; }
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    if (!error) { msgAccueil(`Lien envoyé à ${email} : ouvre-le dans ce navigateur (valable 24 heures, une seule fois).`); return; }
    msgAccueil(/security purposes/i.test(error.message) ? "Un lien vient déjà d'être envoyé : regarde ta boîte (et les spams)."
      : /signups not allowed|not found|otp_disabled/i.test(error.message) ? "Cette adresse n'est pas invitée." : "Envoi impossible : " + error.message, true);
  });
}

// ------------------------------------------------------------------ profil : qui suis-je
// Ligne « profils » du compte (filtrée sur MON compte : un coach peut aussi lire celles de ses joueurs).
// structure (06/11) = le club du coach (rattaché par l'admin) : nom, club ffgolf, coach principal, coachs de l'académie.
async function nexusLireProfil(user) {
  const P = await sb.from("profils").select("domicile_nom,lat,lon,fiche,licence,licence_le,licence_verif,role,mineur,parent_valide_le,structure_id,club_licence").eq("id", user.id).maybeSingle();
  if (P.error) throw P.error;
  const d = P.data || {};
  let structure = null;
  if (d.structure_id) { const S = await sb.rpc("ma_structure_detail"); structure = (S.data || [])[0] || null; }
  nexus.role = d.role || "joueur";   // pour le lanceur (modules réservés à un rôle)
  return {
    role: d.role || "joueur", mineur: !!d.mineur, parentValide: d.parent_valide_le || null,
    clubLicence: d.club_licence || null, structure,
    licence: { num: d.licence || "", le: d.licence_le || null, verif: d.licence_verif || null },
    dom: d.lat != null ? { lat: d.lat, lon: d.lon, nom: d.domicile_nom } : null,   // domicile
    fiche: d.fiche || {},   // fiche joueur { nom, club, sexe, naissance, merite… }
  };
}

// ------------------------------------------------------------------ compte : panneau en haut à droite (#b-pan)
// Repris de Saison. Le module garde rendreCompte() (onglets, vues coach / démo) et y appelle
// nexusPanneauConnecte(mel) ou nexusPanneauConnexion() ; compteModule = son objet de compte (setFiche).
// Connexion par lien e-mail : à ouvrir dans le navigateur qui a fait la demande (PKCE).
const compte = { envoye: null, ouvert: false, parLien: false, mdp: false, email: "" };
const LIEN_REGLES = "Le lien est <b>à usage unique</b>, valable <b>24 heures</b>, et ne fonctionne que <b>dans ce navigateur</b> (celui où tu l'as demandé).";
// connecté : adresse, choisir son mot de passe, se déconnecter
function nexusPanneauConnecte(mel) {
  return `<p class="b-mel">Connecté : <b>${esc(mel)}</b></p>
      ${compte.viaLien ? `<p class="b-regles"><b>Tu es connecté par lien.</b> Choisis un mot de passe : la prochaine fois, tu te connecteras directement, sans attendre d'e-mail.</p>` : ""}
      <div class="b-menu b-bas">${compte.mdp
        ? `<form id="c-form-nouveau" class="c-form c-col"><input id="c-nouveau" type="password" autocomplete="new-password" minlength="8" placeholder="nouveau mot de passe (8 car. min.)" aria-label="Nouveau mot de passe" required>
          <button type="submit" class="btn plein">Enregistrer</button></form>${compte.viaLien ? `<button type="button" class="lien" id="c-plus-tard">Plus tard</button>` : `<p class="b-regles">Ensuite tu te connectes avec ton e-mail et ce mot de passe, sans attendre d'e-mail.</p>`}`
        : `<button type="button" role="menuitem" class="b-item" id="c-mdp">Choisir mon mot de passe</button>`}
      <button type="button" role="menuitem" class="b-item" id="c-sortir">Se déconnecter</button></div>`;
}
// pas connecté : mot de passe, ou lien par e-mail (e-mails envoyés par Brevo, golfnexus@sportsdatabucket.fr)
function nexusPanneauConnexion() {
  return compte.envoye
    ? `<p>E-mail envoyé à <b>${esc(compte.envoye)}</b> (expéditeur GolfNexus). Ouvre-le et clique sur « Me connecter ».</p>
      <p>${LIEN_REGLES}</p><div><button type="button" class="lien" id="c-autre">Autre adresse</button></div>`
    : compte.parLien
    ? `<p>Pas de mot de passe, ou oublié ? Reçois un lien de connexion par e-mail.</p>
    <form id="c-form" class="c-form"><input id="c-email" type="email" autocomplete="email" placeholder="ton e-mail" aria-label="Adresse e-mail" required value="${esc(compte.email || "")}">
    <button type="submit" class="btn plein">Recevoir le lien</button></form>
    <p class="b-regles">${LIEN_REGLES} Une fois connecté, choisis un mot de passe : plus besoin d'e-mail ensuite.</p>
    <div><button type="button" class="lien" id="c-par-mdp">← Se connecter avec un mot de passe</button></div>`
    : `<p>Connecte-toi pour retrouver ta saison et ton profil sur tous tes appareils (accès sur invitation).</p>
    <form id="c-form-mdp" class="c-form c-col"><input id="c-email" type="email" autocomplete="username" placeholder="ton e-mail" aria-label="Adresse e-mail" required value="${esc(compte.email || "")}">
    <input id="c-mdp-in" type="password" autocomplete="current-password" placeholder="mot de passe" aria-label="Mot de passe" required>
    <button type="submit" class="btn plein">Se connecter</button></form>
    <div><button type="button" class="lien" id="c-par-lien">Pas de mot de passe ou oublié ? Recevoir un lien par e-mail</button></div>`;
}
// Connexion par mot de passe (aucun e-mail envoyé, donc pas de limite) ; le lien par e-mail reste en secours :
// l'envoi intégré de Supabase est limité à 2 e-mails par heure pour tout le projet (constat du 04/11).
function nexusBrancherPanneau(rendre, compteModule) {
  nx$("b-pan").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (f.id === "c-form-nouveau") {
        const { error } = await sb.auth.updateUser({ password: nx$("c-nouveau").value });
        if (error) throw error;
        compte.mdp = false; compte.viaLien = false; compte.ouvert = false; rendre(); compteModule.setFiche({ mdpChoisi: true });
        signaler("Mot de passe enregistré : tu te connectes désormais avec ton e-mail et ce mot de passe.");
        return;
      }
      const email = nx$("c-email").value.trim().toLowerCase(); compte.email = email;
      if (f.id === "c-form-mdp") {
        nexus.mdpConnu = true;
        const { error } = await sb.auth.signInWithPassword({ email, password: nx$("c-mdp-in").value });
        if (error) throw error;
        compte.ouvert = false;   // la suite (chargement du compte) passe par onAuthStateChange
        return;
      }
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false,
        emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      compte.envoye = email; rendre();
    } catch (err) {
      const m = String(err.message || err);
      signaler(/invalid login credentials/i.test(m) ? "E-mail ou mot de passe incorrect (pas encore de mot de passe ? reçois un lien par e-mail)." :
        /signups not allowed|not found|otp_disabled/i.test(m) ? "Cette adresse n'est pas invitée." :
        /security purposes/i.test(m) ? `Un e-mail vient déjà d'être envoyé à cette adresse : regarde ta boîte (et les spams), ou redemande dans ${(m.match(/(\d+) seconds?/) || [, "60"])[1]} secondes.` :
        /rate limit/i.test(m) ? "Trop de demandes d'e-mail pour le moment : connecte-toi avec ton mot de passe, ou réessaie plus tard." :
        /weak|at least|characters/i.test(m) ? "Mot de passe trop court ou trop simple (8 caractères minimum)." : "Connexion impossible : " + m);
      btn.disabled = false;
    }
  });
}
// boutons du panneau ; renvoie true si le clic est traité (le module arrête alors son propre traitement)
function nexusClicPanneau(id, rendre) {
  if (id === "c-autre") { compte.envoye = null; rendre(); return true; }
  if (id === "c-par-lien" || id === "c-par-mdp") { compte.email = nx$("c-email")?.value.trim() || compte.email; compte.parLien = id === "c-par-lien"; rendre(); nx$("c-email")?.focus(); return true; }
  if (id === "c-plus-tard") { Object.assign(compte, { viaLien: false, mdp: false, ouvert: false }); rendre(); return true; }
  if (id === "c-mdp") { compte.mdp = true; rendre(); nx$("c-nouveau")?.focus(); return true; }
  if (id === "c-sortir") { compte.ouvert = false; sb.auth.signOut().then(() => { location.hash = ""; location.reload(); }); return true; }
  return false;
}

// ------------------------------------------------------------------ assistant de démarrage : étapes communes
// Le module garde l'assistant (écran, enchaînement, ses propres étapes) et y ajoute ces deux étapes obligatoires.
// compteModule : { moi (utilisateur), mineur, parentValide, fiche, setFiche() }.
// nexus.demandeMdp : arrivé par un lien (invitation, lien de connexion) → choisir un mot de passe.
function nexusEtapesCommunes(compteModule) {
  const E = [], f = compteModule.fiche || {};
  if (nexus.demandeMdp && !f.mdpChoisi) E.push("mdp");
  if (compteModule.mineur && !compteModule.parentValide) E.push("parent");
  return E;
}
const NEXUS_ETAPES = {
  mdp: {
    html: (pied) => `<h2>Choisis ton mot de passe</h2><p>Tu te connecteras ensuite avec ton e-mail et ce mot de passe, sans attendre d'e-mail.</p>
      <input id="as-mdp" type="password" autocomplete="new-password" minlength="8" required placeholder="8 caractères minimum">
      <input id="as-mdp2" type="password" autocomplete="new-password" minlength="8" required placeholder="confirme le mot de passe">${pied}`,
    async valider(compteModule) {
      if (nx$("as-mdp").value !== nx$("as-mdp2").value) throw new Error("les deux mots de passe sont différents");
      const { error } = await sb.auth.updateUser({ password: nx$("as-mdp").value }); if (error) throw error;
      compteModule.setFiche({ mdpChoisi: true });
    },
  },
  parent: {
    html: (pied) => `<h2>Compte d'un joueur de moins de 18 ans</h2><p>Ce compte est celui du <b>parent ou représentant légal</b>. C'est toi qui décideras qui peut suivre le joueur (coachs).</p>
      <label class="as-coche"><input type="checkbox" id="as-parent" required> Je suis le parent ou le représentant légal de ce joueur et j'accepte que ses données de golf (saison, résultats, Mérite) soient enregistrées dans GolfNexus.</label>${pied}`,
    async valider(compteModule) {
      const r = await sb.from("profils").update({ parent_valide_le: new Date().toISOString() }).eq("id", compteModule.moi.id).select("parent_valide_le").maybeSingle();
      if (r.error) throw r.error; compteModule.parentValide = r.data?.parent_valide_le;
    },
  },
};

// ------------------------------------------------------------------ invitations (fonction Edge « inviter »), repris de Saison
// Le lien de l'e-mail mène toujours à Saison (porte d'entrée de la suite, assistant de démarrage), quel que soit
// le module qui invite (Club, Admin…) : un joueur invité n'a rien à faire dans Club ou Admin (07/11).
// licence : obligatoire pour un joueur (06/11), fixée à l'invitation, non modifiable par le joueur
async function inviter(email, role, nom, licence = "") {
  const { data, error } = await sb.functions.invoke("inviter", { body: { email, role: role === "mineur" ? "joueur" : role, mineur: role === "mineur", nom, licence: String(licence || "").replace(/\s/g, ""),
    site: new URL("../saison/", location.href).href } });
  const msg = error ? (await error.context?.json?.().catch(() => null))?.erreur || error.message : data?.erreur;
  return msg || null;
}
