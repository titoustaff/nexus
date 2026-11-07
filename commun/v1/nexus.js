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
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g,
  (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
// message en bas de l'écran (élément #toast de la page), 6 secondes
let toastMinuteur;
function signaler(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastMinuteur); toastMinuteur = setTimeout(() => { t.hidden = true; }, 6000);
}

// ------------------------------------------------------------------ accueil : connexion, liens reçus, démarrage
// Repris de Saison (« accueil et démarrage », 05/11). La page du module fournit le balisage de l'accueil
// (#accueil, #a-form, #a-email, #a-mdp, #a-ok, #a-lien, #a-msg) et sa fonction entrer() (chargement après connexion).
// Plus de mot de passe de page : la page publique n'a aucune donnée ; après connexion, on télécharge
// gn-data.json.gz depuis l'espace privé Supabase (lisible par les comptes connectés seulement).
const nx$ = (id) => document.getElementById(id);
// invite : arrivé par un lien d'invitation ; mdpConnu : connecté par mot de passe (l'assistant ne le redemande pas)
const nexus = { invite: false, mdpConnu: false };
async function telechargerDonnees() {
  const { data, error } = await sb.storage.from("donnees").download("gn-data.json.gz");
  if (error) throw error;
  return JSON.parse(await new Response(data.stream().pipeThrough(new DecompressionStream("gzip"))).text());
}
function msgAccueil(t, err = false) { const m = nx$("a-msg"); m.textContent = t; m.classList.toggle("erreur", err); }
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
  return {
    role: d.role || "joueur", mineur: !!d.mineur, parentValide: d.parent_valide_le || null,
    clubLicence: d.club_licence || null, structure,
    licence: { num: d.licence || "", le: d.licence_le || null, verif: d.licence_verif || null },
    dom: d.lat != null ? { lat: d.lat, lon: d.lon, nom: d.domicile_nom } : null,   // domicile
    fiche: d.fiche || {},   // fiche joueur { nom, club, sexe, naissance, merite… }
  };
}
