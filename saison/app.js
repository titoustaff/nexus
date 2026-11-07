"use strict";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const AUJ = new Date().toISOString().slice(0, 10);

const etat = { parId: new Map(), sAnnee: null, regions: new Set(), deps: new Set(), depRegion: {}, tournois: [], golfs: {}, golfInfo: {}, resultats: null, ref: null, marqueurs: new Map(), vue: "tournois", kpi: null, ecran: "tournois" };
const $ = (id) => document.getElementById(id);
// esc, lsGet, lsSet, jsonLs, uuid, signaler : briques communes (../commun/v1/nexus.js).

function fmtDate(d) { const x = new Date(d + "T12:00:00"); return `${x.getDate()} ${MOIS_COURT[x.getMonth()]}`; }
function fmtPar(n) { return n == null ? "—" : n === 0 ? "par" : (n > 0 ? "+" : "") + n; }
function semaine(d) {
  const x = new Date(d + "T12:00:00"); const j = (x.getDay() + 6) % 7;
  const lun = new Date(x); lun.setDate(x.getDate() - j);
  const dim = new Date(lun); dim.setDate(lun.getDate() + 6);
  return [lun.toISOString().slice(0, 10), dim.toISOString().slice(0, 10)];
}
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
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
const golfDe = (t) => etat.golfs[t.golf];
// circuits ffgolf collectés (pipeline/ffgolf.py CIRCUITS) ; les données d'avant le 04/11 n'ont que des Grands Prix
// libellés choisis par l'utilisateur (04/11) : Jeunes, Adultes, Mid-Amateurs, Seniors
const CIRCUITS = { jeunes: "Jeunes", gp: "Adultes", mid: "Mid-Amateurs", seniors: "Seniors" };
// précision affichée : catégorie d'âge pour les jeunes (U14…), type d'épreuve pour les seniors (Trophée Vétéran…)
const circuitLib = (t) => { const c = circuitDe(t);
  return CIRCUITS[c] + (c === "jeunes" && t.categorie ? " · " + t.categorie : c === "seniors" && t.type ? " · " + t.type : ""); };
const circuitDe = (t) => t.circuit || "gp";
// Mérites ffgolf, nommés et rangés comme les circuits (le Mérite National Amateur = circuit « Adultes »)
const LISTES_M = { jeunes: "Jeunes", amateurs: "Adultes", midams: "Mid-Amateurs", seniors: "Seniors" };
const LISTE_DU_CIRCUIT = { jeunes: "jeunes", gp: "amateurs", mid: "midams", seniors: "seniors" };
// dernier mois relevé d'un Mérite (donnée ffgolf, relevée par le robot : lendemain du 1er jeudi et mercredi d'après)
function dernierMerite(liste) {
  return (Saison.stats?.mois || []).filter((m) => m.liste === liste).sort((a, b) => a.mois.localeCompare(b.mois)).at(-1) || null;
}
// moyenne vs SSS du joueur POUR UN TOURNOI : celle du Mérite du circuit du tournoi ; à défaut Mérite Adultes ;
// à défaut celle lue au choix de la fiche (compte tout neuf, pas encore relevé). Décision du 06/11.
function moyPour(t) {
  for (const l of [LISTE_DU_CIRCUIT[circuitDe(t)], "amateurs"]) { const m = dernierMerite(l); if (m?.moy != null) return { moy: +m.moy, liste: l }; }
  const fm = Saison.fiche?.merite;
  return fm?.moy != null ? { moy: +fm.moy, liste: "amateurs" } : null;
}
// Éligibilité par l'âge (Vademecum ffgolf, voir MD_DOC/PLAN.md) : âge = année du tournoi − année de naissance.
// Jeunes : jusqu'à 16 ans (U12 ≤ 12, U14 / Benjamins ≤ 14, U16 / Minimes ≤ 16) ; Adultes : tous ;
// Mid-Amateurs : 25 ans et + ; Seniors : 50 / 60 / 70 ans et + selon la catégorie. Âge inconnu → pas de restriction.
// (Mid-Am et Seniors comptent en réalité l'âge à la veille de l'épreuve : à un an près selon l'anniversaire.)
function ageOk(t, naissance = (Saison.fiche || {}).naissance) {
  if (!naissance) return true;
  const a = (t.annee || new Date().getFullYear()) - naissance, c = circuitDe(t), cat = t.categorie || "";
  if (c === "jeunes") return a <= (/U12/.test(cat) ? 12 : /U14|Benjamin/.test(cat) ? 14 : 16);
  if (c === "mid") return a >= 25;
  if (c === "seniors") { const m = cat.match(/\+(\d+)/); return a >= (m ? +m[1] : 50); }
  return true;
}
function circuitOk(c, naissance) {
  if (!naissance || !c || c === "gp") return true;
  const a = new Date().getFullYear() - naissance;
  return c === "jeunes" ? a <= 16 : c === "mid" ? a >= 25 : a >= 50;
}
function suggestionCircuit(naissance) {
  if (!naissance) return null;
  const age = new Date().getFullYear() - naissance;
  return age <= 16 ? "jeunes" : age >= 50 ? "seniors" : age >= 25 ? "mid" : "gp";
}
const posDe = (t) => { const g = golfDe(t); return g && g.lat ? { lat: g.lat, lon: g.lon } : null; };
const ouvertA = (t, s) => !s || (s === "H" ? t.sexe !== "Femme" : t.sexe !== "Homme");

// ------------------------------------------------------------------ chargement
// Données intégrées dans la page (site publié, chiffré) ; sinon lecture de data/ (développement).
const J = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let D = window.GN_DATA;   // test local (--clair) ; publié : téléchargé après connexion (entrer())
async function charger() {
  const [tournois, golfs, meta] = D ? [D.tournois, D.golfs, D.meta]
    : await Promise.all([J("../data/tournois.json"), J("../data/golfs.json"), J("../reports/derniere_collecte.json")]);
  etat.tournois = tournois || [];
  etat.clubs = (D && D.clubs) || [];   // référentiel des clubs ffgolf (noms du Mérite, ex. « PIC SAINT-LOUP »)
  etat.parId = new Map(etat.tournois.map((t) => [t.id, t]));
  Saison.chargerLocal();
  for (const g of golfs || []) etat.golfs[g.slug] = g;
  for (const t of etat.tournois) {
    const i = etat.golfInfo[t.golf] ||= { ligue: t.ligue, departement: t.departement, pays: t.pays || "France", n: 0 };
    i.n++;
  }
  if (meta && meta.date) $("maj").textContent = "Données du " + new Date(meta.date).toLocaleDateString("fr-FR");
  initFiltres();
  initCarte();
  distanceDuProfil();
  rendre();
  if ($("f-place").checked) resultats().then(rendre);
  // liens directs : #v=saison (écran Ma saison), #k=<tuile> (semaine|mois|avenir|saison|golfs), #t=<id tournoi>, #g=<golf>
  const h = new URLSearchParams(location.hash.slice(1));
  majBadgeSaison();
  $("s-dom").value = Saison.domicile()?.nom || "";
  initCompte();
  // #v=profil : le profil n'existe que connecté ; la session arrive un peu après, on y bascule à ce moment-là
  if ((h.get("v") === "profil" || h.get("v") === "stats") && Saison.mode !== "compte") etat.veutProfil = h.get("v");
  else if (h.get("v") === "saison" || h.get("v") === "profil") ecran(h.get("v"));
  if (h.get("vue")) {   // depuis Club : voir la saison (ou les stats) d'un joueur suivi
    etat.veutVue = { id: h.get("vue"), cible: h.get("cible") === "stats" ? "stats" : "saison" };
    h.delete("vue"); h.delete("cible");
    history.replaceState(null, "", location.pathname + location.search + (h.toString() ? "#" + h : ""));
  }
  if (h.get("k")) tuile(h.get("k"));
  const t = h.get("t") && etat.tournois.find((x) => x.id === h.get("t"));
  if (t) ouvrir(t);
  const g = h.get("g") && etat.golfs[h.get("g")];
  if (g) ouvrirGolf(g);
}
// Critère « distance » de la fiche joueur : appliqué à la carte et à la liste à chaque ouverture (bascule
// « distAuto », active par défaut). Un changement fait sur la carte vaut pour la visite en cours seulement.
// force = changement fait dans la fiche : on réapplique même si la carte avait été modifiée.
// Circuit par défaut : « Adultes », ou celui de la fiche joueur ; un changement sur la carte vaut pour la visite.
function circuitDuProfil(force = false) {
  if (etat.circuitManuel && !force) return;
  const f = Saison.fiche || {};
  $("f-circuit").value = circuitOk(f.circuit, f.naissance) ? (f.circuit ?? "gp") : "gp";
  if (force) etat.circuitManuel = false;
}
// changementCircuit : circuit changé sur la carte → la distance du profil se réapplique, sans toucher au circuit
function distanceDuProfil(force = false, changementCircuit = false) {
  if (!changementCircuit) circuitDuProfil(force);
  if (etat.refManuel && !force && !changementCircuit) return;
  const f = Saison.fiche || {}, dom = Saison.domicile(), sel = $("f-rayon");
  const auto = f.distAuto !== false && dom && f.distMax;
  if (auto) {
    const v = String(f.distMax);
    if (![...sel.options].some((o) => o.value === v)) {
      sel.add(new Option(`${f.distMax} km`, v));
      [...sel.options].slice(1).sort((a, b) => a.value - b.value).forEach((o) => sel.add(o));
    }
    etat.ref = { lat: dom.lat, lon: dom.lon, nom: dom.nom }; $("f-ref").value = dom.nom; sel.value = v;
  } else if (force || etat.refAuto) { etat.ref = null; $("f-ref").value = ""; sel.value = ""; }
  etat.refAuto = !!auto;
  if (force || changementCircuit) etat.refManuel = false;
}
async function resultats() {
  if (!etat.resultats) etat.resultats = (D ? D.resultats : await J("../data/resultats.json")) || {};
  return etat.resultats;
}

// ------------------------------------------------------------------ filtres
function initFiltres() {
  const annees = [...new Set(etat.tournois.map((t) => t.annee))].sort();
  const an = new Date().getFullYear();
  // seul critère par défaut : l'année en cours (pastille retirable) ; la liste s'ouvre sur le prochain tournoi
  const defaut = annees.includes(an) ? an : annees.at(-1);
  $("f-annee").innerHTML = `<option value="">Toutes</option>` + annees.map((a) => `<option ${a === defaut ? "selected" : ""}>${a}</option>`).join("");
  $("f-mois").innerHTML = `<option value="">Tous</option><option value="S">Cette semaine</option>` +
    MOIS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  const opts = (k) => [...new Set(etat.tournois.map((t) => t[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  for (const t of etat.tournois) if (t.departement && t.ligue) etat.depRegion[t.departement] = t.ligue;
  // Région (= ligue FFGolf) et département : choix multiples, qui s'additionnent (« Occitanie + Gironde »).
  initMulti("m-region", etat.regions, () => opts("ligue").map((v) => ({ v, l: titre(v) })), "régions");
  initMulti("m-dep", etat.deps, () => opts("departement").map((v) => ({ v, l: v, g: titre(etat.depRegion[v] || "Autres"),
    inclus: etat.regions.has(etat.depRegion[v]) })).sort((a, b) => a.g.localeCompare(b.g, "fr") || a.l.localeCompare(b.l, "fr")), "départements");
  $("f-pays").innerHTML += opts("pays").map((v) => `<option>${esc(v)}</option>`).join("");

  // « Ma place » : préférence de ce navigateur (mémorisée), calcul à partir de la fiche joueur
  try { $("f-place").checked = localStorage.getItem("gn-f-place") === "1"; } catch { /* */ }
  $("f-place").addEventListener("change", async (e) => {
    lsSet("gn-f-place", e.target.checked ? "1" : "");
    const f = Saison.fiche || {};
    if (e.target.checked && Saison.mode !== "compte") signaler("Connecte-toi et remplis « Mon profil » pour estimer ta place sur chaque tournoi.");
    else if (e.target.checked && (!f.sexe || !f.merite)) signaler("Renseigne ton sexe et choisis ta fiche Mérite dans « Mon profil » pour estimer ta place.");
    if (e.target.checked) await resultats();
    rendre();
  });
  for (const id of ["f-annee", "f-mois", "f-avenir"]) $(id).addEventListener("change", () => { etat.kpi = null; etat.vue = "tournois"; rendre(); });
  for (const id of ["f-sexe", "f-tours", "f-rayon", "f-circuit"]) $(id).addEventListener("change", rendre);
  // le circuit choisi sur la carte devient celui de la fiche (choix utilisateur du 04/11), s'il est ouvert à son âge ;
  // sinon (ex. un adulte qui regarde les Jeunes) il ne vaut que pour la visite. La distance du profil suit.
  $("f-circuit").addEventListener("change", () => {
    const c = $("f-circuit").value, f = Saison.fiche || {};
    if (Saison.mode === "compte" && circuitOk(c, f.naissance)) Saison.setFiche({ circuit: c }); else etat.circuitManuel = true;
    distanceDuProfil(false, true); rendre();
  });
  for (const id of ["f-ref", "f-rayon", "f-geo"]) $(id).addEventListener(id === "f-geo" ? "click" : "change", () => { etat.refManuel = true; });
  $("f-pays").addEventListener("change", () => { majZone(); rendre(); });
  $("kpis").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) tuile(b.dataset.k); });
  $("f-ref").addEventListener("change", geocoder);
  $("f-geo").addEventListener("click", () => navigator.geolocation?.getCurrentPosition((p) => {
    etat.ref = { lat: p.coords.latitude, lon: p.coords.longitude, nom: "ma position" };
    $("f-ref").value = "Ma position"; if (!$("f-rayon").value) $("f-rayon").value = "200"; rendre();
  }));
}

async function geocoder() {
  const q = $("f-ref").value.trim();
  if (!q) { etat.ref = null; rendre(); return; }
  try {
    const r = await fetch("https://api-adresse.data.gouv.fr/search/?limit=1&q=" + encodeURIComponent(q)).then((r) => r.json());
    const f = r.features && r.features[0];
    if (f) {
      const [lon, lat] = f.geometry.coordinates;
      etat.ref = { lat, lon, nom: f.properties.label };
      $("f-ref").value = f.properties.label;
      if (!$("f-rayon").value) $("f-rayon").value = "200";
    }
  } catch { /* hors ligne */ }
  rendre();
}

// Critères « où / qui » (sexe, région, département, rayon, pays) : communs à la liste, aux tuiles et à la vue golfs.
// Régions et départements choisis s'additionnent : un lieu passe s'il est dans une région OU un département coché.
function lieuOk(ligue0, dep0, pos, pays0) {
  const rayon = +$("f-rayon").value, pays = $("f-pays").value;
  if (pays && (pays0 || "France") !== pays) return { ok: false };
  if ((etat.regions.size || etat.deps.size) && !(etat.regions.has(ligue0) || etat.deps.has(dep0))) return { ok: false };
  const d = etat.ref && pos ? km(etat.ref, pos) : null;
  if (rayon && etat.ref && (d == null || d > rayon)) return { ok: false };
  return { ok: true, km: d };
}
function geo(t) {
  if (!ouvertA(t, $("f-sexe").value)) return false;
  const circ = $("f-circuit").value;
  if (circ && circuitDe(t) !== circ) return false;
  const tours = +$("f-tours").value;
  if (tours && (tours === 4 ? (t.nb_tours || 0) < 4 : t.nb_tours !== tours)) return false;
  const r = lieuOk(t.ligue, t.departement, posDe(t), t.pays);
  t._km = r.km ?? null;
  return r.ok;
}
function filtrer() {
  const an = $("f-annee").value, mois = $("f-mois").value, avenir = $("f-avenir").checked;
  const [lun, dim] = semaine(AUJ);
  return etat.tournois.filter((t) => {
    if (!geo(t)) return false;
    if (an && t.annee !== +an) return false;
    if (mois === "S") { if (!(t.fin >= lun && t.debut <= dim)) return false; }
    else if (mois && +t.debut.slice(5, 7) !== +mois) return false;
    if (avenir && t.fin < AUJ) return false;
    return true;
  }).sort((a, b) => a.debut.localeCompare(b.debut) || a.nom.localeCompare(b.nom));
}

// Tuiles cliquables : chacune applique son critère de période (les critères géographiques sont conservés).
function tuile(k) {
  const an = new Date().getFullYear();
  if (etat.kpi === k) k = null;                      // re-clic : on désactive
  etat.kpi = k; etat.vue = k === "golfs" ? "golfs" : "tournois";
  const set = (a, m, v) => { $("f-annee").value = a; $("f-mois").value = m; $("f-avenir").checked = v; };
  if (k === "semaine") set(String(an), "S", false);
  else if (k === "mois") set(String(an), String(+AUJ.slice(5, 7)), false);
  else if (k === "avenir") set("", "", true);
  else if (k === "saison") set(String(an), "", false);
  rendre();
}

// ------------------------------------------------------------------ carte
let carte, couche, coucheRef;
// Fond sobre gratuit sans clé (commun à la carte des tournois et à celle de « Ma saison »)
function fond(m) {
  const sombre = matchMedia("(prefers-color-scheme: dark)").matches;
  // Esri Canvas gris clair / gris foncé, sans clé : fond + couche de libellés.
  const esri = (n) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${n}/MapServer/tile/{z}/{y}/{x}`;
  const v = sombre ? "Dark" : "Light";
  L.tileLayer(esri(`World_${v}_Gray_Base`), {
    maxZoom: 16, attribution: 'Fond &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(m);
  m.createPane("libelles").style.zIndex = 350;          // libellés sous les pastilles
  m.getPane("libelles").style.pointerEvents = "none";
  L.tileLayer(esri(`World_${v}_Gray_Reference`), { maxZoom: 16, pane: "libelles" }).addTo(m);
}
function initCarte() {
  carte = L.map("carte", { zoomSnap: 0.5 }).setView([46.6, 2.4], 5.5);
  fond(carte);
  // Pastilles proches regroupées ; la couleur du groupe suit son tournoi le plus « actif ».
  masquePays();
  couche = L.markerClusterGroup({
    maxClusterRadius: 38, disableClusteringAtZoom: 9, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const e = c.getAllChildMarkers().map((m) => m.options.etat);
      const cls = e.includes("ouvert") ? "ouvert" : (e.includes("avenir") || e.includes("golf")) ? "" : "passe";
      const n = c.getChildCount(), d = n < 10 ? 30 : n < 50 ? 36 : 42;
      return L.divIcon({ html: `<div class="groupe ${cls}" style="width:${d}px;height:${d}px">${n}</div>`, className: "", iconSize: [d, d] });
    },
  }).addTo(carte);
  coucheRef = L.layerGroup().addTo(carte);
}
// Carte centrée sur les pays actifs : ceux qui ont des tournois dans les données ET un contour (site/pays.json).
// Aujourd'hui la France ; ajouter l'Espagne = collecter ses tournois + ajouter son contour. L'extérieur est estompé.
const zone = { masque: null, trait: null, bornes: null, active: false, tous: null };
async function masquePays() {
  zone.tous = D ? D.pays : (await J("pays.json"))?.pays;
  if (!zone.tous) return;
  carte.createPane("masque").style.zIndex = 360;            // au-dessus des libellés, sous les pastilles
  carte.getPane("masque").style.pointerEvents = "none";
  majZone();
}
function majZone() {
  if (!zone.tous) return;
  const choix = $("f-pays").value;
  const actifs = (choix ? [choix] : [...new Set(etat.tournois.map((t) => t.pays || "France"))]).filter((p) => zone.tous[p]);
  const trous = actifs.flatMap((p) => zone.tous[p]).map((r) => r.map(([lon, lat]) => [lat, lon]));
  if (zone.active) zoneActive(false);
  zone.bornes = null;
  if (!trous.length) return;                                // pays sans contour : carte libre
  const css = getComputedStyle(document.documentElement);
  const monde = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
  zone.masque = L.polygon([monde, ...trous], { pane: "masque", stroke: false, fillColor: css.getPropertyValue("--fond").trim(), fillOpacity: 0.82, interactive: false });
  zone.trait = L.polygon(trous, { pane: "masque", color: css.getPropertyValue("--sauge").trim(), weight: 1.2, fill: false, interactive: false });
  zone.bornes = L.latLngBounds(trous.flat());
  zoneActive(true);
}
// Activée : masque + carte bornée aux pays actifs. Désactivée quand la sélection n'a que des lieux hors zone (outre-mer).
function zoneActive(on) {
  if (zone.active === on || (on && !zone.bornes)) return;
  zone.active = on;
  if (on) {
    zone.masque.addTo(carte); zone.trait.addTo(carte);
    carte.setMaxBounds(zone.bornes.pad(0.25));
    carte.setMinZoom(Math.max(2, carte.getBoundsZoom(zone.bornes) - 1));
  } else {
    zone.masque.remove(); zone.trait.remove();
    carte.setMaxBounds(null); carte.setMinZoom(1);
  }
}
function refEtCadre(pts) {
  if (etat.ref) {
    L.circleMarker([etat.ref.lat, etat.ref.lon], { radius: 6, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(coucheRef);
    if (+$("f-rayon").value) L.circle([etat.ref.lat, etat.ref.lon], { radius: +$("f-rayon").value * 1000, color: "#14532d", weight: 1, fillOpacity: .04 }).addTo(coucheRef);
  }
  // On cadre les lieux situés dans les pays actifs ; si la sélection n'a que de l'outre-mer
  // (Réunion, Nouvelle-Calédonie…), la carte se libère pour aller les montrer.
  const dedans = zone.bornes ? pts.filter((p) => zone.bornes.contains(p))
    : pts.filter(([la, lo]) => la > 41 && la < 51.5 && lo > -5.5 && lo < 10);
  zoneActive(dedans.length > 0 || !pts.length);
  const cadre = dedans.length ? dedans : pts;
  if (cadre.length) carte.fitBounds(cadre, { padding: [30, 30], maxZoom: 9 });
}
const etatT = (t) => (t.fin < AUJ ? "passe" : t.cloture && t.cloture >= AUJ ? "ouvert" : "avenir");
function couleur(t) {
  const css = getComputedStyle(document.documentElement);
  return css.getPropertyValue({ passe: "--passe", ouvert: "--jaune", avenir: "--vert-2" }[etatT(t)]).trim();
}

// ------------------------------------------------------------------ rendu
function rendre() {
  kpis();
  puces();
  enBref();
  if (etat.vue === "golfs") return rendreGolfs();
  const liste = filtrer();
  $("compte").textContent = `${liste.length} tournoi${liste.length > 1 ? "s" : ""}` +
    (etat.ref ? ` · distances depuis ${esc(etat.ref.nom)}` : "");
  $("legende").innerHTML = [["--vert-2", "à venir"], ["--jaune", "inscriptions ouvertes", "var(--jaune-trait)"], ["--passe", "passé"]]
    .map(([v, l, b]) => `<span><span class="pastille" style="background:var(${v})${b ? ";border-color:" + b : ""}"></span>${l}</span>`).join("");

  couche.clearLayers(); coucheRef.clearLayers(); etat.marqueurs.clear();
  const pts = [];
  for (const t of liste) {
    const p = posDe(t); if (!p) continue;
    const e = etatT(t);
    const m = L.circleMarker([p.lat, p.lon], { etat: e, radius: e === "passe" ? 5 : 8, weight: e === "ouvert" ? 2.5 : 2,
      color: e === "ouvert" ? getComputedStyle(document.documentElement).getPropertyValue("--jaune-trait").trim() : "#fff",
      fillColor: couleur(t), fillOpacity: e === "passe" ? .8 : 1 })
      .bindTooltip(`<b>${esc(titre(t.nom))}</b><br>${fmtDate(t.debut)} → ${fmtDate(t.fin)}<br>${esc(titre(t.golf_nom))}` +
        (t._km != null ? `<br>${Math.round(t._km)} km` : ""))
      .on("mouseout", (e) => e.target.closeTooltip())
      .on("click", () => { fermerBulles(); ouvrir(t); });
    m.addTo(couche); etat.marqueurs.set(t.id, m); pts.push([p.lat, p.lon]);
  }
  refEtCadre(pts);

  $("liste").innerHTML = liste.length ? liste.map((t) => {
    const ouvert = t.cloture && t.cloture >= AUJ && t.fin >= AUJ;
    return `<li class="item ${t.fin < AUJ ? "passe" : ""}" tabindex="0" data-id="${esc(t.id)}" data-q="${esc(plier(t.nom + " " + t.golf_nom + " " + (t.ville || "")))}">${etoile(t.id)}
      <div class="date"><b>${new Date(t.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[+t.debut.slice(5, 7) - 1]}</span></div>
      <div><h3>${esc(titre(t.nom))}</h3>
        <div class="meta">${esc(titre(t.golf_nom))} · ${esc(t.departement || titre(t.ville))}${t._km != null ? ` · <b>${Math.round(t._km)} km</b>` : ""}</div>
        <div class="meta">${t.sexe !== "Mixte" ? `<span class="tag">${esc(t.sexe)}</span>` : ""}<span class="tag circuit c-${circuitDe(t)}">${esc(circuitLib(t))}</span><span class="tag">${t.nb_tours} tours</span>${t.index_max_h ? `<span class="tag">idx H ≤ ${t.index_max_h}</span>` : ""}${ouvert ? `<span class="tag ok">inscriptions jusqu'au ${fmtDate(t.cloture)}</span>` : ""}${t.resultats ? `<span class="tag">résultats</span>` : ""}${tagPlace(t)}</div>
      </div></li>`;
  }).join("") : `<li class="vide">Aucun tournoi pour ces critères.</li>`;
  // repère « aujourd'hui » avant le premier tournoi non terminé (s'il y a du passé au-dessus)
  const i = liste.findIndex((t) => t.fin >= AUJ);
  if (i > 0) $("liste").children[i].insertAdjacentHTML("beforebegin", `<li class="auj" aria-hidden="true"><span>Aujourd'hui</span></li>`);
  $("l-prochain-lib").hidden = false; $("l-place-lib").hidden = false;
  allerAuProchain(false);
  chercher(false);
}

// option « Aller au prochain » (mémorisée) : la liste s'ouvre sur le prochain tournoi possible
function allerAuProchain(doux) {
  const ol = $("liste");
  const cible = $("l-prochain").checked && ol.querySelector(".auj");
  ol.scrollTo({ top: cible ? cible.offsetTop : 0, behavior: doux ? "smooth" : "auto" });
}
$("l-prochain").checked = lsGet("gn-prochain") !== "0";
$("l-prochain").addEventListener("change", (e) => { lsSet("gn-prochain", e.target.checked ? "1" : "0"); allerAuProchain(true); });

function kpis() {
  const an = new Date().getFullYear(), circ = $("f-circuit").value;
  const pool = etat.tournois.filter(geo);
  const [lun, dim] = semaine(AUJ), mois = AUJ.slice(0, 7);
  const n = {
    semaine: pool.filter((t) => t.fin >= lun && t.debut <= dim).length,
    mois: pool.filter((t) => t.debut.startsWith(mois)).length,
    avenir: pool.filter((t) => t.fin >= AUJ).length,
    saison: pool.filter((t) => t.annee === an).length,
    golfs: golfsFiltres().length,
  };
  $("kpis").innerHTML = [
    ["semaine", "tournois cette semaine"], ["mois", "tournois ce mois-ci"], ["avenir", "compétitions à venir"],
    ["saison", `tournois ${circ ? CIRCUITS[circ] + " " : ""}en ${an}`], ["golfs", circ ? `golfs du circuit ${CIRCUITS[circ]}` : "golfs référencés"],
  ].map(([k, l]) => `<button type="button" class="kpi${k === "golfs" ? " secondaire" : ""}" data-k="${k}" aria-pressed="${etat.kpi === k}"><b>${n[k]}</b><span>${l}</span></button>`).join("");
}

// ------------------------------------------------------------------ menus à choix multiple
const multis = [];
function initMulti(id, sel, options, pluriel) {
  const el = $(id), btn = el.querySelector(".multi-btn"), pan = el.querySelector(".multi-pan");
  const cherche = pan.querySelector("input"), liste = pan.querySelector(".multi-liste");
  const m = { el, sel, options, pluriel, vide: el.dataset.vide, val: $(id + "-val"), btn };
  const dessiner = () => {
    const q = cherche.value.trim().toLowerCase();
    let g0 = null;
    liste.innerHTML = options().filter((o) => !q || o.l.toLowerCase().includes(q) || (o.g || "").toLowerCase().includes(q)).map((o) => {
      const titreG = o.g && o.g !== g0 ? `<div class="groupe-titre">${esc((g0 = o.g))}</div>` : "";
      return `${titreG}<label class="${o.inclus ? "inclus" : ""}"><input type="checkbox" value="${esc(o.v)}" ${sel.has(o.v) || o.inclus ? "checked" : ""} ${o.inclus ? "disabled" : ""}>${esc(o.l)}${o.inclus ? "<small>inclus</small>" : ""}</label>`;
    }).join("") || `<div class="vide">Aucun résultat</div>`;
  };
  const ouvrirPan = (on) => {
    for (const x of multis) if (x !== m) x.fermer();
    pan.hidden = !on; btn.setAttribute("aria-expanded", on);
    if (on) {
      cherche.value = ""; dessiner();
      pan.style.left = ""; pan.style.right = "";
      if (pan.getBoundingClientRect().right > innerWidth - 8) { pan.style.left = "auto"; pan.style.right = "0"; }
      cherche.focus();
    }
  };
  m.fermer = () => { pan.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => ouvrirPan(pan.hidden));
  cherche.addEventListener("input", dessiner);
  liste.addEventListener("change", (e) => {
    const v = e.target.value; e.target.checked ? sel.add(v) : sel.delete(v);
    majMulti(); rendre();
  });
  pan.querySelector(".multi-effacer").addEventListener("click", () => { sel.clear(); dessiner(); majMulti(); rendre(); });
  pan.querySelector(".multi-ok").addEventListener("click", () => { m.fermer(); btn.focus(); });
  multis.push(m);
}
function majMulti() {
  for (const m of multis) {
    const n = m.sel.size, un = [...m.sel][0];
    m.val.textContent = !n ? m.vide : n === 1 ? (m.el.id === "m-region" ? titre(un) : un) : `${n} ${m.pluriel}`;
    m.btn.classList.toggle("choisi", n > 0);
  }
}
document.addEventListener("click", (e) => { if (!e.target.closest(".multi")) for (const m of multis) m.fermer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") for (const m of multis) m.fermer(); });

// ------------------------------------------------------------------ filtres actifs
function puces() {
  const sel = (id) => $(id).selectedOptions[0]?.textContent;
  const p = [];
  if (etat.vue === "golfs") p.push(["Vue : golfs", () => { etat.vue = "tournois"; etat.kpi = null; }]);
  if ($("f-annee").value) p.push([sel("f-annee"), () => ($("f-annee").value = "")]);
  if ($("f-sexe").value) p.push([sel("f-sexe"), () => ($("f-sexe").value = "")]);
  if ($("f-mois").value) p.push([sel("f-mois").replace(/^./, (c) => c.toUpperCase()), () => ($("f-mois").value = "")]);
  if ($("f-tours").value) p.push([sel("f-tours"), () => ($("f-tours").value = "")]);
  if ($("f-circuit").value) p.push([sel("f-circuit"), () => ($("f-circuit").value = "")]);
  for (const r of etat.regions) p.push([titre(r), () => { etat.regions.delete(r); majMulti(); }]);
  for (const d of etat.deps) p.push([d, () => { etat.deps.delete(d); majMulti(); }]);
  if (etat.ref) p.push([`Autour de ${etat.ref.nom}${$("f-rayon").value ? " · " + $("f-rayon").value + " km" : ""}`,
    () => { etat.ref = null; $("f-ref").value = ""; $("f-rayon").value = ""; etat.refManuel = true; }]);
  if ($("f-avenir").checked) p.push(["À venir", () => ($("f-avenir").checked = false)]);
  if ($("f-pays").value) p.push([$("f-pays").value, () => { $("f-pays").value = ""; majZone(); }]);
  etat.puces = p;
  const nb = $("nb-filtres"); nb.hidden = !p.length; nb.textContent = p.length;
  $("actifs").innerHTML = p.length ? p.map(([l], i) => `<button type="button" class="puce" data-i="${i}" title="Retirer ce filtre">${esc(l)}<i aria-hidden="true">×</i></button>`).join("") +
    (p.length > 1 ? `<button type="button" class="raz" id="raz">Tout réinitialiser</button>` : "") : "";
}
// panneau des critères : fermé par défaut, ouvert au besoin
$("t-filtres").addEventListener("click", (e) => {
  const ouvert = e.currentTarget.getAttribute("aria-expanded") !== "true";
  e.currentTarget.setAttribute("aria-expanded", ouvert);
  $("champs").hidden = !ouvert;
});
$("actifs").addEventListener("click", (e) => {
  const b = e.target.closest(".puce");
  if (b) { etat.puces[+b.dataset.i][1](); if (etat.vue !== "golfs") etat.kpi = null; rendre(); return; }
  if (e.target.id === "raz") { for (const [, f] of etat.puces) f(); etat.kpi = null; etat.vue = "tournois"; rendre(); }
});

function enBref() {
  const s = $("f-sexe").value, an = new Date().getFullYear();
  const circ = $("f-circuit").value;
  const saison = etat.tournois.filter((t) => t.annee === an && ouvertA(t, s) && (!circ || circuitDe(t) === circ));
  const joues = saison.filter((t) => t.fin < AUJ).length;
  const prochains = etat.tournois.filter((t) => t.fin >= AUJ && geo(t)).sort((a, b) => a.debut.localeCompare(b.debut));
  const t = prochains[0];
  const j = t ? Math.round((new Date(t.debut + "T12:00") - new Date(AUJ + "T12:00")) / 864e5) : null;
  // phrase en clair (retour utilisateur du 04/11 : « 214 GP joués sur 218 » était peu lisible)
  const reste = saison.length - joues, suivant = etat.tournois.some((x) => x.annee === an + 1 && (!circ || circuitDe(x) === circ));
  const nomC = circ ? ` ${CIRCUITS[circ]}` : " (tous circuits)";
  $("saison").innerHTML = `Avancée de la saison ${an}${nomC} : ${reste ? `encore <b>${reste}</b> tournois à jouer sur ${saison.length}` : "tous les tournois sont joués"}` +
    ` · ${suivant ? `calendrier <b>${an + 1}</b> disponible` : `calendrier ${an + 1} pas encore publié par la ffgolf`}`;
  $("saison").title = `Saison ${an}${nomC} : ${joues} tournois déjà joués sur ${saison.length} au calendrier ffgolf (suit le circuit et la catégorie choisis dans les critères)`;
  const b = $("prochain");
  b.dataset.id = t ? t.id : "";
  b.innerHTML = t ? `
    <div class="quand"><b>${new Date(t.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[+t.debut.slice(5, 7) - 1]}</span></div>
    <div class="sur">Prochain tournoi · ${j <= 0 ? "en cours" : j === 1 ? "demain" : "dans " + j + " jours"}</div>
    <div class="nom">${esc(titre(t.nom))}</div>
    <div class="ou">${esc(titre(t.golf_nom))} · ${esc(t.departement || "")}${t._km != null ? " · " + Math.round(t._km) + " km" : ""}${t.cloture && t.cloture >= AUJ ? `<span class="ok">inscriptions → ${fmtDate(t.cloture)}</span>` : ""}</div>`
    : `<div class="quand"><b>—</b><span>&nbsp;</span></div><div class="sur">Prochain tournoi</div><div class="nom">Aucun pour ces critères</div><div class="ou">Le calendrier ${an + 1} sera ajouté dès sa publication.</div>`;
}
$("prochain").addEventListener("click", () => { const t = etat.tournois.find((x) => x.id === $("prochain").dataset.id); if (t) ouvrir(t); });

// ------------------------------------------------------------------ vue golfs
function golfsFiltres() {
  // golfs du circuit choisi : ceux qui reçoivent au moins un tournoi de ce circuit
  const circ = $("f-circuit").value, duCircuit = circ && new Set(etat.tournois.filter((t) => circuitDe(t) === circ).map((t) => t.golf));
  return Object.values(etat.golfs).filter((g) => {
    if (duCircuit && !duCircuit.has(g.slug)) return false;
    const i = etat.golfInfo[g.slug] || {};
    const r = lieuOk(i.ligue, i.departement, g.lat ? { lat: g.lat, lon: g.lon } : null, i.pays);
    g._km = r.km ?? null;
    return r.ok;
  }).sort((a, b) => (a._km ?? 0) - (b._km ?? 0) || titre(a.nom).localeCompare(titre(b.nom), "fr"));
}
function rendreGolfs() {
  const liste = golfsFiltres();
  $("compte").textContent = `${liste.length} golf${liste.length > 1 ? "s" : ""}` + (etat.ref ? ` · triés par distance depuis ${etat.ref.nom}` : "");
  $("legende").innerHTML = `<span class="pastille" style="background:var(--vert)"></span>golf (cliquer pour la fiche)`;
  $("l-prochain-lib").hidden = true; $("l-place-lib").hidden = true;
  couche.clearLayers(); coucheRef.clearLayers(); etat.marqueurs.clear();
  const pts = [];
  for (const g of liste) {
    if (!g.lat) continue;
    const m = L.circleMarker([g.lat, g.lon], { etat: "golf", radius: 6, weight: 2, color: "#fff", fillColor: getComputedStyle(document.documentElement).getPropertyValue("--vert").trim(), fillOpacity: .95 })
      .bindTooltip(`<b>${esc(titre(g.nom))}</b><br>${esc(titre(g.ville))}` + (g._km != null ? `<br>${Math.round(g._km)} km` : ""))
      .on("mouseout", (e) => e.target.closeTooltip())
      .on("click", () => { fermerBulles(); ouvrirGolf(g); });
    m.addTo(couche); etat.marqueurs.set(g.slug, m); pts.push([g.lat, g.lon]);
  }
  refEtCadre(pts);
  $("liste").innerHTML = liste.length ? liste.map((g) => {
    const i = etat.golfInfo[g.slug] || {};
    const p18 = (g.parcours || []).filter((p) => p.trous >= 18);
    const long = Math.max(0, ...(g.parcours || []).flatMap((p) => p.reperes.map((r) => r.distance || 0)));
    return `<li class="item" tabindex="0" data-golf="${esc(g.slug)}" data-q="${esc(plier(g.nom + " " + (g.ville || "")))}">
      <div class="date"><b>${(g.parcours || []).length}</b><span>parc.</span></div>
      <div><h3>${esc(titre(g.nom))}</h3>
        <div class="meta">${esc(titre(g.ville))} · ${esc(i.departement || "")}${g._km != null ? ` · <b>${Math.round(g._km)} km</b>` : ""}</div>
        <div class="meta">${p18.length ? `<span class="tag">${p18.length} × 18 trous</span>` : ""}${long ? `<span class="tag">jusqu'à ${long} m</span>` : ""}<span class="tag">${i.n || 0} GP</span></div>
      </div></li>`;
  }).join("") : `<li class="vide">Aucun golf pour ces critères.</li>`;
  chercher(false);
}

// ------------------------------------------------------------------ recherche dans la liste
// Ne filtre pas : surligne les tournois / golfs dont le nom contient le texte, se positionne
// sur le premier (le plus proche d'aujourd'hui en vue tournois) et le montre sur la carte.
const plier = (x) => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const rech = { trouves: [], i: 0 };
function chercher(montrer = true) {
  const q = plier($("l-cherche").value);
  const ol = $("liste");
  for (const li of ol.querySelectorAll(".item.trouve, .item.courant")) li.classList.remove("trouve", "courant");
  rech.trouves = q ? [...ol.querySelectorAll(".item")].filter((li) => q.split(" ").every((m) => li.dataset.q.includes(m))) : [];
  for (const li of rech.trouves) li.classList.add("trouve");
  const n = rech.trouves.length;
  $("l-cherche-prec").hidden = $("l-cherche-suiv").hidden = n < 2;
  $("l-cherche-n").textContent = !q ? "" : n ? `1/${n}` : "aucun";
  $("l-cherche").classList.toggle("rate", !!q && !n);
  if (!n) return;
  // en vue tournois, commencer au premier tournoi pas encore terminé (sinon le premier trouvé)
  const auj = ol.querySelector(".auj");
  const j = auj ? rech.trouves.findIndex((li) => li.compareDocumentPosition(auj) & Node.DOCUMENT_POSITION_PRECEDING) : -1;
  aller(j > 0 ? j : 0, montrer);
}
function aller(i, montrer = true) {
  const n = rech.trouves.length; if (!n) return;
  rech.i = (i + n) % n;
  rech.trouves.forEach((li, k) => li.classList.toggle("courant", k === rech.i));
  const li = rech.trouves[rech.i];
  $("l-cherche-n").textContent = `${rech.i + 1}/${n}`;
  const ol = $("liste");
  const haut = Math.max(0, li.offsetTop - ol.clientHeight / 3);
  ol.scrollTo({ top: haut, behavior: Math.abs(haut - ol.scrollTop) < 1500 ? "smooth" : "auto" });   // grand saut : direct
  if (!montrer) return;
  const m = etat.marqueurs.get(li.dataset.id || li.dataset.golf);
  if (m) { fermerBulles(); couche.zoomToShowLayer(m, () => { carte.panTo(m.getLatLng()); m.openTooltip(); }); }
}
let rechMinuteur;
$("l-cherche").addEventListener("input", () => { clearTimeout(rechMinuteur); rechMinuteur = setTimeout(chercher, 200); });
$("l-cherche").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(rechMinuteur);
    if (plier(e.target.value) && !rech.trouves.length) chercher(); else aller(rech.i + (e.shiftKey ? -1 : 1)); }
  if (e.key === "Escape" && e.target.value) { e.target.value = ""; chercher(false); allerAuProchain(true); fermerBulles(); }
});
$("l-cherche").addEventListener("search", (e) => { if (!e.target.value) { chercher(false); allerAuProchain(true); fermerBulles(); } });
$("l-cherche-prec").addEventListener("click", () => aller(rech.i - 1));
$("l-cherche-suiv").addEventListener("click", () => aller(rech.i + 1));

$("liste").addEventListener("click", (e) => {
  const et = e.target.closest(".etoile");
  if (et) { basculerSaison(et.dataset.id); return; }
  const li = e.target.closest(".item"); if (!li) return;
  if (li.dataset.golf) ouvrirGolf(etat.golfs[li.dataset.golf]); else ouvrir(etat.tournois.find((t) => t.id === li.dataset.id));
});
$("liste").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("item")) e.target.click(); });
function fermerBulles() { for (const m of etat.marqueurs.values()) m.closeTooltip(); }
$("liste").addEventListener("mouseover", (e) => {
  const li = e.target.closest(".item"); if (!li || li.contains(e.relatedTarget)) return;
  fermerBulles();
  const m = etat.marqueurs.get(li.dataset.id || li.dataset.golf);
  if (m && couche.getVisibleParent(m) === m) m.openTooltip();   // pas de bulle si la pastille est dans un groupe
});
$("liste").addEventListener("mouseout", (e) => {
  const li = e.target.closest(".item"); if (li && !li.contains(e.relatedTarget)) fermerBulles();
});
$("liste").addEventListener("mouseleave", fermerBulles);

// ------------------------------------------------------------------ fiche
async function ouvrir(t) {
  const g = golfDe(t) || {};
  const res = await resultats();
  const editions = etat.tournois.filter((x) => x.golf === t.golf && res[x.id]).sort((a, b) => b.debut.localeCompare(a.debut));

  $("fiche-contenu").innerHTML = `
    <h2 id="fiche-titre">${esc(titre(t.nom))}</h2>
    <div class="sous">${esc(t.complement ? t.complement + " · " : "")}${fmtDate(t.debut)} → ${fmtDate(t.fin)} ${t.annee} · ${esc(titre(g.nom || t.golf_nom))}</div>
    <div class="bloc grille">
      <div><span>Type</span>${esc(t.type || "—")}</div>
      <div><span>Ouvert à</span>${esc(t.sexe)} · ${esc(t.categorie || "")}</div>
      <div><span>Circuit</span>${esc(CIRCUITS[circuitDe(t)])} · ${esc(t.type || "Grand Prix")}${t.categorie && t.categorie !== "Toutes catégories" ? " · " + esc(t.categorie) : ""}</div>
      <div><span>Format</span>${esc(t.formule || "")} · ${t.nb_tours} tours</div>
      <div><span>Index max</span>H ${t.index_max_h ?? "n.c."} · D ${t.index_max_d ?? "n.c."}</div>
      <div><span>Clôture inscriptions</span>${t.cloture ? fmtDate(t.cloture) : "—"}</div>
      <div><span>Lieu</span>${esc(titre(t.ville))} (${esc(t.departement || "")}) · ${esc(t.ligue || "")}</div>
      ${t._km != null ? `<div><span>Distance</span>${Math.round(t._km)} km à vol d'oiseau</div>` : ""}
      ${t.categorie_gp.length ? `<div><span>Catégorie GP</span>${t.categorie_gp.map(esc).join("<br>")}</div>` : ""}
    </div>
    <div class="sous"><a href="${esc(t.url)}" target="_blank" rel="noopener">Page officielle ffgolf.org ↗</a></div>
    ${blocSaisonFiche(t)}
    ${blocPlaceProbable(t, g, res, editions)}
    ${blocCompetition(t, g, res, editions)}
    <h3>Résultats ${editions.length ? "et historique sur ce golf" : ""}</h3>
    ${editions.length ? `<div class="onglets" id="onglets"></div><div id="res"></div>` : `<div class="bloc vide">Pas encore de résultats pour ce golf.</div>`}`;
  $("fiche").hidden = false;
  $("fiche-fermer").focus();

  if (editions.length) onglets(editions, res, t.id);
}

function onglets(editions, res, idPref) {
  const choix = [];
  for (const e of editions) for (const [i, ep] of res[e.id].entries()) choix.push({ e, ep, lab: `${e.annee} · ${ep.serie || "Série " + (i + 1)}${editions.some((x) => x.nom !== e.nom) ? " · " + e.nom : ""}` });
  const pref = $("f-sexe").value === "D" ? "F" : "M";
  let sel = choix.findIndex((c) => c.e.id === idPref && c.ep.sexe === pref); if (sel < 0) sel = choix.findIndex((c) => c.ep.sexe === pref); if (sel < 0) sel = 0;
  const dessiner = () => {
    $("onglets").innerHTML = choix.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="${i === sel}">${esc(c.lab)}</button>`).join("");
    $("res").innerHTML = blocResultat(choix[sel].e, choix[sel].ep);
  };
  $("onglets").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) { sel = +b.dataset.i; dessiner(); } });
  dessiner();
}

async function ouvrirGolf(g) {
  const res = await resultats();
  const ts = etat.tournois.filter((x) => x.golf === g.slug).sort((a, b) => b.debut.localeCompare(a.debut));
  const editions = ts.filter((x) => res[x.id]);
  const i = etat.golfInfo[g.slug] || {};
  $("fiche-contenu").innerHTML = `
    <h2 id="fiche-titre">${esc(titre(g.nom))}</h2>
    <div class="sous">${esc(titre(g.ville))} · ${esc(i.departement || "")} · ${esc(i.ligue || "")}${g._km != null ? ` · ${Math.round(g._km)} km` : ""}</div>
    ${ficheGolf(g)}
    <h3>Tournois sur ce golf</h3>
    <div class="bloc">${ts.length ? `<table><tbody>${ts.map((t) => `<tr class="lien-t" data-id="${esc(t.id)}" tabindex="0">
      <td>${fmtDate(t.debut)} ${t.annee}</td><td><a href="#t=${esc(t.id)}">${esc(titre(t.nom))}</a></td><td>${esc(t.sexe)}</td><td class="n">${t.nb_tours} tours</td></tr>`).join("")}</tbody></table>` : "Aucun"}</div>
    <h3>Résultats</h3>
    ${editions.length ? `<div class="onglets" id="onglets"></div><div id="res"></div>` : `<div class="bloc vide">Pas de résultats.</div>`}`;
  $("fiche").hidden = false;
  $("fiche-fermer").focus();
  $("fiche-contenu").querySelectorAll(".lien-t").forEach((tr) => tr.addEventListener("click", (e) => {
    e.preventDefault(); ouvrir(etat.tournois.find((t) => t.id === tr.dataset.id));
  }));
  if (editions.length) onglets(editions, res, editions[0].id);
}

// Repères « classiques » (compétition) affichés d'emblée ; les autres (U10, Min, Ben…) repliés.
const principal = (r) => /^(noirs?|blancs?|jaunes?|bleus?|rouges?|violets?|oranges?|verts?)$/i.test((r.couleur || "").trim());
const ligneRepere = (r) => `<tr><td><span class="pastille" style="background:${esc(r.fond || "#ccc")}"></span>${esc(r.couleur)}</td>
  <td class="n">${r.distance ? r.distance + " m" : "—"}</td><td class="n">${r.sss_h ?? "—"}</td><td class="n">${r.slope_h ?? "—"}</td>
  <td class="n">${r.sss_d ?? "—"}</td><td class="n">${r.slope_d ?? "—"}</td></tr>`;
// ------------------------------------------------------------------ parcours et repères de la compétition
// Sur la fiche d'un tournoi : uniquement le parcours joué et les repères de compétition
// (GP : Messieurs aux Blancs, Dames aux Bleus). Toutes les couleurs restent dans la fiche golf.
const norm = (x) => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\bst\b/g, "saint").replace(/\b(grand prix|gp|parcours|golf|course|le|la|les|de|du|des)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
function parcoursJoue(g, nom) {
  const p18 = (g.parcours || []).filter((p) => p.trous >= 18);
  if (!p18.length) return null;
  if (nom) {
    const exact = p18.find((p) => p.nom.toLowerCase() === nom.toLowerCase());
    if (exact) return exact;
    const mots = new Set(norm(nom).split(" ").filter(Boolean));
    const score = (p) => norm(p.nom).split(" ").filter((m) => mots.has(m)).length;
    const meilleur = p18.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (score(meilleur) > 0) return meilleur;
  }
  return p18.length === 1 ? p18[0] : p18.reduce((a, b) => (Math.max(...b.reperes.map((r) => r.distance || 0)) > Math.max(...a.reperes.map((r) => r.distance || 0)) ? b : a));
}
// Repère de compétition d'un TOURNOI (son circuit à lui, pas celui affiché sur la carte : un jeune qui joue un GP
// adulte part des repères adultes ce jour-là). Vademecum ffgolf 2026 :
//  - Adultes (GP) : Messieurs Blancs (repère 2), Dames Bleus (repère 4) ;
//  - Jeunes (§ 3.6-4) : distance préconisée par catégorie et sexe → repère du parcours le plus proche ;
//  - Trophées Seniors / Seniors 2 / 3 (p. 52) : Messieurs Jaunes (repère 3), Dames Rouges (repère 5) ;
//  - GP Seniors Sélectifs (p. 52) : Messieurs repère 2 (≥ 5 800 m), Dames repère 4 (≥ 5 100 m) ;
//  - Mid-Amateurs (p. 50) : repère au choix du comité → par défaut ceux des GP.
const DIST_JEUNES = { Minimes: { H: 5945, D: 5035 }, Benjamins: { H: 5540, D: 4660 }, U12: { H: 4910, D: 4275 } };
function categorieJeune(t) {
  // catégorie du joueur s'il a l'âge de ce tournoi, sinon celle du tournoi
  const n = (Saison.fiche || {}).naissance, a = n ? t.annee - n : null, cat = t.categorie || "";
  if (a != null && ageOk(t, n)) return a <= 12 ? "U12" : a <= 14 ? "Benjamins" : "Minimes";
  return /U12/.test(cat) ? "U12" : /U14|Benjamin/.test(cat) ? "Benjamins" : "Minimes";
}
function repereCompet(p, sexe, t) {
  const k = sexe === "H" ? "sss_h" : "sss_d";
  const ok = p.reperes.filter((r) => r[k] && principal(r));
  const couleur = (re) => ok.find((r) => re.test(r.couleur.trim()));
  const plusProche = (m) => ok.slice().sort((a, b) => Math.abs((a.distance || 0) - m) - Math.abs((b.distance || 0) - m))[0];
  const plusLong = () => ok.slice().sort((a, b) => (b.distance || 0) - (a.distance || 0))[0];
  const c = t ? circuitDe(t) : "gp";
  if (c === "jeunes") return plusProche(DIST_JEUNES[categorieJeune(t)][sexe === "H" ? "H" : "D"]) || null;
  if (c === "seniors" && !/grand prix/i.test(t.type || ""))
    return couleur(sexe === "H" ? /^jaunes?$/i : /^rouges?$/i) || plusProche(sexe === "H" ? 5600 : 4800) || null;
  return couleur(sexe === "H" ? /^blancs?$/i : /^bleus?$/i) || plusLong() || null;
}
function regleReperes(t) {
  const c = circuitDe(t);
  if (c === "jeunes") { const cat = categorieJeune(t), d = DIST_JEUNES[cat];
    return `Repères Jeunes ${cat} : le plus proche de ${d.H.toLocaleString("fr-FR")} m (garçons) et ${d.D.toLocaleString("fr-FR")} m (filles), distances préconisées par la ffgolf.`; }
  if (c === "seniors" && !/grand prix/i.test(t.type || "")) return "Repères Trophées Seniors : Messieurs aux Jaunes, Dames aux Rouges (recommandation ffgolf).";
  if (c === "seniors") return "Repères GP Seniors Sélectifs : Messieurs aux Blancs, Dames aux Bleus.";
  if (c === "mid") return "Mid-Amateurs : repères choisis par le comité de l'épreuve (affichés : ceux des GP, Messieurs Blancs, Dames Bleus).";
  return "Repères de compétition GP : Messieurs aux Blancs, Dames aux Bleus.";
}
function blocCompetition(t, g, res, editions) {
  if (!g.slug) return "";
  // parcours joué : résultats de cette édition, sinon de l'édition précédente sur ce golf
  const ref = res[t.id] ? t : editions.find((e) => e.nom === t.nom) || editions[0];
  const eps = (ref && res[ref.id]) || [];
  const ep = eps[0];
  const parDe = (x) => (eps.find((e) => e.sexe === (x === "H" ? "M" : "F")) || {}).par_parcours || p.par;   // par réellement joué par série
  const p = parcoursJoue(g, ep && ep.parcours);
  if (!p) return `<h3>Le parcours</h3><div class="bloc vide">Parcours non renseigné. <a href="#g=${esc(g.slug)}" class="vers-golf">Fiche du golf</a></div>`;
  const pref = $("f-sexe").value === "D" ? ["D", "H"] : ["H", "D"];
  const sexes = pref.filter((x) => t.sexe === "Mixte" || (x === "H" ? t.sexe === "Homme" : t.sexe === "Femme"));
  const lignes = sexes.map((x) => {
    const r = repereCompet(p, x, t); if (!r) return "";
    const sss = x === "H" ? r.sss_h : r.sss_d, slope = x === "H" ? r.slope_h : r.slope_d, par = parDe(x);
    return `<div class="compet">
      <div class="qui">${circuitDe(t) === "jeunes" ? `${x === "H" ? "Garçons" : "Filles"} · ${categorieJeune(t)}` : x === "H" ? "Messieurs" : "Dames"}</div>
      <div class="rep"><span class="pastille" style="background:${esc(r.fond || "#ccc")}"></span>${esc(r.couleur)}</div>
      <div><b>${r.distance ? r.distance.toLocaleString("fr-FR") + " m" : "—"}</b><span>distance</span></div>
      <div><b>${par ?? "—"}</b><span>par${par && p.par && par !== p.par ? " (compét.)" : ""}</span></div>
      <div><b>${sss ?? "—"}</b><span>SSS</span></div>
      <div><b>${slope ?? "—"}</b><span>slope</span></div>
    </div>`;
  }).join("");
  return `<h3>Le parcours de la compétition</h3>
    <div class="bloc">
      <div><b>${esc(p.nom)}</b> — ${p.trous} trous${p.architecte ? ` · ${esc(p.architecte)}` : ""}</div>
      ${p.type.length ? `<div class="meta">${p.type.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      ${lignes}
      <div class="meta" style="margin-top:8px">${ep ? `Parcours d'après les résultats ${ref.annee}. ` : ""}${regleReperes(t)}
        · <a href="#g=${esc(g.slug)}" class="vers-golf">Fiche complète du golf (tous les parcours et repères)</a></div>
    </div>
    <div class="bloc grille">
      <div><span>Adresse</span>${esc(g.adresse || "—")}</div>
      ${g.telephone ? `<div><span>Téléphone</span>${esc(g.telephone)}</div>` : ""}
      ${g.site ? `<div><span>Site</span><a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(g.site.replace(/^https?:\/\//, ""))}</a></div>` : ""}
    </div>`;
}
$("fiche-contenu").addEventListener("click", (e) => {
  const a = e.target.closest(".vers-golf"); if (!a) return;
  e.preventDefault(); const slug = a.getAttribute("href").slice(3); if (etat.golfs[slug]) ouvrirGolf(etat.golfs[slug]);
});

function ficheGolf(g) {
  if (!g.slug) return "";
  const parcours = (g.parcours || []).map((p) => `
    <div class="bloc">
      <b>${esc(p.nom)}</b> — ${p.trous} trous, par ${p.par ?? "?"}${p.architecte ? ` · ${esc(p.architecte)}` : ""}${p.creation ? ` (${esc(p.creation)})` : ""}
      ${p.type.length ? `<div class="meta">${p.type.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      <div class="defile"><table><thead><tr><th>Repère</th><th class="n">Distance</th><th class="n">SSS H</th><th class="n">Slope H</th><th class="n">SSS D</th><th class="n">Slope D</th></tr></thead><tbody>
      ${p.reperes.filter(principal).map(ligneRepere).join("")}
      </tbody></table></div>
      ${p.reperes.some((r) => !principal(r)) ? `<details class="autres"><summary>Autres repères (${p.reperes.filter((r) => !principal(r)).length}) : jeunes, mini, débutants…</summary>
        <div class="defile"><table><tbody>${p.reperes.filter((r) => !principal(r)).map(ligneRepere).join("")}</tbody></table></div></details>` : ""}
    </div>`).join("");
  return `<h3>Le golf</h3>
    <div class="bloc grille">
      <div><span>Adresse</span>${esc(g.adresse || "—")}</div>
      ${g.telephone ? `<div><span>Téléphone</span>${esc(g.telephone)}</div>` : ""}
      ${g.site ? `<div><span>Site</span><a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(g.site.replace(/^https?:\/\//, ""))}</a></div>` : ""}
      <div><span>Fiche</span><a href="${esc(g.url)}" target="_blank" rel="noopener">guide des golfs ffgolf ↗</a></div>
    </div>${parcours}`;
}

function blocResultat(e, ep) {
  const s = ep.stats || {};
  const ch = [["Vainqueur", fmtPar(s.vainqueur)], ["Top 5", fmtPar(s.top5)], ["Top 10", fmtPar(s.top10)], ["Top 20", fmtPar(s.top20)],
    ["Cut", s.cut != null ? fmtPar(s.cut) : "—"], ["Moyenne / tour", s.moyenne_tour ?? "—"], ["Partants", s.partants ?? "—"]];
  const nbT = Math.max(...ep.classement.map((l) => l.tours.length));
  return `<div class="bloc">
    <div class="sous">${esc(titre(e.nom))} ${e.annee} · ${esc(ep.serie)} · ${esc(ep.parcours || "")} (par ${ep.par_parcours ?? "?"}) · ${esc(ep.statut_resultat || "")}</div>
    <div class="chiffres">${ch.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="classement"><table><thead><tr><th>Pos.</th>${Array.from({ length: nbT }, (_, i) => `<th class="n">T${i + 1}</th>`).join("")}<th class="n">Total</th><th class="n">Par</th></tr></thead><tbody>
    ${ep.classement.map((l) => `<tr><td>${esc(l.pos)}</td>${Array.from({ length: nbT }, (_, i) => `<td class="n">${l.tours[i] ?? ""}</td>`).join("")}<td class="n"><b>${l.total}</b></td><td class="n">${fmtPar(l.par)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

$("fiche-fermer").addEventListener("click", () => { $("fiche").hidden = true; fermerBulles(); });
// page « Tes données personnelles » (RGPD, 06/11) : lisible avant même de se connecter (par-dessus l'accueil)
// placée directement sous <body> : dans un conteneur, elle restait DERRIÈRE l'écran de connexion (z-index du parent)
document.body.appendChild($("rgpd"));
const ouvrirRgpd = (oui = true) => { $("rgpd").hidden = !oui; if (oui) $("rgpd-fermer").focus(); };
document.addEventListener("click", (e) => { if (e.target.closest("[data-rgpd]")) ouvrirRgpd(); else if (e.target.id === "rgpd" || e.target.id === "rgpd-fermer") ouvrirRgpd(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("rgpd").hidden) ouvrirRgpd(false); });
if (new URLSearchParams(location.hash.slice(1)).get("v") === "rgpd") ouvrirRgpd();
$("fiche").addEventListener("click", (e) => { if (e.target.id === "fiche") $("fiche").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("fiche").hidden = true; });

// ------------------------------------------------------------------ Ma saison
// Une saison par année (n'importe quelle année des données, y compris passée pour s'entraîner) = ses tournois.
// En base, la table « saisons » permettrait plusieurs listes par année : l'écran n'en montre qu'une (choix
// de l'utilisateur, plus simple) ; s'il en existe plusieurs, c'est la première qui est utilisée.
// Deux stockages derrière le même objet Saison : ce navigateur (sans compte) ou Supabase (connecté).
// SB_URL, SB_CLE et le client sb : briques communes (../commun/v1/nexus.js, chargé avant ce fichier).

const Saison = {
  mode: "local", user: null,
  listes: [],          // [{ id, nom, annee }]
  items: {},           // items[idListe][idTournoi] = { statut, note, ajoute }
  actives: {},         // actives[annee] = idListe
  dom: null,           // domicile { lat, lon, nom }
  fiche: {},           // fiche joueur (voir setFiche)

  // ---- stockage navigateur (sans compte) ; reprend le prototype v1 (une liste par année)
  chargerLocal() {
    let d = jsonLs("gn-saison-v2");
    if (!d) {
      d = { listes: [], items: {} };
      for (const [id, e] of Object.entries(jsonLs("gn-saison-v1") || {})) {
        const t = tournoiDe(id); if (!t) continue;
        let l = d.listes.find((x) => x.annee === t.annee);
        if (!l) { l = { id: uuid(), nom: "Principale", annee: t.annee }; d.listes.push(l); d.items[l.id] = {}; }
        d.items[l.id][id] = e;
      }
    }
    Object.assign(this, { mode: "local", user: null, listes: d.listes, items: d.items,
      actives: jsonLs("gn-actives") || {}, dom: jsonLs("gn-domicile"), fiche: {} });   // pas de profil sans compte (choix du 04/11)
  },
  ecrireLocal() {
    if (this.mode === "local") lsSet("gn-saison-v2", JSON.stringify({ listes: this.listes, items: this.items }));
    lsSet("gn-actives", JSON.stringify(this.actives));
  },
  // écriture en base sans attendre (l'écran est déjà à jour) ; erreur → message
  base(promesse, quoi) {
    if (this.demo) { if (!this.demoDit) { this.demoDit = true; signaler("Démo en lecture seule : ce changement n'est pas enregistré."); } return; }
    promesse.then(({ error }) => { if (error) signaler(/identite_verrouillee/.test(error.message)
        ? "Joueur verrouillé : ta licence a été reconnue dans les résultats, la fiche Mérite ne peut plus changer (sauf en changeant de licence)."
        : `Enregistrement impossible (${quoi}) : ${error.message}`); })
      .catch(() => signaler(`Enregistrement impossible (${quoi}) : connexion perdue ?`));
  },

  // ---- listes
  listesDe(an) {   // la liste principale d'abord, puis par nom
    const p = (l) => (l.nom === "Principale" || l.nom === "Ma saison " + l.annee ? 0 : 1);
    return this.listes.filter((l) => l.annee === an).sort((a, b) => p(a) - p(b) || a.nom.localeCompare(b.nom, "fr"));
  },
  active(an) {
    const id = this.actives[an];
    return this.listes.some((l) => l.id === id && l.annee === an) ? id : (this.listesDe(an)[0] || {}).id || null;
  },
  choisir(an, id) { this.actives[an] = id; this.ecrireLocal(); },
  creer(nom, an) {
    const l = { id: uuid(), nom, annee: an };
    this.listes.push(l); this.items[l.id] = {}; this.actives[an] = l.id; this.ecrireLocal();
    if (this.mode === "compte") this.base(sb.from("saisons").insert({ id: l.id, nom, annee: an }), "nouvelle liste");
    return l.id;
  },
  renommer(id, nom) {
    const l = this.listes.find((x) => x.id === id); if (!l) return;
    l.nom = nom; this.ecrireLocal();
    if (this.mode === "compte") this.base(sb.from("saisons").update({ nom }).eq("id", id), "renommer");
  },
  supprimer(id) {
    this.listes = this.listes.filter((x) => x.id !== id); delete this.items[id]; this.ecrireLocal();
    if (this.mode === "compte") this.base(sb.from("saisons").delete().eq("id", id), "supprimer la liste");
  },
  nomDe(id) { return (this.listes.find((x) => x.id === id) || {}).nom || ""; },

  // ---- tournois : toujours dans la liste active de l'année du tournoi
  get(id) { const t = tournoiDe(id); const l = t && this.active(t.annee); return (l && this.items[l]?.[id]) || null; },
  set(id, champs) {
    const t = tournoiDe(id); if (!t) return;
    const l = this.active(t.annee) || this.creer("Principale", t.annee);
    const e = this.items[l][id] = { statut: "envisage", note: "", ajoute: AUJ, ...this.items[l][id], ...champs };
    this.ecrireLocal();
    if (this.mode === "compte") this.base(sb.from("saison_tournois").upsert({ saison_id: l, tournoi_id: id, statut: e.statut,
      note: e.note, ajoute_le: e.ajoute, modifie_le: new Date().toISOString() }), "tournoi");
  },
  retirer(id) {
    const t = tournoiDe(id); const l = t && this.active(t.annee); if (!l || !this.items[l]) return;
    delete this.items[l][id]; this.ecrireLocal();
    if (this.mode === "compte") this.base(sb.from("saison_tournois").delete().eq("saison_id", l).eq("tournoi_id", id), "retirer");
  },
  entrees(l) { return Object.entries(this.items[l] || {}).map(([id, e]) => ({ t: tournoiDe(id), e })).filter((x) => x.t); },

  // ---- domicile (profil quand on est connecté)
  domicile() { return this.dom; },
  // fiche joueur { nom, club, sexe "H"|"D", naissance, index, moy, moy6, distMax, merite:{…} }
  setFiche(champs) {
    this.fiche = { ...this.fiche, ...champs };
    for (const [k, v] of Object.entries(this.fiche)) if (v === null || v === "" || v === undefined) delete this.fiche[k];
    if (this.mode === "compte") this.base(sb.from("profils").update({ fiche: this.fiche, modifie_le: new Date().toISOString() }).eq("id", this.user.id), "profil");
    else lsSet("gn-profil", JSON.stringify(this.fiche));
    setTimeout(() => rendreBienvenue(), 0);   // l'accueil guidé coche l'étape
  },
  setDomicile(d) {
    this.dom = d;
    if (this.mode === "compte") this.base(sb.from("profils").update({ domicile_nom: d?.nom ?? null, lat: d?.lat ?? null,
      lon: d?.lon ?? null, modifie_le: new Date().toISOString() }).eq("id", this.user.id), "domicile");
    else lsSet("gn-domicile", d ? JSON.stringify(d) : "");
  },

  // ---- lien de démo (lecture seule, sans connexion) : données renvoyées par la fonction partage(jeton)
  chargerDemo(d) {
    const listes = d.saisons || [], items = {};
    for (const l of listes) items[l.id] = {};
    for (const r of d.items || []) (items[r.saison_id] ||= {})[r.tournoi_id] = { statut: r.statut, note: r.note, ajoute: r.ajoute_le };
    const P = d.profil || {}, actives = {};
    for (const l of listes) if (l.annee && !actives[l.annee]) actives[l.annee] = l.id;
    Object.assign(this, { mode: "compte", demo: { nom: d.nom || "joueur", expire: d.expire }, user: { id: "demo", email: "" }, listes, items, actives,
      dom: P.lat != null ? { lat: P.lat, lon: P.lon, nom: P.domicile_nom } : null, fiche: P.fiche || {},
      resultats: Object.fromEntries((d.resultats || []).map((r) => [r.tournoi_id, r])),
      licence: { num: P.licence_verif ? "•" : "", le: null, verif: P.licence_verif || null }, stats: { mois: d.mois || [], tournois: d.tournois || [] } });
  },

  // ---- connexion : lecture du compte ; 1re fois, on y recopie ce qui était dans ce navigateur
  async connecter(user) {
    // filtré sur MON compte : un coach peut aussi lire les données de ses joueurs (règles « coach : lecture »)
    this.demo = null; this.moi = user;
    const L = await sb.from("saisons").select("id,nom,annee").eq("user_id", user.id);
    const ids = (L.data || []).map((l) => l.id);
    const [I, P] = await Promise.all([ids.length ? sb.from("saison_tournois").select("saison_id,tournoi_id,statut,note,ajoute_le").in("saison_id", ids) : { data: [] },
      nexusLireProfil(user)]);   // profil : brique commune (../commun/v1/nexus.js)
    const err = L.error || I.error; if (err) throw err;
    Object.assign(this, { role: P.role, mineur: P.mineur, parentValide: P.parentValide, clubLicence: P.clubLicence, structure: P.structure });
    // places obtenues : rangées par la collecte du lundi (pipeline/perso.py), seulement la ligne du joueur
    const RP = await sb.from("resultats_perso").select("tournoi_id,place,classes,inscrits,tours,total,par,serie,lu_le,trous,pars,parcours").eq("user_id", user.id);
    this.resultats = Object.fromEntries((RP.data || []).map((r) => [r.tournoi_id, r]));
    this.licence = P.licence;
    // Mes stats : historique Mérite mensuel et tournois comptés (pipeline/merite_perso.py)
    const [MM, MT] = await Promise.all([sb.from("merite_mois").select("*").eq("user_id", user.id).order("mois"),
      sb.from("merite_tournois").select("*").eq("user_id", user.id).order("date")]);
    this.stats = { mois: MM.data || [], tournois: MT.data || [] };
    // coach / admin : ses joueurs (accès accepté) pour le sélecteur « Vue »
    this.joueurs = [];
    if (this.role !== "joueur") { const J = await sb.rpc("mes_joueurs"); this.joueurs = (J.data || []).filter((j) => j.statut === "accepte"); }
    let listes = L.data, items = {};
    for (const l of listes) items[l.id] = {};
    for (const r of I.data) (items[r.saison_id] ||= {})[r.tournoi_id] = { statut: r.statut, note: r.note, ajoute: r.ajoute_le };
    let dom = P.dom;
    const local = this.mode === "local" ? this : null;
    if (local && !listes.length && local.listes.some((l) => Object.keys(local.items[l.id] || {}).length)) {
      const map = {}, nl = local.listes.map((l) => ({ id: (map[l.id] = uuid()), nom: l.nom, annee: l.annee }));
      const lignes = local.listes.flatMap((l) => Object.entries(local.items[l.id] || {}).map(([tid, e]) =>
        ({ saison_id: map[l.id], tournoi_id: tid, statut: e.statut, note: e.note || "", ajoute_le: e.ajoute || AUJ })));
      const r1 = await sb.from("saisons").insert(nl); if (r1.error) throw r1.error;
      const r2 = lignes.length ? await sb.from("saison_tournois").insert(lignes) : {}; if (r2.error) throw r2.error;
      listes = nl; items = {};
      for (const l of nl) items[l.id] = {};
      for (const r of lignes) items[r.saison_id][r.tournoi_id] = { statut: r.statut, note: r.note, ajoute: r.ajoute_le };
      for (const an of Object.keys(local.actives)) if (map[local.actives[an]]) local.actives[an] = map[local.actives[an]];
      signaler(`Ta saison de ce navigateur a été recopiée dans ton compte (${lignes.length} tournoi${lignes.length > 1 ? "s" : ""}).`);
    }
    let fiche = P.fiche;
    if (!Object.keys(fiche).length && local && Object.keys(local.fiche || {}).length) {   // 1re connexion : fiche du navigateur
      fiche = local.fiche;
      this.base(sb.from("profils").update({ fiche }).eq("id", user.id), "profil");
    }
    if (!dom && local && local.dom) {
      dom = local.dom;
      this.base(sb.from("profils").update({ domicile_nom: dom.nom, lat: dom.lat, lon: dom.lon }).eq("id", user.id), "domicile");
    }
    Object.assign(this, { mode: "compte", user, listes, items, dom, fiche });
    // ce navigateur a servi un compte : on efface sa copie locale (elle réapparaîtrait, périmée, à la déconnexion)
    for (const k of ["gn-saison-v1", "gn-saison-v2", "gn-domicile", "gn-profil"]) { try { localStorage.removeItem(k); } catch { /* */ } }
    lsSet("gn-a-compte", "1");
  },
};
const STATUTS = [["envisage", "Envisagé"], ["inscrit", "Inscrit"], ["joue", "Joué"]];
const RANG = { envisage: 1, inscrit: 2, joue: 3 };
const LIB = Object.fromEntries(STATUTS);
const tournoiDe = (id) => etat.parId.get(id);
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// navigateur déjà utilisé avec un compte, mais déconnecté : la saison est dans le compte, pas ici
const horsCompte = () => Saison.mode === "local" && lsGet("gn-a-compte") === "1";
const nomListeDe = (t) => "Ma saison " + t.annee;

function etoile(id) {
  const e = Saison.get(id), t = tournoiDe(id), nom = t ? nomListeDe(t) : "ma saison";
  return `<button type="button" class="etoile${e ? " s-" + e.statut : ""}" data-id="${esc(id)}" aria-pressed="${!!e}"
    title="${esc(e ? `Dans « ${nom} » (${LIB[e.statut]}) · cliquer pour retirer` : `Ajouter à « ${nom} »`)}" aria-label="${e ? "Retirer de ma saison" : "Ajouter à ma saison"}">${e ? "★" : "☆"}</button>`;
}
const segStatut = (id, s) => `<div class="seg" role="group" aria-label="Statut">${STATUTS.map(([k, l]) =>
  `<button type="button" data-statut="${k}" data-id="${esc(id)}" aria-pressed="${s === k}">${l}</button>`).join("")}</div>`;

function blocSaisonFiche(t) {
  const e = Saison.get(t.id), nom = esc(nomListeDe(t));
  return `<div class="bloc ma-saison${e ? " s-" + e.statut : ""}" id="fiche-saison" data-id="${esc(t.id)}">${e
    ? `<div class="ms-ligne"><b>★ ${nom}</b>${segStatut(t.id, e.statut)}<button type="button" class="lien" data-retirer="${esc(t.id)}">Retirer</button></div>
       <input class="note" data-note="${esc(t.id)}" maxlength="200" placeholder="Note : covoiturage, hôtel, départ…" value="${esc(e.note)}" aria-label="Note">`
    : `<div class="ms-ligne"><button type="button" class="btn plein" data-ajouter="${esc(t.id)}">☆ Ajouter à « ${nom} »</button>
       <span class="doux">Il sera noté « Envisagé » ; tu changeras le statut (Inscrit, Joué) ensuite.</span></div>`}</div>`;
}

// Par défaut « Envisagé », même pour un tournoi passé : on peut construire une saison passée pour s'entraîner.
function ajouter(id) {
  if (horsCompte()) { signaler("Connecte-toi pour retrouver ta saison et y ajouter des tournois."); ecran("saison"); return; }
  Saison.set(id, { statut: "envisage" }); apres(id);
}
function retirer(id) {
  const e = Saison.get(id); if (!e) return;
  if ((e.statut !== "envisage" || e.note) && !confirm(`Retirer ce tournoi de ta saison ?${e.note ? "\nLa note sera perdue." : ""}`)) return;
  Saison.retirer(id); apres(id);
}
function basculerSaison(id) { if (Saison.get(id)) retirer(id); else ajouter(id); }

// après un changement : pastille de l'onglet, étoiles visibles, fiche ouverte, écran saison
function apres(id) {
  majBadgeSaison();
  for (const b of document.querySelectorAll(`.etoile[data-id="${CSS.escape(id)}"]`)) b.outerHTML = etoile(id);
  const f = $("fiche-saison"); const t = tournoiDe(id);
  if (f && f.dataset.id === id && t) f.outerHTML = blocSaisonFiche(t);
  if (etat.ecran === "saison") rendreSaison();
}
// tout redessiner (changement de liste active, connexion, déconnexion)
function toutRafraichir() {
  majBadgeSaison();
  for (const b of document.querySelectorAll(".etoile[data-id]")) b.outerHTML = etoile(b.dataset.id);
  const f = $("fiche-saison"); const t = f && tournoiDe(f.dataset.id);
  if (t) f.outerHTML = blocSaisonFiche(t);
    rendreCompte();
  if (etat.ecran === "saison") rendreSaison();
  if (etat.ecran === "profil") rendreProfil();
}
function majBadgeSaison() {
  setTimeout(() => rendreBienvenue(), 0);
  const an = new Date().getFullYear();
  const n = Saison.entrees(Saison.active(an)).length;
  const b = $("nb-saison"); b.hidden = !n; b.textContent = n;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ajouter],[data-retirer],[data-statut],[data-ouvrir]"); if (!b) return;
  if (b.dataset.ajouter) ajouter(b.dataset.ajouter);
  else if (b.dataset.retirer) retirer(b.dataset.retirer);
  else if (b.dataset.statut) { Saison.set(b.dataset.id, { statut: b.dataset.statut }); apres(b.dataset.id); }
  else if (b.dataset.ouvrir) { const t = tournoiDe(b.dataset.ouvrir); if (t) ouvrir(t); }
});
document.addEventListener("change", (e) => {
  const n = e.target.closest("[data-note]"); if (!n || !Saison.get(n.dataset.note)) return;
  Saison.set(n.dataset.note, { note: n.value.trim() });
  const autre = document.querySelectorAll(`[data-note="${CSS.escape(n.dataset.note)}"]`);
  for (const x of autre) if (x !== n) x.value = n.value;
});

// ---- listes : choix, création, renommage, suppression
$("s-annees").addEventListener("click", (e) => {
  const b = e.target.closest("[data-an]"); if (!b) return;
  etat.sAnnee = +b.dataset.an; toutRafraichir();
});
// ---- compte : connexion par lien e-mail, à ouvrir dans le navigateur qui a fait la demande (PKCE)
// compte (état du panneau), LIEN_REGLES : briques communes (../commun/v1/nexus.js).
// Compte en haut à droite, les onglets juste en dessous (choix utilisateur du 04/11, après l'essai « menu dans le nom »).
// Connecté : initiale + nom ▾ (adresse, se déconnecter) ; sinon « Se connecter » (formulaire). « Mon profil » : onglet visible connecté seulement.
function rendreCompte() {
  const b = $("b-compte"), pan = $("b-pan"), c = $("s-compte"), connecte = Saison.mode === "compte" && !!sb;
  $("v-profil").hidden = !connecte; $("v-stats").hidden = !connecte || coachSeul();
  if (connecte && coachSeul() && etat.ecran === "stats") setTimeout(() => ecran("saison"), 0);
  // Coach et Admin : module Club, ouvert par le lanceur (drapeau du bandeau)
  document.body.classList.toggle("lecture-seule", !!Saison.demo);   // vue coach : boutons de modification masqués
  if (!connecte && ["profil", "stats", "admin", "coach"].includes(etat.ecran)) ecran("tournois");
  pan.hidden = !compte.ouvert;
  rendreBienvenue();
  const vb = $("vue-bandeau");
  vb.hidden = !(connecte && Saison.demo?.coach);
  $("saison").hidden = !vb.hidden;   // dans l'en-tête, la ligne « vue joueur » remplace l'avancée de la saison
  if (!vb.hidden) vb.innerHTML = `<span>👁 <b>${esc(Saison.demo.nom || "Joueur")}</b> <small>lecture seule</small></span>
    <button type="button" data-vue-ecran="saison" aria-pressed="${etat.ecran === "saison"}">Saison</button>
    <button type="button" data-vue-ecran="stats" aria-pressed="${etat.ecran === "stats"}">Stats</button>
    <button type="button" data-vue-retour>← Mon compte</button>`;
  if (connecte && Saison.demo?.coach) {   // coach : vue d'un joueur, lecture seule
    $("v-profil").hidden = true;
    b.innerHTML = selecteurVue();   // « lecture seule » est dans la ligne jaune
    pan.hidden = true; c.hidden = true; c.innerHTML = "";
    return;
  }
  if (connecte && Saison.demo) {
    $("v-profil").hidden = true;
    b.innerHTML = `<span class="b-btn b-demo" title="Lien de démonstration : rien ne peut être modifié${/^\d{4}-/.test(String(Saison.demo.expire)) ? ` · expire le ${esc(fmtDate(String(Saison.demo.expire).slice(0, 10)))}` : ""}">👁 Démo · ${esc(Saison.demo.nom)} <small>lecture seule</small></span>`;
    pan.hidden = true; c.hidden = true; c.innerHTML = "";
    return;
  }
  if (connecte) {
    const mel = Saison.user.email || "", nom = (Saison.fiche && Saison.fiche.nom) || mel;
    b.innerHTML = selecteurVue() + `<button type="button" class="b-btn b-moi" id="c-ouvrir" aria-haspopup="menu" aria-expanded="${compte.ouvert}" aria-controls="b-pan" title="${esc(mel)}">
      <span class="b-init" aria-hidden="true">${esc((nom.trim()[0] || "?").toUpperCase())}</span><span class="b-qui">${esc(nom)}</span><span aria-hidden="true">▾</span></button>`;
    pan.innerHTML = nexusPanneauConnecte(mel);
    c.hidden = true; c.innerHTML = "";
    return;
  }
  b.innerHTML = sb ? `<button type="button" class="b-btn" id="c-ouvrir" aria-expanded="${compte.ouvert}" aria-controls="b-pan">Se connecter</button>` : "";
  pan.innerHTML = nexusPanneauConnexion();
  // « Ma saison » : pas de ligne de connexion (retour du 04/11) ; le message de la saison vide suffit
  c.hidden = true; c.innerHTML = "";
}
function ouvrirConnexion(ouvert = true) {
  compte.ouvert = ouvert; rendreCompte();
  if (ouvert) { window.scrollTo({ top: 0 }); setTimeout(() => $("c-email")?.focus(), 0); }
}
nexusBrancherPanneau(rendreCompte, Saison);   // formulaires du panneau du compte : briques communes
document.addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id || e.target.id;
  if (nexusClicPanneau(id, rendreCompte)) return;   // boutons du panneau du compte : briques communes
  const ec = e.target.closest("#b-pan [data-ecran]");
  if (ec) { compte.ouvert = false; if ($("fiche")) $("fiche").hidden = true; ecran(ec.dataset.ecran); rendreCompte(); return; }
  if (id === "c-ouvrir") { ouvrirConnexion(!compte.ouvert); return; }
  if (e.target.closest("[data-connexion]")) { if ($("fiche")) $("fiche").hidden = true; ouvrirConnexion(true); return; }
  if (compte.ouvert && !e.target.closest("#b-pan")) ouvrirConnexion(false);   // clic ailleurs : on referme
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && compte.ouvert) ouvrirConnexion(false); });
// Supabase émet plusieurs événements à la connexion (INITIAL_SESSION, SIGNED_IN…) : on les traite l'un
// après l'autre, sinon la recopie du navigateur vers le compte part plusieurs fois (bug du 04/11 : 4 doublons).
let fileSession = Promise.resolve();
function majSession(session) { return (fileSession = fileSession.then(() => majSession1(session), () => majSession1(session))); }
async function majSession1(session) {
  const u = session && session.user;
  if ((u && u.id) === (Saison.user && Saison.user.id)) return rendreCompte();
  if (u) {
    try { await Saison.connecter(u); compte.envoye = null; }
    catch (err) { signaler("Lecture du compte impossible : " + (err.message || err)); Saison.chargerLocal(); }
  } else Saison.chargerLocal();
  // la fiche du compte arrive après le premier affichage : on redessine carte et liste avec son critère distance
  const avant = JSON.stringify([etat.ref, $("f-rayon").value, $("f-circuit").value]);
  distanceDuProfil();
  if (JSON.stringify([etat.ref, $("f-rayon").value, $("f-circuit").value]) !== avant || $("f-place").checked) rendre();
  toutRafraichir();
  if (etat.veutVue && Saison.mode === "compte") { const v = etat.veutVue; etat.veutVue = null; await voirJoueur(v.id, v.cible); }
  if (etat.veutProfil) { const v = etat.veutProfil === "stats" ? "stats" : "profil"; etat.veutProfil = false; if (Saison.mode === "compte") ecran(v); }
}
function initCompte() {
  rendreCompte();
  if (!sb) return;
  const q0 = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  const venuDuLien = q0.has("code");
  if (q0.get("error_description")) {   // lien expiré ou déjà utilisé : Supabase revient avec ?error=…
    signaler("Lien de connexion expiré ou déjà utilisé : redemande un lien depuis « Ma saison ».");
    const q = new URLSearchParams(location.search); for (const k of ["error", "error_code", "error_description"]) q.delete(k);
    const h = new URLSearchParams(location.hash.slice(1)); for (const k of ["error", "error_code", "error_description"]) h.delete(k);
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + (h.toString() ? "#" + h : ""));
  }
  sb.auth.onAuthStateChange((ev, session) => setTimeout(async () => {   // pas d'appel Supabase dans le rappel lui-même
    // arrivé par un lien (invitation, lien de connexion) : l'assistant demandera un mot de passe
    if ((venuDuLien || nexus.invite) && session && ev === "INITIAL_SESSION") nexus.demandeMdp = true;
    await majSession(session);
    if (session && Saison.mode === "compte" && !Saison.demo) ouvrirAssistant();
    if (venuDuLien) { const q = new URLSearchParams(location.search); q.delete("code");
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
  }, 0));
}

// ---- navigation entre écrans
function ecran(nom) {
  if (nom === "coach" || nom === "admin") { location.href = "../club/#" + nom; return; }   // module Club
  etat.ecran = nom;
  $("ecran-tournois").hidden = nom !== "tournois";
  $("ecran-saison").hidden = nom !== "saison";
  $("ecran-profil").hidden = nom !== "profil";
  $("ecran-stats").hidden = nom !== "stats";
  for (const b of document.querySelectorAll(".vues button"))
    if (b.dataset.ecran === nom) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  const h = new URLSearchParams(location.hash.slice(1));
  if (["saison", "profil", "stats"].includes(nom)) h.set("v", nom); else h.delete("v");
  history.replaceState(null, "", location.pathname + location.search + (h.toString() ? "#" + h : ""));
  rendreCompte();
  if (nom === "saison") rendreSaison();
  else if (nom === "profil") rendreProfil();
  else if (nom === "stats") rendreStats();
  else { rendre(); setTimeout(() => carte && carte.invalidateSize(), 0); }
  window.scrollTo({ top: 0 });
}
document.querySelector(".vues").addEventListener("click", (e) => { const b = e.target.closest("[data-ecran]"); if (b) ecran(b.dataset.ecran); });
$("s-parcourir").addEventListener("click", () => ecran("tournois"));
$("s-dom").value = Saison.domicile()?.nom || "";
$("s-dom-f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("s-dom").value.trim();
  if (!q) { Saison.setDomicile(null); rendreSaison(); return; }
  try {
    const r = await fetch("https://api-adresse.data.gouv.fr/search/?limit=1&q=" + encodeURIComponent(q)).then((r) => r.json());
    const f = r.features && r.features[0];
    if (!f) { $("s-dom").setCustomValidity("Adresse introuvable"); $("s-dom").reportValidity(); return; }
    const [lon, lat] = f.geometry.coordinates;
    Saison.setDomicile({ lat, lon, nom: f.properties.label });
    $("s-dom").value = f.properties.label;
    rendreSaison();
  } catch { $("s-dom").setCustomValidity("Recherche impossible (hors ligne ?)"); $("s-dom").reportValidity(); }
});
$("s-dom").addEventListener("input", () => $("s-dom").setCustomValidity(""));

// ---- rendu de l'écran
function rendreSaison() {
  const an0 = new Date().getFullYear();
  // toutes les années connues : on peut construire une saison passée (pour s'entraîner) ou la suivante
  const annees = [...new Set([an0, ...etat.tournois.map((t) => t.annee), ...Saison.listes.map((l) => l.annee)])].filter(Boolean).sort();
  const an = etat.sAnnee ||= an0;
  $("s-annees").innerHTML = annees.map((a) => `<button type="button" data-an="${a}" aria-pressed="${a === an}">${a}</button>`).join("");
  const lid = Saison.active(an);
  const liste = Saison.entrees(lid).sort((a, b) => a.t.debut.localeCompare(b.t.debut));

  // chiffres
  const n = (s) => liste.filter((x) => x.e.statut === s).length;
  const semaines = new Set(liste.map((x) => semaine(x.t.debut)[0]));
  const prochain = liste.find((x) => x.t.fin >= AUJ);
  const dom = Saison.domicile();
  const dist = (t) => { const p = posDe(t); return dom && p ? km(dom, p) : null; };
  const kmAR = dom ? liste.reduce((a, x) => a + 2 * (dist(x.t) || 0), 0) : null;
  $("s-chiffres").innerHTML = [
    [n("envisage"), "envisagés", "envisage"], [n("inscrit"), "inscrits", "inscrit"], [n("joue"), "joués", "joue"],
    [semaines.size, semaines.size > 1 ? "semaines occupées" : "semaine occupée"],
    ...(dom ? [[Math.round(kmAR).toLocaleString("fr-FR") + " km", "aller-retour depuis chez toi", "", "Somme des allers-retours domicile → golf, à vol d'oiseau (la route est plus longue)"]] : []),
    [prochain ? fmtDate(prochain.t.debut) : "—", prochain ? "prochain : " + titre(prochain.t.nom) : "aucun tournoi à venir"],
  ].map(([v, l, s, info]) => `<div class="s-chiffre"${info ? ` title="${esc(info)}"` : ""}>${s ? `<i class="puce-statut s-${s}"></i>` : ""}<b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

  $("s-alertes").innerHTML = alertes(liste).map(([niveau, html]) => `<div class="s-alerte ${niveau}">${html}</div>`).join("");
  $("s-legende").innerHTML = STATUTS.map(([k, l]) => `<span><i class="puce-statut s-${k}"></i>${l}</span>`).join("") +
    `<span><i class="puce-statut conflit"></i>chevauchement</span>`;
  $("s-cal").innerHTML = calendrier(an, liste);
  $("s-ics").disabled = !liste.some((x) => x.e.statut === "inscrit");
  carteSaison(liste);

  if (!liste.length && horsCompte()) {
    $("s-liste").innerHTML = `<div class="s-vide"><p><b>Connecte-toi pour retrouver ta saison.</b></p>
      <p><button type="button" class="lien" data-connexion>Se connecter</button> en haut à droite, avec ton e-mail et ton mot de passe.</p></div>`;
    return;
  }
  if (!liste.length) {
    $("s-liste").innerHTML = `<div class="s-vide"><p><b>Ta saison ${an} est vide.</b></p>
      <p>Dans l'écran Tournois, choisis l'année ${an}, puis clique sur l'étoile ☆ d'un tournoi (dans la liste ou sa fiche) pour l'ajouter ici.</p>
      <button type="button" class="btn plein" data-ecran-go>Parcourir les tournois</button></div>`;
    $("s-liste").querySelector("[data-ecran-go]").addEventListener("click", () => ecran("tournois"));
    return;
  }
  let mois = -1, html = "";
  for (const { t, e } of liste) {
    const m = +t.debut.slice(5, 7) - 1;
    if (m !== mois) { if (mois >= 0) html += "</ol>"; html += `<h4 class="s-mois">${MOIS[m]}</h4><ol class="s-items">`; mois = m; }
    const g = golfDe(t) || {};
    const clos = t.cloture && t.cloture < AUJ && t.fin >= AUJ;
    html += `<li class="s-item s-${e.statut}${t.fin < AUJ ? " passe" : ""}">
      <div class="date"><b>${new Date(t.debut + "T12:00").getDate()}</b><span>${MOIS_COURT[m]}</span></div>
      <div class="s-info">
        <button type="button" class="s-nom" data-ouvrir="${esc(t.id)}">${esc(titre(t.nom))}</button>
        <div class="meta">${fmtDate(t.debut)} → ${fmtDate(t.fin)} · ${esc(titre(g.nom || t.golf_nom))} · ${esc(t.departement || titre(t.ville))}${dist(t) != null ? ` · <b>${Math.round(dist(t))} km</b> de chez toi` : ""}</div>
        <div class="meta"><span class="tag circuit c-${circuitDe(t)}">${esc(circuitLib(t))}</span> ${t.nb_tours} tours${t.index_max_h ? ` · idx H ≤ ${t.index_max_h}` : ""}${t.index_max_d ? ` · idx D ≤ ${t.index_max_d}` : ""}${
          t.cloture && t.fin >= AUJ ? ` · inscriptions ${clos ? "closes" : "jusqu'au " + fmtDate(t.cloture)}` : ""}</div>
        ${blocObtenu(t)}
        <div class="s-ctrl">${segStatut(t.id, e.statut)}<button type="button" class="lien" data-retirer="${esc(t.id)}">Retirer</button></div>
        <input class="note" data-note="${esc(t.id)}" maxlength="200" placeholder="Note…" value="${esc(e.note)}" aria-label="Note">
      </div></li>`;
  }
  $("s-liste").innerHTML = html + "</ol>";
}

// place obtenue (collecte du lundi, ligne du joueur seulement) comparée à l'estimation
function blocObtenu(t) {
  const r = (Saison.resultats || {})[t.id], m = !r && meriteDe(t), est = estimePlace(t);
  const estTxt = est && est.place ? `estimée : ${est.place}ᵉ${est.n ? ` sur ~${est.n}` : ""}` : "";
  if (!r && !m) {
    if (!estTxt) return t.fin < AUJ && Saison.licence?.num ? `<div class="meta obtenu attente">Place obtenue : relevée le lundi suivant le tournoi</div>` : "";
    return `<div class="meta obtenu attente">Place ${estTxt}${t.fin < AUJ ? " · résultat relevé le lundi suivant" : ""}</div>`;
  }
  const place = r ? r.place : m.place, tours = r ? r.tours : m.tours, num = placeNum(place);
  const ecart = num && est?.place ? num - est.place : null;
  // cut ou abandon (« 60 · cut ») : le rang porte sur tout le champ, pas sur les classés
  const horsClass = /cut|abandon|non class/i.test(String(place)), rangChamp = horsClass ? String(place).match(/^(\d+)/)?.[1] : null;
  const libPlace = horsClass ? `${/abandon/i.test(place) ? "Abandon" : /cut/i.test(place) ? "Cut" : "Non classé"}${rangChamp ? ` (${rangChamp}ᵉ sur ${r?.inscrits || "l'ensemble du"} champ)` : ""}`
    : `${esc(String(place).replace(/^(\d+)/, "$1ᵉ").replace(/ème|er/, ""))}${r?.classes ? ` / ${r.classes} classés` : ""}`;
  return `<div class="meta obtenu"><b>Place obtenue : ${libPlace}</b>`
    + (tours?.length ? ` · ${tours.join("-")}${r?.par != null ? ` (${r.par > 0 ? "+" : ""}${r.par})` : m?.moy_sss != null ? ` (${sg(m.moy_sss, 1)} vs SSS)` : ""}` : "")
    + (estTxt ? ` · ${estTxt}${ecart ? ` <span class="${ecart < 0 ? "mieux" : "moins"}">(${ecart < 0 ? ecart : "+" + ecart})</span>` : ""}` : "")
    + (m ? ` <span class="meta" title="Résultats détaillés absents chez ffgolf : place lue dans ta fiche Mérite">· d'après le Mérite</span>` : "") + "</div>";
}
// tournoi de la saison retrouvé dans la fiche Mérite (dates du tournoi + un mot du nom en commun)
const MOTS_VIDES = new Set(["grand", "prix", "trophee", "messieurs", "dames", "golf", "club", "coupe", "jeunes", "seniors", "amateurs", "edition"]);
function meriteDe(t) {
  const L = Saison.stats?.tournois; if (!L?.length || t.fin >= AUJ) return null;
  const mots = plier(t.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !MOTS_VIDES.has(w));
  return L.find((m) => m.date >= t.debut && m.date <= t.fin && mots.some((w) => plier(m.nom).includes(w))) || null;
}

// l'inverse : ligne du Mérite → tournoi du calendrier collecté (même règle : date dans le tournoi + un mot du nom)
function tournoiDuMerite(m) {
  const mots = plier(m.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !MOTS_VIDES.has(w));
  return etat.tournois.find((x) => m.date >= x.debut && m.date <= x.fin && mots.some((w) => plier(x.nom).includes(w))) || null;
}

// carte de la saison : pastilles numérotées dans l'ordre, couleur du statut
let sCarte, sCouche;
const enMetropole = (p) => p.lat > 41 && p.lat < 51.5 && p.lon > -5.5 && p.lon < 10;
function carteSaison(liste) {
  if (!sCarte) {
    sCarte = L.map("s-carte", { zoomSnap: 0.5, scrollWheelZoom: false }).setView([46.6, 2.4], 5);
    fond(sCarte);
    sCouche = L.layerGroup().addTo(sCarte);
  }
  sCarte.invalidateSize();
  sCouche.clearLayers();
  const etapes = liste.map((x, i) => ({ ...x, n: i + 1, p: posDe(x.t) })).filter((x) => x.p);
  // plusieurs tournois sur le même golf : une seule pastille « 2 · 5 »
  const parGolf = new Map();
  for (const x of etapes) (parGolf.get(x.t.golf) || parGolf.set(x.t.golf, []).get(x.t.golf)).push(x);
  for (const l of parGolf.values()) {
    const s = l.reduce((a, x) => (RANG[x.e.statut] > RANG[a] ? x.e.statut : a), "envisage");
    const txt = l.map((x) => x.n).join(" · "), w = Math.max(26, 12 + txt.length * 7);
    L.marker([l[0].p.lat, l[0].p.lon], {
      icon: L.divIcon({ className: "", html: `<div class="s-pin s-${s}${l.every((x) => x.t.fin < AUJ) ? " passe" : ""}" style="min-width:${w}px">${txt}</div>`, iconSize: [w, 26], iconAnchor: [w / 2, 13] }),
      keyboard: true, title: l.map((x) => titre(x.t.nom)).join(" / "),
    }).bindTooltip(l.map((x) => `<b>${x.n}. ${esc(titre(x.t.nom))}</b><br>${fmtDate(x.t.debut)} → ${fmtDate(x.t.fin)} · ${LIB[x.e.statut]}`).join("<hr>") +
      `<br>${esc(titre((golfDe(l[0].t) || {}).nom || l[0].t.golf_nom))}`)
      .on("click", () => ouvrir(l[0].t)).addTo(sCouche);
  }
  const dom = Saison.domicile();
  if (dom) L.marker([dom.lat, dom.lon], { icon: L.divIcon({ className: "", html: `<div class="s-maison" aria-hidden="true">⌂</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: -100 })
    .bindTooltip(`<b>Domicile</b><br>${esc(dom.nom)}`).addTo(sCouche);
  // cadrage sur la métropole (l'outre-mer reste visible en dézoomant), domicile compris
  const metro = etapes.filter((x) => enMetropole(x.p));
  const cadre = (metro.length ? metro : etapes).map((x) => [x.p.lat, x.p.lon]);
  if (dom && (cadre.length === 0 || enMetropole(dom))) cadre.push([dom.lat, dom.lon]);
  if (cadre.length > 1) sCarte.fitBounds(cadre, { padding: [30, 30], maxZoom: 9 });
  else if (cadre.length === 1) sCarte.setView(cadre[0], 8);
  else sCarte.setView([46.6, 2.4], 5);
}

function alertes(liste) {
  const a = [];
  // chevauchements (deux tournois de la saison aux dates communes)
  for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
    const x = liste[i].t, y = liste[j].t;
    if (x.debut <= y.fin && y.debut <= x.fin)
      a.push(["rouge", `<b>Chevauchement</b> : ${lienT(x)} et ${lienT(y)} ont des dates communes (${fmtDate(y.debut > x.debut ? y.debut : x.debut)}).`]);
  }
  for (const { t, e } of liste) {
    if (t.fin < AUJ || e.statut !== "envisage" || !t.cloture) continue;
    const j = Math.round((new Date(t.cloture + "T12:00") - new Date(AUJ + "T12:00")) / 864e5);
    if (j < 0) a.push(["gris", `<b>Inscriptions closes</b> depuis le ${fmtDate(t.cloture)} pour ${lienT(t)} (encore « Envisagé »).`]);
    else if (j <= 7) a.push(["jaune", `<b>Clôture ${j === 0 ? "aujourd'hui" : j === 1 ? "demain" : "dans " + j + " jours"}</b> (${fmtDate(t.cloture)}) pour ${lienT(t)} : pense à t'inscrire.`]);
  }
  const aJouer = liste.filter((x) => x.t.fin < AUJ && x.e.statut === "inscrit");
  if (aJouer.length) a.push(["vert", `<b>${aJouer.length} tournoi${aJouer.length > 1 ? "s" : ""} passé${aJouer.length > 1 ? "s" : ""}</b> encore « Inscrit » : ${aJouer.map((x) => lienT(x.t)).join(", ")}. Passe-les en « Joué ».`]);
  return a;
}
const lienT = (t) => `<button type="button" class="lien" data-ouvrir="${esc(t.id)}">${esc(titre(t.nom))}</button>`;

function calendrier(an, liste) {
  const jours = {};
  for (const x of liste) for (let d = new Date(x.t.debut + "T12:00"); isoLocal(d) <= x.t.fin; d.setDate(d.getDate() + 1)) (jours[isoLocal(d)] ||= []).push(x);
  let html = "";
  for (let m = 0; m < 12; m++) {
    const dec = (new Date(an, m, 1, 12).getDay() + 6) % 7, nbj = new Date(an, m + 1, 0).getDate();
    let c = `<span class="rien"></span>`.repeat(dec);
    for (let j = 1; j <= nbj; j++) {
      const d = `${an}-${pad(m + 1)}-${pad(j)}`, l = jours[d], we = (dec + j - 1) % 7 >= 5;
      const cls = ["j", we && "we", d === AUJ && "auj"].filter(Boolean);
      if (l) {
        const s = l.reduce((a, x) => (RANG[x.e.statut] > RANG[a] ? x.e.statut : a), "envisage");
        cls.push("pris", "s-" + s); if (l.length > 1) cls.push("conflit");
        c += `<button type="button" class="${cls.join(" ")}" data-ouvrir="${esc(l[0].t.id)}" title="${esc(l.map((x) => titre(x.t.nom) + " (" + LIB[x.e.statut] + ")").join("\n"))}">${j}</button>`;
      } else c += `<span class="${cls.join(" ")}">${j}</span>`;
    }
    html += `<div class="s-m"><h4>${MOIS[m]}</h4><div class="s-jours"><b>L</b><b>M</b><b>M</b><b>J</b><b>V</b><b>S</b><b>D</b>${c}</div></div>`;
  }
  return html;
}

// ---- export agenda (.ics) : tournois « inscrit » de l'année affichée
$("s-ics").addEventListener("click", () => {
  const an = etat.sAnnee;
  const liste = Saison.entrees(Saison.active(an)).filter((x) => x.e.statut === "inscrit");
  const txt = (s) => String(s || "").replace(/[\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const jour = (d) => d.replace(/-/g, "");
  const lendemain = (d) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + 1); return isoLocal(x).replace(/-/g, ""); };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = liste.map(({ t, e }) => { const g = golfDe(t) || {}; return [
    "BEGIN:VEVENT", `UID:${t.id}@golfnexus`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${jour(t.debut)}`, `DTEND;VALUE=DATE:${lendemain(t.fin)}`,
    `SUMMARY:${txt(titre(t.nom))}`, `LOCATION:${txt([titre(g.nom || t.golf_nom), g.adresse, titre(t.ville)].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${txt([t.nb_tours + " tours", e.note, t.url].filter(Boolean).join("\n"))}`, "END:VEVENT"].join("\r\n"); });
  const plier = (l) => l.match(/.{1,72}/gu).join("\r\n ");   // lignes ≤ 75 octets (RFC 5545)
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GolfNexus//Ma saison//FR", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"]
    .join("\r\n").split("\r\n").map(plier).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `golfnexus-saison-${an}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});


// ------------------------------------------------------------------ fiche joueur (« Mon profil »)
// Catégorie d'âge ffgolf par millésime (Vademecum 2026 § 1.5.5) ; Mid-Am / Seniors : âge réel (approximé ici par l'année).
function categorieAge(naissance, an = new Date().getFullYear()) {
  if (!naissance) return "";
  const a = an - naissance;
  if (a <= 8) return "Enfant (U10)";
  if (a <= 10) return `Poucet ${a - 8} (U12)`;
  if (a <= 12) return `Poussin ${a - 10} (U12)`;
  if (a <= 14) return `Benjamin ${a - 12} (U14)`;
  if (a <= 16) return `Minime ${a - 14} (U16)`;
  if (a <= 18) return `Cadet ${a - 16} (U18)`;
  if (a <= 21) return "Adulte (U21)";
  if (a <= 24) return "Adulte";
  if (a < 40) return "Mid-Amateur (25 ans et +)";
  if (a < 50) return "Mid-Amateur 2 (40 ans et +)";
  if (a < 60) return "Senior (50 ans et +)";
  if (a < 70) return "Senior 2 (60 ans et +)";
  return "Senior 3 (70 ans et +)";
}
const nombre = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
const signe = (x) => (x == null ? "—" : (x > 0 ? "+" : "") + x.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));

// ---- Mérite National Amateur (pages publiques ffgolf, lisibles depuis le navigateur : CORS « * »)
// Liste du mois : JSON (nom, prénom, rang, catégorie, moyennes vs SSS, CODE = identifiant de la fiche, brouillé à
// chaque appel mais toujours valable). On demande le mois courant : la ffgolf renvoie le dernier Mérite publié.
const FFG = "https://pages.ffgolf.org/merite";
const moisCourant = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}`; };
const meriteListes = {};   // cache de la session : la liste n'est ni stockée ni envoyée ailleurs
async function meriteListe(sexe, liste = "amateurs") {
  const s = sexe === "D" ? "dames" : "messieurs", k = liste + "/" + s;
  return meriteListes[k] ||= fetch(`${FFG}/datas/${liste}/${s}/${moisCourant()}`).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
  }).catch((e) => { delete meriteListes[k]; throw e; });
}
// fiche détaillée d'un joueur (fragment HTML) → valeurs utiles
async function meriteFiche(code) {
  const r = await fetch(`${FFG}/merite_details/${moisCourant()}/amateurs?h=${encodeURIComponent(code)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  const tete = doc.querySelector("#mer_det_head"); if (!tete) throw new Error("fiche introuvable");
  // une case = « Libellé: <span class="refs">valeur</span> » (on ne lit que les cases, pas les rangées)
  const cases = {};
  for (const d of tete.querySelectorAll("div")) {
    if (d.querySelector("div")) continue;
    const t = d.textContent.replace(/\s+/g, " ").trim(), i = t.indexOf(":");
    if (i > 0) cases[t.slice(0, i + 1)] = (d.querySelector(".refs")?.textContent || t.slice(i + 1)).replace(/\s+/g, " ").trim();
  }
  const champ = (lib) => cases[lib] || null;
  const td = [...(doc.querySelector("table tbody tr") || { children: [] }).children].map((x) => x.textContent.trim());
  return { place: parseInt(champ("Place actuelle:")) || null, categorie: champ("Catégorie:"), index: nombre(champ("Index:")), statut: champ("Statut:"),
    golf: champ("Golf:"), placePrec: parseInt(champ("Place mois précédent:")) || null, meilleure: parseInt(champ("Meilleure place:")) || null,
    victoires: parseInt(champ("Victoire:")) || 0, moy: nombre(td[0]), moy6: nombre(td[1]), nb: parseInt(td[2]) || null, marques: parseInt(td[3]) || null, divisor: parseInt(td[4]) || null };
}
async function majMerite(code, base = {}) {
  const f = await meriteFiche(code);
  let periode = "";
  try { const L = await meriteListe(Saison.fiche.sexe || "H"); periode = L.ma_title || ""; } catch { /* sans titre */ }
  const merite = { code, ...base, ...f, periode, lu: AUJ };
  Saison.setFiche({ merite, index: f.index ?? Saison.fiche.index });   // moyennes : par Mérite, dans merite (plus dans la fiche)
}

const rech2 = { resultats: null, en_cours: false, erreur: "" };
function rendreRappels() {
  const r = (Saison.fiche || {}).rappels || {}, actif = !!r.actif, jours = r.jours || [7, 1];
  $("p-rappels-bloc").hidden = Saison.mode !== "compte" || !!Saison.demo;
  $("p-rappels").checked = actif;
  $("p-rappels-jours").classList.toggle("eteint", !actif);
  for (const c of document.querySelectorAll("[data-rappel]")) { c.checked = jours.includes(+c.dataset.rappel); c.disabled = !actif; }
}
$("p-rappels-bloc").addEventListener("change", () => {
  const jours = [...document.querySelectorAll("[data-rappel]:checked")].map((c) => +c.dataset.rappel);
  const actif = $("p-rappels").checked;
  Saison.setFiche({ rappels: { actif, jours: jours.length ? jours : [7, 1] } });
  rendreRappels();
  signaler(actif ? `Rappels activés : ${(jours.length ? jours : [7, 1]).map((j) => (j === 1 ? "la veille" : j + " jours avant")).join(", ")} la clôture.` : "Rappels désactivés.");
});
function rendreProfil() {
  rendreAcces(); rendreRappels();
  const f = Saison.fiche, m = f.merite;
  { // coach qui ne joue pas : seulement nom, club, domicile
    const seul = coachSeul();
    $("p-merite-bloc").hidden = seul;
    $("p-titre").textContent = seul ? "Mon profil (coach)" : "Mon profil";
  }
  const an = new Date().getFullYear();
  // une carte : nom et club, puis une section par Mérite où il figure (Jeunes, Adultes, Mid-Am, Seniors), d'après
  // le relevé du robot ; compte tout neuf (pas encore relevé) : les valeurs Adultes lues au choix de la fiche
  const secs = Object.keys(LISTES_M).map((l) => ({ l, d: dernierMerite(l) })).filter((x) => x.d);
  if (!secs.length && m) secs.push({ l: "amateurs", d: { place: m.place, place_prec: m.placePrec, meilleure: m.meilleure, moy: m.moy, moy6: m.moy6, nb: m.nb, divisor: m.divisor,
    index_golf: m.index, statut: m.statut, categorie: m.categorie, lu_le: m.lu } });
  const comm = secs.map((x) => x.d).find((d) => d.categorie || d.statut) || {}, lu = secs.map((x) => x.d.lu_le).filter(Boolean).sort().at(-1);
  const idx = secs.map((x) => x.d.index_golf).find((x) => x != null);
  $("p-merite").innerHTML = m ? `
    <div class="p-carte">
      <div class="p-nom"><b>${esc(m.prenom || "")} ${esc(m.nom || "")}</b><span>${esc(titre(m.golf || ""))}</span></div>
      <div class="meta">${esc(comm.categorie || m.categorie || "")} · ${esc(comm.statut || m.statut || "")} · index <b>${idx != null ? (+idx).toLocaleString("fr-FR") : "—"}</b></div>
      <div class="defile"><table class="p-merites">
        <thead><tr><th>Mérite</th><th>Place</th><th><span class="long">Moyenne vs SSS</span><span class="court">Moy. SSS</span><small>12 mois</small></th><th><span class="long">Moyenne vs SSS</span><span class="court">Moy. SSS</span><small>6 mois</small></th><th><span class="long">Tournois</span><span class="court">Tourn.</span><small>/ diviseur</small></th></tr></thead>
        <tbody>${secs.map(({ l, d }) => { const dl = d.place && d.place_prec ? d.place_prec - d.place : 0;
          return `<tr><th scope="row">${LISTES_M[l]}${d.mois ? `<small>${moisLib(d.mois)}</small>` : ""}</th>
          <td><b>${d.place != null ? `${d.place}<sup>e</sup>` : "NC"}</b>${dl ? `<span class="${dl > 0 ? "mieux" : "moins"}">${dl > 0 ? "▲" : "▼"} ${Math.abs(dl)}</span>` : ""}
            <small>${d.place == null ? "non classé" : d.meilleure ? `meilleure : ${d.meilleure}<sup>e</sup>` : ""}</small></td>
          <td><b>${signe(d.moy == null ? null : +d.moy)}</b></td><td><b>${signe(d.moy6 == null ? null : +d.moy6)}</b></td>
          <td><b>${d.nb ?? "—"}</b> / ${d.divisor ?? "—"}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="meta p-merite-pied">Relevé ${lu ? `le ${fmtDate(String(lu).slice(0, 10))}` : "pas encore fait"} · mis à jour le lendemain de chaque parution du Mérite
        ${Saison.demo ? "" : `· <button type="button" class="lien" id="p-releve">Mettre à jour maintenant</button>`}
        ${Saison.licence?.verif === "ok" ? `· <span title="Licence reconnue dans les résultats : joueur verrouillé">🔒 joueur vérifié par la licence</span>` : `· <button type="button" class="lien" id="p-oublier">Ce n'est pas moi</button>`}</div>
    </div>` : `
    <p>Retrouve ta fiche du <b>Mérite National Amateur</b> : GolfNexus y lira ton index et ta <b>moyenne par rapport au SSS</b>, et les relira chaque mois.</p>
    <form id="p-cherche-f" class="c-form">
      <select id="p-cherche-sexe" aria-label="Classement"><option value="H">Messieurs</option><option value="D" ${f.sexe === "D" ? "selected" : ""}>Dames</option></select>
      <input id="p-cherche" type="search" placeholder="Ton nom (et prénom)" aria-label="Nom à chercher" required minlength="2" autocomplete="family-name">
      <button type="submit" class="btn plein">Me trouver</button>
    </form>
    <div id="p-resultats" class="p-resultats">${rech2.en_cours ? "<p>Lecture du Mérite (≈ 2,5 Mo)…</p>" : rech2.erreur ? `<p>${esc(rech2.erreur)}</p>` :
      rech2.resultats ? (rech2.resultats.length ? rech2.resultats.map((x, i) => `<button type="button" class="p-res" data-i="${i}">
        <b>${esc(x.NOM)} ${esc(x.PRENOM)}</b><span>${esc(x.CATEGORIE || "")} · ${esc(titre(x.GOLF || ""))} · ${/^\d+$/.test(String(x.RANK)) ? x.RANK + "e" : "non classé"} · moyenne ${signe(nombre(x.MOY_SSS))}</span></button>`).join("")
        : "<p>Personne de ce nom au Mérite de ce mois. Seuls les joueurs qui ont joué des tournois comptés au Mérite y figurent.</p>") : ""}</div>`;
  // champs saisis
  const v = (id, x) => { const el = $(id); if (document.activeElement !== el) el.value = x ?? ""; };
  v("p-nom", f.nom); v("p-club", f.club); v("p-sexe", f.sexe); v("p-naissance", f.naissance); v("p-index", f.index == null ? "" : String(f.index).replace(".", ","));
  v("p-dist", f.distMax);
  { // licence : compte seulement ; fixée à l'invitation (ou saisie une seule fois pour un compte ancien), puis non
    // modifiable par le joueur — seul l'administrateur la corrige (imposé par la base, 06/11)
    const lic = Saison.licence || {}, compteOk = Saison.mode === "compte";
    $("p-licence-lib").hidden = !compteOk;
    if (compteOk) {
      v("p-licence", lic.num);
      const bloque = !!lic.num;
      $("p-licence").disabled = bloque;
      $("p-licence-aide").textContent = !lic.num ? "sur ta carte ou l'appli ffgolf · sert à retrouver tes places obtenues (chaque lundi)"
        : (lic.verif === "ok" ? "✓ reconnue dans tes résultats" : lic.verif === "nom_different" ? "⚠ ne correspond pas à ta fiche Mérite"
          : lic.verif === "introuvable" ? "pas encore trouvée dans tes résultats" : "vérifiée au prochain relevé (lundi)")
          + " · correction : administrateur";
    }
  }
  $("p-dist-auto").checked = f.distAuto !== false;
  for (const o of $("p-circuit").options) o.disabled = !circuitOk(o.value, f.naissance);
  v("p-circuit", circuitOk(f.circuit, f.naissance) ? (f.circuit ?? "gp") : "gp");
  { const c = suggestionCircuit(f.naissance); $("p-circuit-aide").textContent = "appliqué à la carte et à la liste à chaque ouverture" +
      (c && c !== (f.circuit ?? "gp") ? ` · d'après ton âge : ${CIRCUITS[c]}` : ""); }
  // domicile par code postal (plusieurs communes possibles pour un même code)
  v("p-cp", f.cp);
  const dom = Saison.domicile(), L = f.cp && communesCP[f.cp], sel = $("p-commune");
  if (f.cp && !L) communesDe(f.cp).then(rendreProfil, () => {});
  sel.hidden = !(L && L.length > 1);
  if (L && L.length > 1) sel.innerHTML = L.map((c, i) => `<option value="${i}" ${dom && dom.nom === domNom(c, f.cp) ? "selected" : ""}>${esc(c.nom)}</option>`).join("");
  $("p-cp-aide").textContent = L && !L.length ? "Code postal inconnu." : dom ? "Domicile : " + dom.nom : "Sert à calculer les distances jusqu'aux golfs.";
  $("p-categorie").textContent = f.naissance ? `${categorieAge(f.naissance, an)} en ${an}` : "";
  // donnée renvoyée par la ffgolf (fiche Mérite, relue chaque jour) : affichée, non modifiable ; saisie à la main seulement sans elle
  // index : donnée ffgolf (fiche Mérite) → affichée, non modifiable ; saisie à la main seulement sans elle.
  // Plus de moyenne vs SSS dans la fiche (06/11) : elle dépend du circuit → une par Mérite, dans la carte ci-dessus
  const idxFfg = [...Object.keys(LISTES_M).map((l) => dernierMerite(l)?.index_golf), m?.index].find((x) => x != null);
  $("p-index").disabled = idxFfg != null;
  if (idxFfg != null) v("p-index", String(idxFfg).replace(".", ","));
  $("p-index-aide").textContent = idxFfg != null ? "donnée ffgolf, mise à jour automatiquement" : "";
}
$("ecran-profil").addEventListener("submit", async (e) => {
  if (e.target.id !== "p-cherche-f") return;
  e.preventDefault();
  const sexe = $("p-cherche-sexe").value;
  const mots = plier($("p-cherche").value).split(" ").filter(Boolean);
  Object.assign(rech2, { en_cours: true, erreur: "", resultats: null }); rendreProfil();
  try {
    const L = await meriteListe(sexe);
    rech2.resultats = (L.datas || []).filter((x) => { const n = plier(x.NOM + " " + x.PRENOM); return mots.every((w) => n.includes(w)); }).slice(0, 25);
    rech2.sexe = sexe;
  } catch (err) { rech2.erreur = "Impossible de lire le Mérite ffgolf pour le moment (" + (err.message || err) + ")."; }
  rech2.en_cours = false; rendreProfil();
});
$("ecran-profil").addEventListener("click", async (e) => {
  const b = e.target.closest(".p-res");
  if (b) {
    const x = rech2.resultats[+b.dataset.i];
    b.disabled = true;
    try {
      Saison.setFiche({ sexe: rech2.sexe, nom: Saison.fiche.nom || titre(`${x.PRENOM} ${x.NOM}`), club: Saison.fiche.club || titre(x.GOLF || "") });
      await majMerite(x.CODE, { nom: x.NOM, prenom: x.PRENOM });
      rech2.resultats = null; signaler("Fiche Mérite reliée : tes autres Mérites (Jeunes, Mid-Am, Seniors) arrivent avec le relevé.");
      lancerReleve(true);   // historique Mérite et places obtenues sans attendre lundi
    } catch (err) { signaler("Lecture de la fiche impossible : " + (err.message || err)); }
    rendreProfil(); return;
  }
  if (e.target.id === "p-releve") lancerReleve();
  if (e.target.id === "p-oublier") { Saison.setFiche({ merite: null }); rendreProfil(); }
});
// communes d'un code postal (geo.api.gouv.fr, CORS ouvert) ; cache de la session
const communesCP = {};
async function communesDe(cp) {
  if (communesCP[cp]) return communesCP[cp];
  const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,centre`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (communesCP[cp] = (await r.json()).filter((c) => c.centre));
}
const domNom = (c, cp) => `${c.nom} (${cp})`;
function domicileDe(c, cp) {
  const [lon, lat] = c.centre.coordinates;
  Saison.setDomicile({ lat, lon, nom: domNom(c, cp) });
  $("s-dom").value = domNom(c, cp);  distanceDuProfil(true); rendre();
}
// champs saisis à la main : enregistrés à chaque modification
$("p-form").addEventListener("change", async (e) => {
  const id = e.target.id, val = e.target.value.trim();
  if (id === "p-cp") {
    const cp = val.replace(/\s/g, "");
    if (!cp) { Saison.setFiche({ cp: null }); Saison.setDomicile(null); $("s-dom").value = ""; rendreProfil(); return; }
    if (!/^\d{5}$/.test(cp)) { e.target.setCustomValidity("5 chiffres"); e.target.reportValidity(); return; }
    e.target.setCustomValidity("");
    try {
      const L = await communesDe(cp);
      Saison.setFiche({ cp });
      if (L.length) { const d = Saison.domicile(); domicileDe(L.find((c) => d && d.nom === domNom(c, cp)) || L[0], cp); }
      if (L.length > 1) signaler(`${L.length} communes pour le ${cp} : choisis la tienne dans la liste.`);
    } catch { signaler("Recherche du code postal impossible (hors ligne ?)."); }
    rendreProfil(); return;
  }
  if (id === "p-licence") {
    const n = val.replace(/\s/g, "");
    if (n && !/^\d{6,12}$/.test(n)) { e.target.setCustomValidity("chiffres uniquement"); e.target.reportValidity(); return; }
    e.target.setCustomValidity("");
    if (n && n !== Saison.licence.num && !confirm(`Enregistrer la licence ${n} ?\nElle ne pourra plus être changée (seul l'administrateur peut la corriger).`)) { rendreProfil(); return; }
    const { data, error } = await sb.from("profils").update({ licence: n || null }).eq("id", Saison.user.id).select("licence,licence_le,licence_verif").maybeSingle();
    if (error) signaler(/licence_fixee|licence_verrouillee/.test(error.message) ? "Licence non modifiable : pour la corriger, contacte l'administrateur."
      : error.code === "23505" || /profils_licence_unique/.test(error.message) ? `La licence ${n} est déjà utilisée par un autre compte GolfNexus. Si c'est bien la tienne, contacte l'administrateur.`
      : "Enregistrement impossible : " + error.message);
    else { Saison.licence = { num: data.licence || "", le: data.licence_le, verif: data.licence_verif }; Saison.resultats = {};
      signaler(n ? "Licence enregistrée." : "Licence retirée."); if (n) lancerReleve(true); }
    rendreProfil(); return;
  }
  if (id === "p-circuit") { Saison.setFiche({ circuit: e.target.value }); circuitDuProfil(true); rendre(); rendreProfil(); return; }
  if (id === "p-dist-auto") { Saison.setFiche({ distAuto: e.target.checked }); distanceDuProfil(true); rendre(); rendreProfil(); return; }
  if (id === "p-commune") { const cp = Saison.fiche.cp, c = communesCP[cp]?.[+val]; if (c) domicileDe(c, cp); rendreProfil(); return; }
  const champ = { "p-nom": ["nom", (x) => x.slice(0, 60)], "p-club": ["club", (x) => x.slice(0, 60)], "p-sexe": ["sexe", (x) => x],
    "p-naissance": ["naissance", (x) => parseInt(x) || null], "p-index": ["index", nombre], "p-dist": ["distMax", (x) => parseInt(x) || null] }[id];
  if (!champ) return;
  Saison.setFiche({ [champ[0]]: champ[1](val) });
  if (id === "p-dist" || id === "p-naissance") { distanceDuProfil(true); rendre(); }
  rendreProfil();
});
$("p-form").addEventListener("submit", (e) => e.preventDefault());

// ---- place probable : la moyenne du joueur (vs SSS) comparée aux éditions passées sur ce golf
// ---- « Ma place » dans la liste (demande du 04/11) : ta moyenne vs SSS ajoutée au SSS, arrondie au coup
// au-dessus, × le nombre de tours → total estimé, placé dans le classement de la dernière édition (même nom
// de tournoi de préférence, sinon même golf). Les joueurs coupés (moins de tours) sont classés après les autres.
function estimePlace(t) {
  const f = Saison.fiche || {}, res = etat.resultats;
  const mp = moyPour(t);
  if (!res || !f.sexe || !mp) return null;
  const cle = `${f.sexe}|${Object.keys(CIRCUITS).map((c) => moyPour({ circuit: c })?.moy).join()}`;
  if (etat.places?.cle !== cle) etat.places = { cle, m: new Map() };
  if (etat.places.m.has(t.id)) return etat.places.m.get(t.id);
  let r = null;
  const g = golfDe(t), s = f.sexe === "D" ? "F" : "M";
  if (g) {
    const eds = etat.tournois.filter((x) => x.golf === t.golf && circuitDe(x) === circuitDe(t) && res[x.id] && x.debut <= AUJ).sort((a, b) => b.debut.localeCompare(a.debut));
    const memeNom = eds.filter((e) => plier(e.nom) === plier(t.nom));
    for (const e of [...memeNom, ...eds.filter((x) => !memeNom.includes(x))]) {
      const ep = (res[e.id] || []).find((x) => x.sexe === s && /stroke|score max/i.test(x.formule || "stroke"));
      if (!ep) continue;
      const p = parcoursJoue(g, ep.parcours), rep = p && repereCompet(p, f.sexe === "D" ? "D" : "H", e);
      const sss = rep && (f.sexe === "D" ? rep.sss_d : rep.sss_h); if (!sss) continue;
      const cl = ep.classement.filter((l) => l.tours && l.tours.length);
      const nt = Math.max(0, ...cl.map((l) => l.tours.length)); if (!nt) continue;
      const complets = cl.filter((l) => l.tours.length === nt).map((l) => l.tours.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
      if (complets.length < 5) continue;
      const parTour = Math.ceil(sss + mp.moy), total = parTour * nt;
      const place = 1 + complets.filter((x) => x < total).length;
      r = { place, n: cl.length, complets: complets.length, cut: place > complets.length && cl.length > complets.length,
        moitie: Math.ceil(cl.length / 2), parTour, total, nt, sss, annee: e.annee, memeNom: memeNom.includes(e), moy: mp.moy, liste: mp.liste };
      break;
    }
  }
  etat.places.m.set(t.id, r);
  return r;
}
function tagPlace(t) {
  if (!$("f-place").checked) return "";
  const sx = (Saison.fiche || {}).sexe;
  if ((sx === "H" && /^(Dames|Femme)$/.test(t.sexe)) || (sx === "D" && /^(Messieurs|Homme)$/.test(t.sexe))) return "";
  if (!ageOk(t)) return `<span class="tag" title="Ce circuit n'est pas ouvert à ton âge">pas pour ton âge</span>`;
  const r = estimePlace(t);
  if (!r) return !moyPour(t) ? "" : `<span class="tag" title="Pas d'édition passée exploitable sur ce golf">place : ?</span>`;
  const bulle = `Estimation : SSS ${String(r.sss).replace(".", ",")} ${signe(r.moy)} (ta moyenne Mérite ${LISTES_M[r.liste]}) → ${r.parTour} par tour × ${r.nt} tours = ${r.total}, ` +
    `comparé à l'édition ${r.annee}${r.memeNom ? "" : " d'un autre tournoi sur ce golf"} (${r.n} classés)`;
  return `<span class="tag place ${r.place <= r.moitie && !r.cut ? "bon" : "mal"}" title="${esc(bulle)}">${r.cut ? "cut probable" : `≈ ${r.place}<small>e</small> / ${r.n}`}</span>`;
}
function blocPlaceProbable(t, g, res, editions) {
  const f = Saison.fiche, sexe = f.sexe, mp = moyPour(t), moy = mp?.moy;
  if (!g.slug || !editions.length) return "";
  if (Saison.mode !== "compte") return `<h3>Ta place probable</h3><div class="bloc vide"><button type="button" class="lien" data-connexion>Connecte-toi</button>
    et remplis ton profil : GolfNexus estimera ta place sur ce tournoi d'après les éditions passées.</div>`;
  if (!ageOk(t)) return `<h3>Ta place probable</h3><div class="bloc vide">Ce tournoi (${esc(circuitLib(t))}) n'est pas ouvert à ton âge : pas d'estimation.</div>`;
  if (!sexe || moy == null) return `<h3>Ta place probable</h3><div class="bloc vide">Indique ton sexe et choisis ta <b>fiche Mérite</b>
    dans <button type="button" class="lien" data-ecran-profil>Mon profil</button> : GolfNexus estimera ta place sur ce tournoi d'après les éditions passées (avec ta moyenne par rapport au SSS de ce circuit).</div>`;
  const s = sexe === "D" ? "F" : "M";
  editions = editions.filter((e) => circuitDe(e) === circuitDe(t));
  const memeNom = editions.filter((e) => plier(e.nom) === plier(t.nom));
  const lignes = [];
  for (const e of (memeNom.length ? memeNom : editions).slice(0, 4)) {
    const ep = (res[e.id] || []).find((x) => x.sexe === s && /stroke|score max/i.test(x.formule || "stroke"));
    if (!ep) continue;
    const p = parcoursJoue(g, ep.parcours); const r = p && repereCompet(p, sexe === "D" ? "D" : "H", e);
    const sss = r && (sexe === "D" ? r.sss_d : r.sss_h); if (!sss) continue;
    const ecarts = ep.classement.filter((l) => l.tours && l.tours.length).map((l) => l.tours.reduce((a, b) => a + b, 0) / l.tours.length - sss).sort((a, b) => a - b);
    const n = ecarts.length; if (n < 5) continue;
    const place = 1 + ecarts.filter((x) => x < moy).length, moitie = Math.ceil(n / 2);
    const rang = (k) => (k <= n ? signe(Math.round(ecarts[k - 1] * 10) / 10) : "—");
    lignes.push({ e, n, place, moitie, sss, r10: rang(10), r20: rang(20), r30: rang(30), r50: rang(moitie) });
  }
  if (!lignes.length) return "";
  const dernier = lignes[0], dedans = dernier.place <= dernier.moitie;
  return `<h3>Ta place probable</h3>
    <div class="bloc place-prob ${dedans ? "ok" : "ko"}">
      <p>En jouant ta moyenne du Mérite ${LISTES_M[mp.liste]} (<b>${signe(moy)}</b> par tour au-dessus du SSS), tu aurais fini environ
        ${lignes.map((l) => `<b>${l.place}<small>e</small> sur ${l.n}</b> en ${l.e.annee}`).join(", ")}
        → ${dedans ? "<b>dans les 50 %</b> : des points au Mérite" : "<b>hors des 50 %</b> : pas de points au Mérite, et un tournoi de plus au diviseur"}.</p>
      <div class="defile"><table><thead><tr><th>Édition</th><th class="n">Classés</th><th class="n">Ta place</th><th class="n">10e</th><th class="n">20e</th><th class="n">30e</th><th class="n">Ligne des 50 %</th></tr></thead><tbody>
      ${lignes.map((l) => `<tr><td>${l.e.annee}</td><td class="n">${l.n}</td><td class="n"><b>≈ ${l.place}</b></td><td class="n">${l.r10}</td><td class="n">${l.r20}</td><td class="n">${l.r30}</td><td class="n">${l.r50} (${l.moitie}e)</td></tr>`).join("")}
      </tbody></table></div>
      <div class="meta">Écarts moyens par tour au SSS (${String(lignes[0].sss).replace(".", ",")}) des joueurs à ces places. Estimation : le résultat dépend du champ de l'année et de ta forme.</div>
    </div>`;
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-ecran-profil]")) { $("fiche").hidden = true; ecran("profil"); } });

// ------------------------------------------------------------------ Mes stats (05/11)
// Données du joueur seulement : historique Mérite mensuel + tournois comptés (merite_mois / merite_tournois),
// places obtenues et trou par trou des GP (resultats_perso). Graphiques en SVG maison : traits 2 px, marqueurs
// ≥ 8 px avec anneau, grille fine, info-bulle au survol, couleurs validées (clair et sombre, daltonisme).
const st = { circuit: null, liste: null, toutHisto: true };   // « Tout l'historique » coché par défaut (06/11)
const moyenne = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ecartType = (a) => { const m = moyenne(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : null; };
const fx = (x, d = 1) => (x == null || isNaN(x) ? "—" : x.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const sg = (x, d = 1) => (x == null || isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + fx(Math.abs(x), d));
const moisLib = (m) => `${MOIS_COURT[+m.slice(4) - 1]} ${m.slice(2, 4)}`;
const placeNum = (p) => { const m = String(p || "").match(/^(\d+)/); return m ? +m[1] : null; };

// graduations « propres » d'un intervalle
function graduations(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const brut = (max - min) / n, p = 10 ** Math.floor(Math.log10(brut)), pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= brut);
  const a = Math.floor(min / pas) * pas, b = Math.ceil(max / pas) * pas, t = [];
  for (let v = a; v <= b + pas / 2; v += pas) t.push(+v.toFixed(6));
  return t;
}
// courbe(s) dans le temps ; series = [{ nom, cls, pts: [{ x: étiquette, y, tip }] }] (mêmes x pour toutes)
// temps : chaque point porte t (date ISO) → abscisse proportionnelle à la date (même place quel que soit le nombre de points)
// etendue : [min, max] à inclure dans l'échelle (échelle stable d'un affichage à l'autre)
function svgLignes({ series, inverse = false, fmt = (v) => fx(v), h = 190, zero = false, W = 1040, plancher = null, temps = false, etendue = null }) {
  const g = 44, d = 64, hautM = 14, basM = 26, xs = series[0].pts.map((p) => p.x), n = xs.length;
  const ys = series.flatMap((s) => s.pts.map((p) => p.y)).filter((v) => v != null);
  if (!ys.length) return "";
  const t = graduations(Math.min(...ys, ...(zero ? [0] : []), ...(plancher != null ? [plancher] : []), ...(etendue ? [etendue[0]] : [])),
    Math.max(...ys, ...(zero ? [0] : []), ...(etendue ? [etendue[1]] : []))), lo = t[0], hi = t.at(-1);
  const ms = (iso) => new Date(iso + "T12:00:00").getTime();
  const ts = temps ? series[0].pts.map((p) => ms(p.t)) : null, t0 = temps ? Math.min(...ts) : 0, t1 = temps ? Math.max(...ts) : 0;
  const Xt = (v) => g + (t1 === t0 ? (W - g - d) / 2 : ((v - t0) * (W - g - d)) / (t1 - t0));
  const X = (i) => (temps ? Xt(ts[i]) : g + (n === 1 ? (W - g - d) / 2 : (i * (W - g - d)) / (n - 1)));
  const Y = (v) => { const r = (v - lo) / (hi - lo || 1); return hautM + (inverse ? r : 1 - r) * (h - hautM - basM); };
  const pasX = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 90))));
  let o = `<svg class="st-svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img">`;
  for (const v of t) o += `<line class="st-grille" x1="${g}" x2="${W - d}" y1="${Y(v)}" y2="${Y(v)}"/><text class="st-axe" x="${g - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  if (temps) {   // axe du temps : un repère au 1er de chaque mois, espacés régulièrement (pas de 1, 2, 3, 6 mois)
    const d0 = new Date(t0), d1 = new Date(t1), nbM = (d1.getFullYear() - d0.getFullYear()) * 12 + d1.getMonth() - d0.getMonth() + 1;
    const pas = [1, 2, 3, 6, 12].find((p) => nbM / p <= Math.max(3, Math.floor(W / 95))) || 12;
    for (let k = 1; k <= nbM; k++) { const m = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (m.getTime() > t1) break; if ((m.getMonth()) % pas) continue;
      const x = Xt(m.getTime()); o += `<line class="st-grille" x1="${x}" x2="${x}" y1="${h - basM}" y2="${h - basM + 4}"/><text class="st-axe" x="${x}" y="${h - 8}" text-anchor="middle">${MOIS_COURT[m.getMonth()]} ${String(m.getFullYear()).slice(2)}</text>`; }
  } else {
  // étiquettes de l'axe : une sur pasX, jamais deux fois le même mois de suite
  let dernierLib = null;
  xs.forEach((x, i) => { if (((i % pasX === 0 && n - 1 - i >= pasX / 2) || i === n - 1) && x !== dernierLib) { o += `<text class="st-axe" x="${X(i)}" y="${h - 8}" text-anchor="middle">${esc(x)}</text>`; dernierLib = x; } });
  }
  // étiquettes de fin de courbe : placées ensemble, au moins 13 px d'écart (sinon « +6,3 12 m » et « 6 m » se chevauchent)
  const finY = new Map(), fins = series.filter((s) => !s.points).map((s) => { const q = s.pts.map((p, i) => (p.y == null ? null : Y(p.y))).filter((v) => v != null).at(-1); return { s, y: q }; })
    .filter((f) => f.y != null).sort((a, b) => a.y - b.y);
  fins.forEach((f, i) => { f.ty = i && f.y - fins[i - 1].ty < 13 ? fins[i - 1].ty + 13 : f.y; });
  const deb = fins.length ? Math.max(0, fins.at(-1).ty - (h - basM)) : 0;   // tout remonter si on sort du cadre
  for (const f of fins) finY.set(f.s, f.ty - deb);
  for (const s of series) {
    const pts = s.pts.map((p, i) => (p.y == null ? null : [temps ? Xt(ms(p.t)) : X(i), Y(p.y), p])).filter(Boolean);
    if (!pts.length) continue;
    if (s.points) { for (const [x, y] of pts) o += `<circle class="st-tour ${s.cls}" cx="${x}" cy="${y}" r="4"/>`; continue; }   // un point par tour, sans trait
    o += `<path class="st-l ${s.cls}" d="${pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ")}"/>`;
    for (const [x, y] of pts) o += `<circle class="st-pt ${s.cls}" cx="${x}" cy="${y}" r="3"/>`;
    const [lx, ly, lp] = pts.at(-1);
    o += `<circle class="st-fin ${s.cls}" cx="${lx}" cy="${ly}" r="4.5"/><text class="st-val" x="${lx + 9}" y="${(finY.get(s) ?? ly) + 4}">${fmt(lp.y)}${series.length > 1 ? " " + esc(s.court || "") : ""}</text>`;
  }
  // zones de survol (une par mois, toutes séries)
  xs.forEach((x, i) => {
    const tip = `<b>${esc(x)}</b>` + series.map((s) => s.pts[i]?.y != null ? `<br>${esc(s.nom)} : ${s.pts[i].tip ?? fmt(s.pts[i].y)}` : "").join("");
    const lg = temps ? 14 : Math.max(16, (W - g - d) / n);
    o += `<rect class="st-hit" x="${X(i) - lg / 2}" y="0" width="${lg}" height="${h - basM}" data-tip="${esc(tip)}"/>`;
  });
  return o + "</svg>";
}
// colonnes (valeurs positives ou négatives) ; barres = [{ lib, v, cls, tip }]
function svgColonnes({ barres, fmt = (v) => fx(v), h = 170, W = 1040 }) {
  const g = 44, hautM = 18, basM = 26, n = barres.length;
  const vs = barres.map((b) => b.v).filter((v) => v != null);
  if (!vs.length) return "";
  const t = graduations(Math.min(0, ...vs), Math.max(0, ...vs)), lo = t[0], hi = t.at(-1);
  const Y = (v) => hautM + (1 - (v - lo) / (hi - lo || 1)) * (h - hautM - basM), bande = (W - g - 8) / n, larg = Math.min(24, bande * 0.6);
  let o = `<svg class="st-svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img">`;
  for (const v of t) o += `<line class="st-grille${v === 0 ? " zero" : ""}" x1="${g}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}"/><text class="st-axe" x="${g - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  barres.forEach((b, i) => {
    const cx = g + bande * i + bande / 2;
    o += `<text class="st-axe" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(b.lib)}</text>`;
    if (b.v == null) return;
    const y0 = Y(0), y1 = Y(b.v), haut = Math.abs(y1 - y0), r = Math.min(4, haut), x = cx - larg / 2;
    // bout arrondi côté donnée, carré côté base
    const dPath = b.v >= 0
      ? `M${x} ${y0} V${y1 + r} Q${x} ${y1} ${x + r} ${y1} H${x + larg - r} Q${x + larg} ${y1} ${x + larg} ${y1 + r} V${y0} Z`
      : `M${x} ${y0} V${y1 - r} Q${x} ${y1} ${x + r} ${y1} H${x + larg - r} Q${x + larg} ${y1} ${x + larg} ${y1 - r} V${y0} Z`;
    o += `<path class="st-b ${b.cls || "c1"}" d="${dPath}"/>`;
    if (b.etiq !== false) o += `<text class="st-val" x="${cx}" y="${b.v >= 0 ? y1 - 5 : y1 + 13}" text-anchor="middle">${fmt(b.v)}</text>`;
    o += `<rect class="st-hit" x="${cx - bande / 2}" y="0" width="${bande}" height="${h - basM}" data-tip="${esc(b.tip || `<b>${esc(b.lib)}</b><br>${fmt(b.v)}`)}"/>`;
  });
  return o + "</svg>";
}
const tuileSt = (val, lib, sous = "") => `<div class="st-tuile"><b>${val}</b><span>${lib}</span>${sous ? `<small>${sous}</small>` : ""}</div>`;
const blocSt = (titre, sous, corps) => corps ? `<div class="bloc st-bloc"><h3>${titre}</h3>${sous ? `<p class="meta">${sous}</p>` : ""}${corps}</div>` : "";

function rendreStats() {
  // graphiques dessinés à la largeur réelle (sur téléphone, un dessin large réduit rendrait le texte illisible)
  const larg = Math.max(300, ($("st-contenu").clientWidth || document.documentElement.clientWidth) - 32);
  st.l1 = Math.min(1408, larg); st.l2 = larg < 760 ? larg : Math.min(700, Math.floor(larg / 2) - 12);
  const S = Saison.stats || { mois: [], tournois: [] }, f = Saison.fiche || {};
  // Onglets = les CIRCUITS où il joue (tournois joués de sa saison, places relevées par la licence, tournois comptés
  // à un Mérite) : on peut jouer chez les adultes sans être classé au Mérite. Le Mérite du circuit s'affiche s'il y figure.
  const R0 = Object.entries(Saison.resultats || {}).map(([id, r]) => ({ ...r, t: tournoiDe(id) })).filter((r) => r.t).sort((a, b) => a.t.debut.localeCompare(b.t.debut));
  const joues = Object.values(Saison.items || {}).flatMap((o) => Object.entries(o || {})).filter(([, e]) => e.statut === "joue").map(([id]) => tournoiDe(id)).filter(Boolean);
  const circuitDeListe = Object.fromEntries(Object.entries(LISTE_DU_CIRCUIT).map(([c, l]) => [l, c]));
  const presents = new Set([...joues.map(circuitDe), ...R0.map((r) => circuitDe(r.t)), ...S.tournois.map((t) => circuitDeListe[t.liste]).filter(Boolean)]);
  const circuits = Object.keys(CIRCUITS).filter((c) => presents.has(c));
  // par défaut : le circuit de sa fiche, sinon Adultes, sinon le premier
  if (!circuits.includes(st.circuit)) st.circuit = [f.circuit, "gp", circuits[0]].find((c) => circuits.includes(c)) || null;
  st.liste = LISTE_DU_CIRCUIT[st.circuit] || "amateurs";
  $("st-listes").innerHTML = circuits.length > 1 ? circuits.map((c) => `<button type="button" data-st-circuit="${c}" aria-pressed="${c === st.circuit}">${CIRCUITS[c]}</button>`).join("") : "";
  const C = $("st-contenu");
  if (!f.merite && !R0.length) { C.innerHTML = `<div class="bloc vide">Choisis ta fiche Mérite et saisis ta licence dans <button type="button" class="lien" data-ecran-profil>Mon profil</button> : tes statistiques en viennent.</div>`; return; }
  if (!circuits.length) { C.innerHTML = `<div class="bloc vide">Rien de relevé pour l'instant (relevé chaque lundi : Mérite depuis décembre 2024, places des tournois joués).
    ${Saison.demo ? "" : `<p><button type="button" class="btn plein" id="st-releve">Lancer mon relevé maintenant</button></p><p class="meta">1 à 2 minutes ; une fois par jour au plus.</p>`}</div>`; return; }
  const LIB = CIRCUITS[st.circuit], LIBM = `Mérite ${LISTES_M[st.liste]}`;
  // Mérite du circuit (peut être vide : joueur pas au Mérite de ce circuit)
  const M = S.mois.filter((m) => m.liste === st.liste).sort((a, b) => a.mois.localeCompare(b.mois));
  const T = S.tournois.filter((t) => t.liste === st.liste).sort((a, b) => a.date.localeCompare(b.date));
  const der = M.at(-1), avant = M.at(-2);
  const il12 = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  // tournois relevés de CE circuit (place / champ, trou par trou)
  const R = R0.filter((r) => circuitDe(r.t) === st.circuit);
  // TOURNOIS DE CE CIRCUIT (06/11 : dans un onglet, tous les blocs ne parlent que du circuit) :
  //  - relevés par la licence (circuit connu) ;
  //  - comptés à n'importe quel Mérite et retrouvés dans le calendrier collecté avec ce circuit ;
  //  - comptés au Mérite de ce circuit mais introuvables dans le calendrier (circuit inconnu : on fait confiance au Mérite).
  // Un même tournoi présent dans deux Mérites (ex. GP adulte au Mérite Jeunes et Adultes) n'est compté qu'une fois.
  const cleM = (m) => m.date + "|" + plier(m.nom), vus = new Set(), J = [];
  for (const r of R) {
    const m = meriteDe(r.t); if (m) for (const x of S.tournois) if (x.date === m.date && plier(x.nom) === plier(m.nom)) vus.add(cleM(x));
    J.push({ date: r.t.debut, nom: r.t.nom, place: r.place, tours: r.tours || [], m, r });
  }
  for (const m of [...S.tournois].sort((a, b) => a.date.localeCompare(b.date))) {
    if (vus.has(cleM(m))) continue;
    const t = tournoiDuMerite(m);
    if (t ? circuitDe(t) !== st.circuit : m.liste !== st.liste) continue;
    vus.add(cleM(m));
    J.push({ date: m.date, nom: m.nom, place: m.place, tours: m.tours || [], m });
  }
  J.sort((a, b) => a.date.localeCompare(b.date));
  const J12 = J.filter((t) => t.date >= il12), source = `tournois ${LIB}`;

  // ---- tours vs SSS. Priorité à la donnée ffgolf : « Moy.SSS » du tournoi dans la fiche Mérite (SSS réel du jour ;
  // SSS = moyenne des tours − Moy.SSS). Notre SSS (repère de compétition) seulement pour un tournoi absent du Mérite.
  const tours = [], sx = f.sexe === "D" ? "D" : "H";
  const ajouterTours = (sc, sss, date, nom, src) => sc.forEach((x, i) => x > 0 && tours.push({ date, nom, n: i + 1, d: x - sss, score: x, src }));
  for (const j of J) {
    if (j.m?.tours?.length && j.m.moy_sss != null) { ajouterTours(j.m.tours, moyenne(j.m.tours) - j.m.moy_sss, j.date, j.nom, "ffgolf"); continue; }
    if (!j.r) continue;
    const g = golfDe(j.r.t), pc = g && parcoursJoue(g, j.r.parcours), rp = pc && repereCompet(pc, sx, j.r.t), sss = rp && (sx === "D" ? rp.sss_d : rp.sss_h);
    if (sss && j.tours.length) ajouterTours(j.tours, sss, j.date, j.nom, "repère");
  }
  tours.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  const tours12 = tours.filter((x) => x.date >= il12), ds12 = tours12.map((x) => x.d);
  // ---- places
  const pl = J12.map((t) => placeNum(t.place)), classes = pl.filter((x) => x != null);
  const nonClasses = J12.filter((t) => placeNum(t.place) == null).length;

  let h = "";
  // 0. en bref
  const delta = der && avant && der.place && avant.place ? avant.place - der.place : null;
  h += `<div class="st-tuiles">
    ${tuileSt(der?.place ? fx(der.place, 0) + "<small>e</small>" : "—", `au ${LIBM}`, !der ? "pas au Mérite de ce circuit" : delta ? `<span class="${delta > 0 ? "mieux" : "moins"}">${delta > 0 ? "▲ " + delta : "▼ " + -delta} place${Math.abs(delta) > 1 ? "s" : ""}</span> en un mois` : der.place ? moisLib(der.mois) : "non classé")}
    ${der?.moy != null ? tuileSt(sg(der.moy, 2), "moyenne vs SSS (12 mois)", der.moy6 != null ? `6 derniers mois : ${sg(der.moy6, 2)}` : "")
      : tuileSt(sg(moyenne(ds12), 2), "moyenne vs SSS (12 mois)", ds12.length ? `sur ses ${ds12.length} tours relevés` : "")}
    ${tuileSt(der?.index_golf != null ? fx(der.index_golf) : f.index != null ? fx(f.index) : "—", "index", der?.statut || "")}
    ${tuileSt(fx(ecartType(ds12), 1), "régularité (écart-type d'un tour)", ds12.length ? `${ds12.length} tours sur 12 mois` : "")}
    ${tuileSt(fx(J12.length, 0), `tournois ${LIB} sur 12 mois`, `${fx(tours12.length, 0)} tours · ${fx(der?.victoires ?? 0, 0)} victoire${(der?.victoires || 0) > 1 ? "s" : ""}`)}
  </div>`;

  // 4. Mérite mois par mois (petits multiples : une mesure par graphique, jamais deux échelles)
  const pts = (k, fmt) => M.map((m) => ({ x: moisLib(m.mois), y: m[k] == null ? null : +m[k], tip: m[k] == null ? null : fmt(+m[k]) }));
  if (!M.length) h += blocSt(LIBM, "", `<p class="meta">Pas de fiche au ${LIBM} : ses tournois ${LIB} sont bien pris en compte ci-dessous (places, tour par tour, trou par trou), mais il n'y a ni place ni points au Mérite à suivre pour ce circuit.</p>`);
  const autresCircuits = T.some((m) => { const t = tournoiDuMerite(m); return t && circuitDe(t) !== st.circuit; });
  const noteM = autresCircuits ? ` Calcul de la ffgolf : ce Mérite compte aussi des tournois d'autres circuits${st.liste === "jeunes" ? " (tes Grands Prix adultes)" : ""}.` : "";
  if (M.length) h += blocSt(`${LIBM} mois par mois`, "Relevé chaque mois depuis décembre 2024 : progresse-t-il ou recule-t-il ?" + noteM, `
    <div class="st-multi">
      <div><h4>Place au Mérite <small>(plus bas = mieux)</small></h4>${svgLignes({ series: [{ nom: "Place", cls: "c1", pts: pts("place", (v) => fx(v, 0) + "e") }], fmt: (v) => fx(v, 0), W: st.l2 })}</div>
      <div><h4>Moyenne par rapport au SSS <small>(vers le bas = mieux)</small></h4>
        <div class="st-legende"><span><i class="c1"></i>12 mois</span><span><i class="c2"></i>6 mois</span></div>
        ${svgLignes({ series: [{ nom: "12 mois", court: "12 m", cls: "c1", pts: pts("moy", (v) => sg(v, 2)) }, { nom: "6 mois", court: "6 m", cls: "c2", pts: pts("moy6", (v) => sg(v, 2)) }], fmt: (v) => sg(v, 1), zero: true, W: st.l2 })}</div>
      <div><h4>Index</h4>${svgLignes({ series: [{ nom: "Index", cls: "c1", pts: pts("index_golf", (v) => fx(v)) }], fmt: (v) => fx(v), W: st.l2 })}</div>
      <div><h4>Points Mérite (total)</h4>${svgLignes({ series: [{ nom: "Total", cls: "c1", pts: pts("total", (v) => fx(v, 2)) }], fmt: (v) => fx(v, 0), W: st.l2 })}</div>
    </div>`);

  // 4 bis. ce qu'il faut pour gagner des places
  if (der?.place) h += `<div id="st-simu">${blocSt("Ce qu'il te faut pour monter", "", `<p class="meta">Calcul en cours (lecture du ${LIBM} du mois)…</p>`)}</div>`;

  // 2. niveau réel tour par tour
  if (tours.length) {
    // interrupteurs (06/11) : « Chaque tour » (sinon UN point par tournoi = moyenne de ses tours, plus lisible)
    // et « Tout l'historique » (sinon 12 mois, comme le reste de Mes stats)
    // moyenne glissante calculée sur TOUT l'historique, puis seulement affichée sur la période (pas de redémarrage)
    const fen = 5, glis = tours.map((x, i) => moyenne(tours.slice(Math.max(0, i - fen + 1), i + 1).map((y) => y.d)));
    const debut = st.toutHisto ? "" : il12, idx = tours.map((x, i) => i).filter((i) => tours[i].date >= debut), T_ = idx.map((i) => tours[i]);
    // les tours d'un même tournoi : un jour d'écart chacun sur l'axe du temps (pas empilés)
    const jour = (x) => { const dt = new Date(x.date + "T12:00:00"); dt.setDate(dt.getDate() + x.n - 1); return dt.toISOString().slice(0, 10); };
    let ptsPoints, ptsCourbe;
    if (st.chaqueTour) {
      ptsPoints = idx.map((i) => { const x = tours[i]; return { t: jour(x), x: "", y: +x.d.toFixed(1), tip: `${x.score} (${sg(x.d)}), tour ${x.n} de « ${esc(titre(x.nom))} », ${fmtDate(x.date)}${x.src === "repère" ? " · SSS du repère (absent du Mérite)" : ""}` }; });
      ptsCourbe = idx.map((i) => ({ t: jour(tours[i]), x: "", y: +glis[i].toFixed(2), tip: `moyenne des 5 derniers tours : ${sg(glis[i])}` }));
    } else {
      const grp = [];
      idx.forEach((i) => { const x = tours[i], k = x.date + "|" + x.nom; let gr = grp.at(-1); if (!gr || gr.k !== k) grp.push((gr = { k, date: x.date, nom: x.nom, ds: [], sc: [] })); gr.ds.push(x.d); gr.sc.push(x.score); gr.der = i; gr.t = jour(x); });
      ptsPoints = grp.map((gr) => ({ t: gr.t, x: "", y: +moyenne(gr.ds).toFixed(1), tip: `« ${esc(titre(gr.nom))} », ${fmtDate(gr.date)} : ${gr.sc.join(" · ")} — ${sg(moyenne(gr.ds))} par tour en moyenne` }));
      ptsCourbe = grp.map((gr) => ({ t: gr.t, x: "", y: +glis[gr.der].toFixed(2), tip: `moyenne des 5 derniers tours : ${sg(glis[gr.der])}` }));
    }
    // échelle commune aux deux affichages : bornée par TOUS les tours de la période
    const dsP = T_.map((x) => x.d), etendue = dsP.length ? [Math.min(...dsP), Math.max(...dsP)] : null;
    const parN = [1, 2, 3, 4].map((n) => ({ n, v: moyenne(tours12.filter((x) => x.n === n).map((x) => x.d)), c: tours12.filter((x) => x.n === n).length })).filter((x) => x.c);
    const meil = tours12.length ? tours12.reduce((a, b) => (b.d < a.d ? b : a)) : null, pire = tours12.length ? tours12.reduce((a, b) => (b.d > a.d ? b : a)) : null;
    const opt = (k, lib) => `<label class="bascule petite"><input type="checkbox" data-st-opt="${k}" ${st[k] ? "checked" : ""}><span class="piste" aria-hidden="true"></span>${lib}</label>`;
    h += blocSt("Ton niveau tour par tour", `Score par rapport au SSS du parcours (moins = mieux) ; la courbe suit la moyenne des 5 derniers tours · ${st.toutHisto ? "tout l'historique" : "12 derniers mois"}.`, `
      <div class="st-options">${opt("chaqueTour", "Chaque tour")}${opt("toutHisto", "Tout l'historique")}</div>
      ${T_.length ? `<div class="st-legende"><span><i class="c1"></i>moyenne des 5 derniers tours</span><span><i class="pt c2"></i>${st.chaqueTour ? "chaque tour" : "chaque tournoi (moyenne de ses tours)"}</span></div>
      ${svgLignes({ series: [
        { nom: st.chaqueTour ? "Tour" : "Tournoi", cls: "c2", points: true, pts: ptsPoints },
        { nom: "Moyenne 5 tours", cls: "c1", pts: ptsCourbe }],
        fmt: (v) => sg(v), zero: true, h: 240, W: st.l1, temps: true, etendue,
        // l'axe descend au moins à −5 (et jusqu'à −12 au plus) : les tours sous le SSS doivent se voir
        plancher: Math.max(-12, Math.min(-5, Math.floor(Math.min(...dsP)) - 1)) })}`
      : `<p class="meta">Aucun tour relevé sur les 12 derniers mois : active « Tout l'historique ».</p>`}
      <div class="st-duo">
        <div><h4>Selon le tour de l'épreuve <small>(12 mois)</small></h4>
          ${svgColonnes({ barres: parN.map((x) => ({ lib: `Tour ${x.n}`, v: +x.v.toFixed(2), cls: "c1", tip: `<b>Tour ${x.n}</b><br>${sg(x.v, 2)} vs SSS en moyenne<br>${x.c} tours` })), fmt: (v) => sg(v), h: 160, W: st.l2 })}
          <p class="meta">${lectureTours(parN)}</p></div>
        <div><h4>Régularité <small>(12 mois)</small></h4>
          <ul class="st-liste">
            <li>Écart-type d'un tour : <b>${fx(ecartType(ds12))} coup${ecartType(ds12) >= 2 ? "s" : ""}</b> — ${ecartType(ds12) == null ? "" : ecartType(ds12) < 2.5 ? "très régulier" : ecartType(ds12) < 4 ? "régularité correcte" : "des tours très inégaux : c'est là qu'il y a le plus à gagner"}</li>
            ${meil ? `<li>Meilleur tour : <b>${meil.score} (${sg(meil.d)})</b> · ${esc(titre(meil.nom))}, ${fmtDate(meil.date)}</li>` : ""}
            ${pire ? `<li>Tour le plus difficile : <b>${pire.score} (${sg(pire.d)})</b> · ${esc(titre(pire.nom))}, ${fmtDate(pire.date)}</li>` : ""}
            <li>Tours sous le SSS : <b>${tours12.filter((x) => x.d < 0).length} / ${tours12.length}</b></li>
          </ul></div>
      </div>`);
  }

  // 1. trou par trou (GP relevés)
  const H = [];
  for (const r of R) (r.trous || []).forEach((tr, k) => tr && r.pars?.[k] && tr.forEach((s, i) => { const p = r.pars[k][i]; if (s > 0 && p > 0) H.push({ s, p, d: s - p, i, parcours: r.parcours || r.t.golf_nom, tid: r.t.id }); }));
  if (H.length) {
    const parType = [3, 4, 5].map((p) => ({ p, v: moyenne(H.filter((x) => x.p === p).map((x) => x.d)), c: H.filter((x) => x.p === p).length })).filter((x) => x.c);
    const rep = [["birdie ou mieux", (d) => d <= -1, "r-bir"], ["par", (d) => d === 0, "r-par"], ["bogey", (d) => d === 1, "r-bog"], ["double ou plus", (d) => d >= 2, "r-dbl"]]
      .map(([lib, ok, cls]) => ({ lib, cls, n: H.filter((x) => ok(x.d)).length }));
    const nbTours = H.length / 18;
    const aller = moyenne(H.filter((x) => x.i < 9).map((x) => x.d)) * 9, retour = moyenne(H.filter((x) => x.i >= 9).map((x) => x.d)) * 9;
    const parTrou = {};
    for (const x of H) (parTrou[`${x.parcours}|${x.i + 1}|${x.p}`] ||= []).push(x.d);
    const durs = Object.entries(parTrou).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ k, m: moyenne(v), n: v.length })).sort((a, b) => b.m - a.m).slice(0, 3);
    h += blocSt("Trou par trou", `Sur ${fx(nbTours, 0)} tours ${LIB} relevés (scores de chaque trou publiés par la ffgolf).`, `
      <div class="st-duo">
        <div><h4>Coups au-dessus du par, en moyenne par trou</h4>
          ${svgColonnes({ barres: parType.map((x) => ({ lib: `Par ${x.p}`, v: +x.v.toFixed(2), cls: "c1", tip: `<b>Par ${x.p}</b><br>${sg(x.v, 2)} par trou<br>${x.c} trous joués` })), fmt: (v) => sg(v, 2), h: 160, W: st.l2 })}
          <p class="meta">${lecturePars(parType)}</p></div>
        <div><h4>Répartition des scores</h4>
          <div class="st-seg" role="img" aria-label="${rep.map((x) => `${x.lib} ${Math.round((100 * x.n) / H.length)} %`).join(", ")}">${rep.filter((x) => x.n).map((x) => `<span class="${x.cls}" style="flex:${x.n}" data-tip="${esc(`<b>${x.lib}</b><br>${x.n} trous · ${Math.round((100 * x.n) / H.length)} %<br>${fx(x.n / nbTours)} par tour`)}"></span>`).join("")}</div>
          <div class="st-legende">${rep.map((x) => `<span><i class="${x.cls}"></i>${x.lib} <b>${Math.round((100 * x.n) / H.length)} %</b> · ${fx(x.n / nbTours)}/tour</span>`).join("")}</div>
          <ul class="st-liste">
            <li>Aller : <b>${sg(aller)}</b> · retour : <b>${sg(retour)}</b> par rapport au par (sur 9 trous) — ${Math.abs(aller - retour) < 0.4 ? "aussi solide sur les deux" : retour > aller ? "il perd plus de coups sur le retour (fatigue, concentration ?)" : "il démarre moins bien : l'échauffement compte"}</li>
            ${durs.map((x) => { const [pc, n, p] = x.k.split("|"); return `<li>Trou ${n} (par ${p}) de ${esc(titre(pc))} : <b>${sg(x.m, 2)}</b> en moyenne sur ${x.n} passages</li>`; }).join("")}
          </ul></div>
      </div>`);
  } else if (Saison.licence?.num) h += blocSt("Trou par trou", "", `<p class="meta">Le trou par trou vient des Grands Prix relevés grâce à ta licence (chaque lundi) : il apparaîtra au prochain passage (tournois ${LIB} de ta saison passés en « Joué »).</p>`);

  // 3. places : en clair, sans pourcentages abstraits
  const avecChamp = R.filter((r) => placeNum(r.place) && r.classes);
  const pct = avecChamp.map((r) => (100 * placeNum(r.place)) / r.classes);
  const lignesGP = R.map((r) => { const e = estimePlace(r.t), n = placeNum(r.place); return { r, e, n, ecart: e?.place && n ? n - e.place : null }; });
  const ecarts = lignesGP.map((x) => x.ecart).filter((x) => x != null);
  const nTop10 = classes.filter((x) => x <= 10).length, nVict = classes.filter((x) => x === 1).length;
  h += blocSt("Tes places", `Sur les 12 derniers mois : ${J12.length} ${source}.`, `
    <ul class="st-liste st-gros">
      <li><b>${nVict} victoire${nVict > 1 ? "s" : ""}</b> et <b>${nTop10} fois dans les 10 premiers</b> sur ${J12.length} tournois.</li>
      <li><b>Cut passé ${classes.length} fois sur ${J12.length}</b>${nonClasses ? ` (${nonClasses} fois non classé : cut manqué ou abandon)` : ""}.</li>
      ${pct.length ? `<li>Sur les tournois ${LIB} relevés, il finit en moyenne <b>${Math.round(moyenne(pct)) <= 50 ? "dans la première moitié" : "dans la seconde moitié"} du classement</b> : sur 100 joueurs classés, vers la <b>${Math.round(moyenne(pct))}ᵉ place</b>.</li>` : ""}
      ${ecarts.length ? `<li>Par rapport à l'estimation de GolfNexus, il finit en moyenne <b>${fx(Math.abs(moyenne(ecarts)), 0)} place${Math.abs(moyenne(ecarts)) >= 2 ? "s" : ""} ${moyenne(ecarts) < 0 ? "plus haut" : "plus bas"}</b> que prévu.</li>` : ""}
    </ul>
    ${lignesGP.length ? `<div class="st-table"><table><thead><tr><th>Tournoi ${LIB} relevé</th><th>Place obtenue</th><th>Joueurs classés</th><th>Place estimée</th><th>Écart</th></tr></thead><tbody>
      ${lignesGP.slice().reverse().map(({ r, e, ecart }) => `<tr><td>${fmtDate(r.t.debut)} · ${esc(titre(r.t.nom))}</td><td><b>${esc(String(r.place).replace(/^(\d+)/, "$1ᵉ"))}</b></td><td>${r.classes ?? "—"}</td><td>${e?.place ? e.place + "ᵉ" : "—"}</td><td>${ecart == null ? "—" : `<span class="${ecart < 0 ? "mieux" : ecart > 0 ? "moins" : ""}">${ecart < 0 ? "▲ " + -ecart + " mieux" : ecart > 0 ? "▼ " + ecart + " moins bien" : "= pile"}</span>`}</td></tr>`).join("")}
    </tbody></table></div>` : ""}`);

  // 5. activité
  const parMois = {};
  for (const t of J12) { const k = t.date.slice(0, 7); (parMois[k] ||= { n: 0, tours: 0 }); parMois[k].n++; parMois[k].tours += t.tours?.length || 0; }
  const mois12 = []; { const d = new Date(); d.setDate(1); for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); mois12.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`); } }
  const dom = Saison.domicile(), an = new Date().getFullYear();
  const kmAn = Object.values(Saison.items || {}).flatMap((o) => Object.entries(o || {})).map(([id, e]) => ({ t: tournoiDe(id), e }))
    .filter((x) => x.t && x.t.annee === an && x.e.statut === "joue" && circuitDe(x.t) === st.circuit).reduce((s, x) => { const p = posDe(x.t); return s + (dom && p ? 2 * km(dom, p) : 0); }, 0);
  h += blocSt("Le travail fourni", "Tours de compétition joués par mois (12 derniers mois).", `
    ${svgColonnes({ barres: mois12.map((k) => ({ lib: MOIS_COURT[+k.slice(5) - 1], v: parMois[k]?.tours || 0, cls: "c1", etiq: !!parMois[k]?.tours,
      tip: `<b>${MOIS[+k.slice(5) - 1]} ${k.slice(0, 4)}</b><br>${parMois[k]?.n || 0} tournoi(s) · ${parMois[k]?.tours || 0} tours` })), fmt: (v) => fx(v, 0), h: 160, W: st.l1 })}
    <ul class="st-liste">
      <li><b>${fx(J12.reduce((s, t) => s + (t.tours?.length || 0), 0), 0)} tours</b> de compétition ${LIB} en 12 mois, soit ${fx(J12.reduce((s, t) => s + (t.tours?.length || 0), 0) / 12)} par mois</li>
      ${kmAn ? `<li><b>${fx(Math.round(kmAn / 10) * 10, 0)} km</b> aller-retour pour les tournois ${LIB} joués de ta saison ${an} (à vol d'oiseau)</li>` : ""}
      ${M.length > 2 ? `<li>Moyenne vs SSS : ${sg(M[0].moy, 2)} en ${moisLib(M[0].mois)} → ${sg(der.moy, 2)} en ${moisLib(der.mois)} (${der.moy < M[0].moy ? "en progrès" : "à retravailler"})</li>` : ""}
    </ul>`);

  // tableau (vue tableau des données)
  if (T.length) h += blocSt("Tous les tournois comptés", `${T.length} tournois du ${LIBM} (ffgolf garde environ 12 mois glissants ; GolfNexus les conserve).${noteM}`, `
    <div class="st-table"><table><thead><tr><th>Date</th><th>Compétition</th><th>Circuit · catégorie</th><th title="Catégorie Mérite du tournoi (0 à 10) : force du champ, calculée par la ffgolf">Cat. Mérite</th><th>Place</th><th>Tours</th><th>vs SSS</th><th>Points</th><th class="st-col-carte"><span class="sr">Carte de score</span></th></tr></thead><tbody>
    ${(st.lignesT = T.slice().reverse()).map((t, i) => `<tr><td>${fmtDate(t.date)}</td><td>${esc(titre(t.nom))}</td><td>${(() => { const x = tournoiDuMerite(t); return x ? `<span class="tag circ-${circuitDe(x)}">${esc(circuitLib(x))}</span>` : "—"; })()}</td><td>${esc(t.cat || "")}</td><td>${esc(t.place || "—")}</td><td class="st-tours">${(t.tours || []).join(" · ") || (/match|foursome/i.test(t.nom + " " + (t.formule || "")) ? "<span class='meta'>match-play</span>" : "")}</td><td>${t.tours?.length ? sg(t.moy_sss, 2) : "—"}</td><td>${t.div === 0 ? `<span title="ne compte pas dans le diviseur">${fx(t.points, 2)}*</span>` : fx(t.points, 2)}</td><td class="st-col-carte">${t.tours?.length ? `<button type="button" class="st-carte-btn${scoreDe(t)?.trous ? " detail" : ""}" data-carte="${i}"
      title="${scoreDe(t)?.trous ? "Ma carte de score : trou par trou et tour par tour" : "Mes tours sur ce tournoi"}" aria-label="Voir mes scores : ${esc(titre(t.nom))}">${ICONE_CARTE}</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>`);
  // mise à jour à la demande (relevé immédiat, 1 fois par jour) ; dernière lecture du Mérite
  if (!Saison.demo) h += `<p class="meta st-maj">${der ? `Dernier relevé du ${LIBM} : ${moisLib(der.mois)}` : "Relevé"}${der?.lu_le ? ` (lu le ${fmtDate(String(der.lu_le).slice(0, 10))})` : ""}.
    Mérite relu le lendemain de chaque parution, places et trou par trou chaque lundi · <button type="button" class="lien" id="st-releve">${Saison.releve === "en cours" ? "relevé en cours…" : "Mettre à jour maintenant"}</button> (une fois par jour).</p>`;
  C.innerHTML = h;
  simulation(der);
}
// ---- carte de score d'un tournoi (06/11) : clic sur une ligne de « Tous les tournois comptés »
const ICONE_CARTE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16M13 4v16"/></svg>`;
// résultat relevé par la licence (trou par trou, place) pour une ligne du Mérite
function scoreDe(m) { const t = tournoiDuMerite(m); const r = t && Saison.resultats?.[t.id]; return r ? { ...r, t } : t ? { t } : null; }
function carteScore(m) {
  const sc = scoreDe(m) || {}, t = sc.t, sx = (Saison.fiche?.sexe === "D") ? "D" : "H";
  const tours = (sc.tours?.length ? sc.tours : m.tours || []).filter((x) => x > 0), nt = tours.length;
  // SSS : celui de la ffgolf (Moy.SSS du Mérite) d'abord, sinon le repère de compétition
  let sss = m.tours?.length && m.moy_sss != null ? moyenne(m.tours) - m.moy_sss : null, srcSss = "ffgolf";
  if (sss == null && t) { const g = golfDe(t), pc = g && parcoursJoue(g, sc.parcours), rp = pc && repereCompet(pc, sx, t); sss = rp && (sx === "D" ? rp.sss_d : rp.sss_h); srcSss = "repère"; }
  const trous = sc.trous || [], pars = sc.pars || [], parT = (k) => (pars[k] || []).reduce((a, b) => a + (b || 0), 0) || null;
  const total = tours.reduce((a, b) => a + b, 0), parTot = pars.length ? pars.reduce((a, p) => a + (p || []).reduce((x, y) => x + (y || 0), 0), 0) : null;
  const cls = (s, p) => (!s || !p ? "" : s - p <= -2 ? "eag" : s - p === -1 ? "bir" : s === p ? "par" : s - p === 1 ? "bog" : "dbl");
  const compte = (k) => { const r = { eag: 0, bir: 0, par: 0, bog: 0, dbl: 0 }; (trous[k] || []).forEach((s, i) => { const c = cls(s, pars[k]?.[i]); if (c) r[c]++; }); return r; };
  const neuf = (k, a) => { const v = (trous[k] || []).slice(a, a + 9); return v.length === 9 && v.every((x) => x > 0) ? v.reduce((x, y) => x + y, 0) : null; };
  const pastille = (val, lib) => `<div><b>${val}</b><span>${lib}</span></div>`;
  let h = `<h2 id="fiche-titre">${esc(titre(m.nom))}</h2>
    <div class="sous">${fmtDate(m.date)}${t ? ` · ${esc(titre(t.golf_nom || t.golf || ""))}` : ""}${sc.parcours ? ` · parcours ${esc(titre(sc.parcours))}` : ""}
      ${t ? ` <span class="tag circ-${circuitDe(t)}">${esc(circuitLib(t))}</span>` : ""}${m.cat ? ` <span class="tag" title="Catégorie Mérite du tournoi (force du champ, 0 à 10)">cat. Mérite ${esc(m.cat)}</span>` : ""}</div>
    <div class="cs-pastilles">
      ${pastille(esc(String(sc.place || m.place || "—")).replace(/^(\d+)/, "$1<sup>e</sup>"), sc.classes ? `sur ${sc.classes} classés` : "place")}
      ${pastille(nt ? total : "—", `total · ${nt} tour${nt > 1 ? "s" : ""}`)}
      ${parTot && trous.length === nt ? pastille(sg(total - parTot, 0), "par rapport au par") : sc.par != null ? pastille(sg(sc.par, 0), "par rapport au par") : ""}
      ${sss ? pastille(sg(total / nt - sss, 2), `par tour vs SSS (${String(Math.round(sss * 10) / 10).replace(".", ",")})`) : ""}
      ${m.points != null ? pastille(fx(m.points, 2), "points Mérite") : ""}
    </div>`;
  // tour par tour
  h += `<h3>Tour par tour</h3><div class="defile"><table class="cs-tours"><thead><tr><th>Tour</th><th class="n">Score</th><th class="n">vs par</th><th class="n">vs SSS</th>
    ${trous.length ? `<th class="n">Aller</th><th class="n">Retour</th><th class="n" title="eagles et birdies">Birdies</th><th class="n">Pars</th><th class="n">Bogeys</th><th class="n">Doubles +</th>` : ""}</tr></thead><tbody>
    ${tours.map((x, k) => { const c = compte(k), pk = parT(k);
      return `<tr><th>Tour ${k + 1}</th><td class="n"><b>${x}</b></td><td class="n">${pk ? sg(x - pk, 0) : "—"}</td><td class="n">${sss ? sg(x - sss, 1) : "—"}</td>
      ${trous.length ? `<td class="n">${neuf(k, 0) ?? "—"}</td><td class="n">${neuf(k, 9) ?? "—"}</td><td class="n">${trous[k] ? c.eag + c.bir : "—"}</td><td class="n">${trous[k] ? c.par : "—"}</td><td class="n">${trous[k] ? c.bog : "—"}</td><td class="n">${trous[k] ? c.dbl : "—"}</td>` : ""}</tr>`; }).join("")}
    </tbody></table></div>`;
  // bilan du tournoi (comme le « Trou par trou » de Mes stats) : répartition des scores et moyenne par type de trou
  if (trous.some(Boolean)) {
    const tot = { eag: 0, bir: 0, par: 0, bog: 0, dbl: 0 }, parType = { 3: [], 4: [], 5: [] };
    trous.forEach((sk, k) => (sk || []).forEach((x, i) => { const p = pars[k]?.[i]; const c = cls(x, p); if (!c) return; tot[c]++; if (parType[p]) parType[p].push(x - p); }));
    const n = Object.values(tot).reduce((a, b) => a + b, 0), nbT = n / 18;
    const cats = [["eag", "eagle ou mieux", "r-eag"], ["bir", "birdie", "r-bir"], ["par", "par", "r-par"], ["bog", "bogey", "r-bog"], ["dbl", "double ou +", "r-dbl"]];
    const pct = (v) => Math.round((100 * v) / n);
    h += `<h3>Bilan du tournoi <small class="meta">${n} trous joués</small></h3>
      <div class="cs-bilan">
        <div class="st-seg cs-seg" role="img" aria-label="${cats.map(([c, l]) => `${l} ${tot[c]}`).join(", ")}">${cats.filter(([c]) => tot[c]).map(([c, l, r]) => `<span class="${r}" style="flex:${tot[c]}" title="${l} : ${tot[c]} (${pct(tot[c])} %)"></span>`).join("")}</div>
        <div class="cs-comptes">${cats.map(([c, l, r]) => `<div><i class="${r}"></i><b>${tot[c]}</b><span>${l}${tot[c] > 1 && c !== "dbl" ? "s" : ""}</span><small>${pct(tot[c])} % · ${fx(tot[c] / nbT, 1)} / tour</small></div>`).join("")}</div>
        <div class="cs-partype">${[3, 4, 5].filter((p) => parType[p].length).map((p) => { const m = moyenne(parType[p]);
          return `<div><span>Par ${p}</span><b class="${m <= 0 ? "mieux" : m > 0.6 ? "moins" : ""}">${sg(m, 2)}</b><small>par trou · ${parType[p].length} trous</small></div>`; }).join("")}</div>
      </div>`;
  }
  // carte de score
  if (trous.some(Boolean)) {
    const ligne = (k) => { const s = trous[k] || [], p = pars[k] || [];
      const cases = (a) => Array.from({ length: 9 }, (_, i) => `<td class="n"><span class="cs-s ${cls(s[a + i], p[a + i])}">${s[a + i] || "·"}</span></td>`).join("");
      return `<tr><th>T${k + 1}</th>${cases(0)}<td class="n cs-sous">${neuf(k, 0) ?? ""}</td>${cases(9)}<td class="n cs-sous">${neuf(k, 9) ?? ""}</td><td class="n cs-tot">${tours[k] ?? ""}</td></tr>`; };
    const p0 = pars.find(Boolean) || [];
    const parCases = (a) => Array.from({ length: 9 }, (_, i) => `<td class="n">${p0[a + i] ?? ""}</td>`).join("");
    const parSous = (a) => p0.slice(a, a + 9).reduce((x, y) => x + (y || 0), 0) || "";
    // téléphone : deux demi-cartes empilées (aller, puis retour + total)
    const demi = (a, lib) => `<table class="cs-carte cs-demi"><thead><tr><th>Trou</th>${Array.from({ length: 9 }, (_, i) => `<th class="n">${a + i + 1}</th>`).join("")}<th class="n cs-sous">${lib}</th>${a ? `<th class="n cs-tot">Total</th>` : ""}</tr>
      <tr class="cs-par"><th>Par</th>${parCases(a)}<td class="n cs-sous">${parSous(a)}</td>${a ? `<td class="n cs-tot">${parSous(0) + parSous(9) || ""}</td>` : ""}</tr></thead><tbody>
      ${tours.map((_, k) => { const sk = trous[k] || [], pk = pars[k] || [];
        return `<tr><th>T${k + 1}</th>${Array.from({ length: 9 }, (_, i) => `<td class="n"><span class="cs-s ${cls(sk[a + i], pk[a + i])}">${sk[a + i] || "·"}</span></td>`).join("")}<td class="n cs-sous">${neuf(k, a) ?? ""}</td>${a ? `<td class="n cs-tot">${tours[k] ?? ""}</td>` : ""}</tr>`; }).join("")}</tbody></table>`;
    h += `<h3>Carte de score</h3><div class="cs-etroit">${demi(0, "Aller")}${demi(9, "Retour")}</div><div class="defile cs-large"><table class="cs-carte"><thead><tr><th>Trou</th>${Array.from({ length: 9 }, (_, i) => `<th class="n">${i + 1}</th>`).join("")}<th class="n cs-sous">Aller</th>
      ${Array.from({ length: 9 }, (_, i) => `<th class="n">${i + 10}</th>`).join("")}<th class="n cs-sous">Retour</th><th class="n cs-tot">Total</th></tr>
      <tr class="cs-par"><th>Par</th>${parCases(0)}<td class="n cs-sous">${parSous(0)}</td>${parCases(9)}<td class="n cs-sous">${parSous(9)}</td><td class="n cs-tot">${parSous(0) + parSous(9) || ""}</td></tr></thead>
      <tbody>${tours.map((_, k) => ligne(k)).join("")}</tbody></table></div>
      <div class="cs-legende"><span><span class="cs-s eag">3</span> eagle</span><span><span class="cs-s bir">3</span> birdie</span><span><span class="cs-s par">4</span> par</span><span><span class="cs-s bog">5</span> bogey</span><span><span class="cs-s dbl">6</span> double ou +</span></div>`;
  } else h += `<p class="meta cs-note">Pas de trou par trou pour ce tournoi : ${!t ? "il n'est pas dans le calendrier collecté par GolfNexus." : !sc.tours ? "il n'a pas été relevé avec ta licence (il faut qu'il soit dans ta saison ; relevé chaque lundi)." : "la ffgolf n'a pas publié les scores trou par trou."}</p>`;
  h += `<p class="meta">${sss ? `SSS ${srcSss === "ffgolf" ? "de la ffgolf (déduit de ta moyenne vs SSS sur ce tournoi au Mérite)" : "du repère de compétition (tournoi absent du Mérite)"}. ` : ""}${t ? `<button type="button" class="lien" data-ouvrir="${esc(t.id)}">Voir la fiche du tournoi</button>` : ""}</p>`;
  $("fiche-contenu").innerHTML = h; $("fiche").hidden = false; $("fiche-fermer").focus();
}
$("st-contenu").addEventListener("click", (e) => { const b = e.target.closest("[data-carte]"); if (b) carteScore(st.lignesT[+b.dataset.carte]); });
function lectureTours(parN) {
  if (parN.length < 2) return "";
  const a = parN[0].v, z = parN.at(-1).v, best = parN.reduce((x, y) => (y.v < x.v ? y : x));
  return z - a > 1 ? `Il finit moins bien qu'il ne commence (${sg(z - a)} entre le tour 1 et le dernier) : gestion de la pression ou de la fatigue.`
    : a - z > 1 ? `Il démarre lentement puis monte en puissance (${sg(z - a)} au dernier tour) : soigner l'entrée dans l'épreuve.`
    : `Assez constant d'un tour à l'autre ; son meilleur tour en moyenne : le tour ${best.n}.`;
}
function lecturePars(parType) {
  if (parType.length < 2) return "";
  const pire = parType.reduce((x, y) => (y.v > x.v ? y : x)), mieux = parType.reduce((x, y) => (y.v < x.v ? y : x));
  return `Le plus de coups perdus sur les <b>par ${pire.p}</b> (${sg(pire.v, 2)} par trou), le mieux sur les par ${mieux.p} (${sg(mieux.v, 2)}).` +
    (pire.p === 3 ? " Les par 3 dépendent surtout des fers et du petit jeu." : pire.p === 5 ? " Sur les par 5, la stratégie et le jeu de wedge font la différence." : " Les par 4 : mise en jeu et approche.");
}
// combien de points sur le prochain tournoi pour gagner des places (total = somme des points ÷ diviseur)
async function simulation(der) {
  const box = $("st-simu"); if (!box || !der?.place || der.total == null || !der.divisor) { if (box) box.innerHTML = ""; return; }
  try {
    // ménager ffgolf : les totaux du Mérite du mois (quelques Mo à télécharger) sont gardés dans ce navigateur pour le mois
    const cle = `gn-totaux-${st.liste}-${Saison.fiche.sexe || "H"}-${moisCourant()}`;
    let rows = null;
    try { rows = JSON.parse(localStorage.getItem(cle) || "null"); } catch { /* */ }
    if (!rows) {
      const L = await meriteListe(Saison.fiche.sexe || "H", st.liste);
      rows = (L.data || Object.values(L).find(Array.isArray) || []).map((r) => +r.TOTAL).filter((x) => !isNaN(x)).sort((a, b) => b - a);
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("gn-totaux-") && !k.endsWith(moisCourant())) localStorage.removeItem(k);
        localStorage.setItem(cle, JSON.stringify(rows)); } catch { /* stockage plein ou bloqué : tant pis */ }
    }
    const somme = der.total * der.divisor, div2 = Math.max(der.divisor, (der.nb || 0) + 1);
    const cibles = [...new Set([der.place - 10, der.place - 25, der.place - 50, 100, 50, 20, 10, 1].filter((p) => p >= 1 && p < der.place))].sort((a, b) => b - a).slice(0, 5);
    const lignes = cibles.map((p) => { const tot = rows[p - 1]; if (tot == null) return null; const pts = Math.max(0, tot * div2 - somme + 0.01); return { p, pts }; }).filter(Boolean);
    const pts = (Saison.stats?.tournois || []).filter((t) => t.liste === st.liste && t.points != null).map((t) => t.points).sort((a, b) => b - a);
    box.innerHTML = blocSt("Ce qu'il te faut pour monter", `Avec ton total actuel (${fx(der.total, 2)} = ${fx(somme, 1)} points ÷ diviseur ${der.divisor}), si tu joues un tournoi de plus et que les autres ne bougent pas :`, `
      <table class="st-simu"><thead><tr><th>Pour être</th><th>Points à marquer sur le prochain tournoi</th></tr></thead><tbody>
      ${lignes.map((x) => `<tr><td><b>${x.p}<small>e</small></b> (${der.place - x.p > 0 ? "+" + (der.place - x.p) + " places" : ""})</td><td><b>${fx(x.pts, 1)} pts</b>${pts.length ? ` <span class="meta">${x.pts <= pts[0] ? x.pts <= (pts[Math.floor(pts.length / 2)] || 0) ? "· à ta portée (comme un tournoi moyen)" : "· comme un de tes meilleurs tournois" : "· plus que ton meilleur tournoi (" + fx(pts[0], 1) + ")"}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="2">Tu es en tête : il s'agit de garder ta place !</td></tr>`}
      </tbody></table>
      <p class="meta">Repères : tes tournois ont rapporté de ${fx(pts.at(-1) ?? 0, 1)} à ${fx(pts[0] ?? 0, 1)} points (médiane ${fx(pts[Math.floor(pts.length / 2)] ?? 0, 1)}). Les points dépendent de la place et de la catégorie du tournoi. Estimation : les autres joueurs marquent aussi des points d'ici le prochain Mérite.</p>`);
  } catch { box.innerHTML = blocSt("Ce qu'il te faut pour monter", "", `<p class="meta">Mérite du mois illisible pour l'instant (hors ligne ?).</p>`); }
}
$("st-contenu").addEventListener("change", (e) => { const k = e.target.dataset?.stOpt; if (k) { st[k] = e.target.checked; rendreStats(); } });
$("st-listes").addEventListener("click", (e) => { const b = e.target.closest("[data-st-circuit]"); if (b) { st.circuit = b.dataset.stCircuit; rendreStats(); } });
// info-bulle des graphiques
{
  const bulle = $("st-bulle"), zone = $("ecran-stats");
  const montrer = (e) => {
    const c = e.target.closest("[data-tip]"); if (!c || !zone.contains(c)) { bulle.hidden = true; return; }
    bulle.innerHTML = c.dataset.tip; bulle.hidden = false;
    const r = bulle.getBoundingClientRect(), x = Math.min(window.innerWidth - r.width - 8, e.clientX + 14), y = e.clientY - r.height - 12;
    bulle.style.left = Math.max(8, x) + "px"; bulle.style.top = (y < 8 ? e.clientY + 18 : y) + "px";
  };
  zone.addEventListener("pointermove", montrer); zone.addEventListener("pointerdown", montrer);
  zone.addEventListener("pointerleave", () => { bulle.hidden = true; });
}


// ------------------------------------------------------------------ accueil et démarrage (05/11)
// Connexion, liens reçus et données publiées : briques communes (../commun/v1/nexus.js).
let demarre = false;
async function entrer() {
  if (demarre) return;
  demarre = true;
  $("accueil").classList.add("chargement");
  try { if (!D) D = await telechargerDonnees(); }
  catch (e) { demarre = false; $("accueil").classList.remove("chargement"); msgAccueil("Données inaccessibles : " + (e.message || e), true); return; }
  document.body.classList.remove("verrou");
  charger();
}
async function demarrage() {
  if (D || !sb) { document.body.classList.remove("verrou"); charger(); return; }   // test local : données intégrées
  await nexusDemarrer(entrer);
}
nexusBrancherAccueil();

// ------------------------------------------------------------------ coachs, joueurs, administration (05/11)
// Coach : DEMANDE l'accès à un joueur par sa licence ; le joueur (ou son parent pour un mineur) ACCEPTE.
// Ensuite le coach choisit le joueur dans « Vue » (bandeau) : sa saison et ses stats en lecture seule.
// coach sans fiche au Mérite amateur (cas par défaut d'un coach, ex. pro) : pas de bloc Mérite ni d'onglet « Mes stats » ;
// sa saison et sa licence restent (des tournois amateurs sont ouverts aux pros)
const coachSeul = () => (Saison.role === "coach" || Saison.role === "admin") && !Saison.demo && !(Saison.fiche || {}).joueAussi;
const STRUCTURES = { club: "club", ligue: "ligue", academie: "académie", pole: "pôle / comité", independant: "coach indépendant" };
function selecteurVue() {
  const J = Saison.joueurs || [];
  if (!J.length || Saison.role === "joueur") return "";
  const cur = Saison.demo?.coach ? Saison.demo.id : "";
  return `<select class="c-vue" id="c-vue" aria-label="Voir la saison de"><option value="">Vue : moi</option>${J.map((j) =>
    `<option value="${esc(j.joueur_id)}" ${j.joueur_id === cur ? "selected" : ""}>Vue : ${esc(j.nom || j.libelle || "joueur " + (j.licence || ""))}</option>`).join("")}</select>`;
}
async function voirJoueur(id, cible = null) {
  const j = (Saison.joueurs || []).find((x) => x.joueur_id === id); if (!j) return;
  try {
    const L = await sb.from("saisons").select("id,nom,annee").eq("user_id", id);
    const ids = (L.data || []).map((l) => l.id);
    const [I, P, R, MM, MT] = await Promise.all([
      ids.length ? sb.from("saison_tournois").select("saison_id,tournoi_id,statut,note,ajoute_le").in("saison_id", ids) : { data: [] },
      sb.from("profils").select("fiche,domicile_nom,lat,lon,licence_verif").eq("id", id).maybeSingle(),
      sb.from("resultats_perso").select("*").eq("user_id", id),
      sb.from("merite_mois").select("*").eq("user_id", id).order("mois"),
      sb.from("merite_tournois").select("*").eq("user_id", id).order("date")]);
    const err = L.error || I.error || P.error; if (err) throw err;
    const moi = { user: Saison.moi, role: Saison.role, joueurs: Saison.joueurs };
    Saison.chargerDemo({ nom: j.nom, saisons: L.data, items: I.data, profil: P.data, resultats: R.data, mois: MM.data, tournois: MT.data });
    // user reste le coach (la session ne change pas) ; demo = lecture seule (aucune écriture : Saison.base)
    Object.assign(Saison, { demo: { ...Saison.demo, coach: true, id }, user: moi.user, moi: moi.user, role: moi.role, joueurs: moi.joueurs });
    distanceDuProfil(true); rendre(); toutRafraichir();
    ecran(cible || (etat.ecran === "stats" ? "stats" : "saison"));
    signaler(`Tu regardes la saison de ${j.nom || "ce joueur"} (lecture seule).`);
  } catch (e) { signaler("Lecture impossible : " + (e.message || e)); }
}
async function revenirMoi() {
  const u = Saison.moi; if (!u) return;
  try { await Saison.connecter(u); } catch (e) { signaler("Lecture du compte impossible : " + (e.message || e)); }
  distanceDuProfil(true); rendre(); toutRafraichir(); ecran(etat.ecran === "admin" ? "admin" : etat.ecran);
}
$("vue-bandeau").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.vueEcran) ecran(b.dataset.vueEcran);
  else if ("vueRetour" in b.dataset) revenirMoi();
});
document.addEventListener("change", (e) => { if (e.target.id === "c-vue") { e.target.value ? voirJoueur(e.target.value) : revenirMoi(); } });

// ---- Mon profil : validation parentale, coachs (côté joueur), joueurs (côté coach)
async function rendreAcces() {
  const box = $("p-acces"); if (!box) return;
  if (Saison.mode !== "compte" || Saison.demo) { box.innerHTML = ""; return; }
  let h = "";
  if (Saison.role === "coach" || Saison.role === "admin") h += `<div class="bloc p-bloc"><label class="p-coche"><input type="checkbox" id="p-joue-aussi" ${(Saison.fiche || {}).joueAussi ? "checked" : ""}>
    <b>J'ai une fiche au Mérite amateur</b></label>
    <p class="meta">Coché : ta fiche Mérite et l'onglet « Mes stats ». Décoché (coach pro) : sans Mérite. Ta saison et ta licence restent dans tous les cas : des tournois amateurs sont ouverts aux pros.</p></div>`;
  if (Saison.mineur && !Saison.parentValide) h += `<div class="bloc p-bloc p-parent"><h3>Compte d'un joueur de moins de 18 ans</h3>
    <p>Ce compte est celui du <b>parent ou représentant légal</b>. C'est toi qui décides qui peut suivre le joueur (coachs).</p>
    <label><input type="checkbox" id="p-parent-ok"> Je suis le parent ou le représentant légal de ce joueur et j'accepte que ses données de golf (saison, résultats, Mérite) soient enregistrées dans GolfNexus.</label>
    <button type="button" class="btn plein" id="p-parent-valider">Valider</button></div>`;
  const C = coachSeul() ? { data: [] } : await sb.rpc("mes_coachs");
  const lib = { demande: "en attente", accepte: "accès accordé", refuse: "refusé" };
  const coachs = C.data || [];
  if (!coachSeul()) h += `<div class="bloc p-bloc"><h3>Qui te suit</h3>
    ${coachs.length ? coachs.map((c) => `<div class="acces-ligne"><div class="qui">${c.structure_nom ? `<b>${esc(c.structure_nom)}</b> · ton coach : <b>${esc(c.nom || "")}</b>${c.coachs && c.structure_type !== "independant" ? ` <span class="structure">· académie : ${esc(c.coachs)}</span>` : ""}` : `<b>${esc(c.nom || "")}</b> · <span class="structure">coach</span>`}<small>${esc(c.email || "")} · demandé le ${fmtDate(String(c.demande_le).slice(0, 10))}</small></div>
      <span class="statut-acces ${c.statut}">${lib[c.statut]}</span>
      ${c.statut !== "accepte" ? `<button type="button" class="btn plein" data-acces-ok="${esc(c.coach_id)}">Accepter</button>` : ""}
      ${c.statut === "demande" ? `<button type="button" class="btn" data-acces-non="${esc(c.coach_id)}">Refuser</button>` : ""}
      ${c.statut === "accepte" ? `<button type="button" class="btn" data-acces-fin="${esc(c.coach_id)}">Retirer l'accès</button>` : ""}</div>`).join("")
      : `<p class="meta">Personne pour l'instant. Le coach de ton club (son académie) ou ton coach demande à te suivre : la demande apparaît ici et tu choisis. Si tu acceptes ton club, tous les coachs de son académie voient ta saison et tes stats, en lecture seule ; un coach d'un autre club ne te voit que lui-même.</p>`}
    ${Saison.mineur && !Saison.parentValide && coachs.some((c) => c.statut === "demande") ? `<p class="meta">Valide d'abord le compte (encadré ci-dessus) pour pouvoir accepter un coach.</p>` : ""}</div>`;
  box.innerHTML = h;
}
async function clicAcces(e) {
  const b = e.target.closest("button"); if (!b) return;
  const moi = Saison.moi?.id;
  let r = null;
  if (b.id === "p-parent-valider") {
    if (!$("p-parent-ok").checked) { signaler("Coche la case pour confirmer."); return; }
    r = await sb.from("profils").update({ parent_valide_le: new Date().toISOString() }).eq("id", moi).select("parent_valide_le").maybeSingle();
    if (!r.error) { Saison.parentValide = r.data?.parent_valide_le; signaler("Merci, le compte est validé."); }
  } else if (b.dataset.accesOk) r = await sb.from("acces_coach").update({ statut: "accepte" }).eq("coach_id", b.dataset.accesOk).eq("joueur_id", moi);
  else if (b.dataset.accesNon) r = await sb.from("acces_coach").update({ statut: "refuse" }).eq("coach_id", b.dataset.accesNon).eq("joueur_id", moi);
  else if (b.dataset.accesFin) { if (!confirm("Retirer l'accès de ce coach ?\n\nIl ne verra plus la saison ni les stats du joueur. Pour lui redonner l'accès, il devra refaire une demande.")) return; r = await sb.from("acces_coach").delete().eq("coach_id", b.dataset.accesFin).eq("joueur_id", moi); }
  else if (b.dataset.voir) { await voirJoueur(b.dataset.voir, b.dataset.cible || "saison"); return; }
  else return;
  if (r?.error) signaler(/validation_parent/.test(r.error.message) ? "Valide d'abord le compte en tant que parent (encadré jaune)." : "Impossible : " + r.error.message);
  if (Saison.role !== "joueur") { const J = await sb.rpc("mes_joueurs"); Saison.joueurs = (J.data || []).filter((j) => j.statut === "accepte"); rendreCompte(); }
  rafraichirAcces();
}
async function envoiAcces(e) {
  if (e.target.id === "p-structure") {
    e.preventDefault();
    const type = $("p-st-type").value, nom = $("p-st-nom").value.trim();
    if (!type || !nom) { signaler("Choisis le type et indique le nom de ta structure."); return; }
    const { error } = await sb.from("profils").update({ structure_type: type, structure_nom: nom }).eq("id", Saison.moi.id);
    if (error) { signaler("Enregistrement impossible : " + error.message); return; }
    Saison.structure = { type, nom }; signaler("Structure enregistrée : les joueurs la verront dans tes demandes."); rafraichirAcces();
    return;
  }
  // demande d'accès (coach) et invitation d'un joueur : module Club
}
const rafraichirAcces = () => rendreAcces();
$("p-acces").addEventListener("click", clicAcces); $("p-acces").addEventListener("submit", envoiAcces);
$("p-acces").addEventListener("change", (e) => {
  if (e.target.id !== "p-joue-aussi") return;
  Saison.setFiche({ joueAussi: e.target.checked }); rendreCompte(); rendreProfil();
});

// ---- espace Coach et Administration : module Club (../club/), depuis le 07/11
// Club renvoie ici pour voir la saison d'un joueur (#vue=<joueur>&cible=saison|stats) ou un tournoi (#t=<id>).

// ------------------------------------------------------------------ relevé immédiat et accueil guidé (05/11)
// Relevé immédiat : la fonction Edge « releve » lance la tâche GitHub du relevé pour CE compte (au plus 1 / 24 h,
// pour ménager ffgolf) ; on recharge les données du compte 90 s puis 3 min après.
let releveEnCours = false;
async function lancerReleve(auto = false) {
  if (!sb || Saison.mode !== "compte" || Saison.demo || releveEnCours) return;
  const { data, error } = await sb.functions.invoke("releve");
  const corps = error ? await error.context?.json?.().catch(() => null) : data;
  if (error) {
    if (!auto) signaler(corps?.prochain ? `Relevé déjà fait aujourd'hui : prochain possible ${new Date(corps.prochain).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`
      : "Relevé impossible pour l'instant : " + (corps?.erreur || error.message));
    return;
  }
  releveEnCours = true; Saison.releve = "en cours"; rendreBienvenue();
  signaler("Relevé lancé : tes places obtenues et tes stats arrivent dans 1 à 2 minutes.");
  for (const attente of [90e3, 90e3, 120e3]) {
    await new Promise((r) => setTimeout(r, attente));
    if (Saison.demo || !Saison.moi) break;
    try { await Saison.connecter(Saison.moi); } catch { continue; }
    if ((Saison.stats?.mois || []).length) break;
  }
  releveEnCours = false; Saison.releve = (Saison.stats?.mois || []).length ? "fait" : null;
  toutRafraichir(); rendreBienvenue();
  if (etat.ecran === "stats") rendreStats(); else if (etat.ecran === "saison") rendreSaison();
  if (Saison.releve === "fait") signaler("Relevé terminé : « Mes stats » et tes places obtenues sont à jour.");
}
document.addEventListener("click", (e) => { if (e.target.id === "st-releve") lancerReleve(false); });

// Accueil guidé : les premières étapes, cochées au fur et à mesure ; disparaît une fois tout fait (ou masqué)
function etapesAccueil() {
  const f = Saison.fiche || {}, coach = Saison.role === "coach" || Saison.role === "admin";
  const aTournoi = Object.values(Saison.items || {}).some((o) => Object.keys(o || {}).length);
  const E = [];
  if (Saison.mineur) E.push({ ok: !!Saison.parentValide, t: "Valide le compte en tant que parent", d: "obligatoire pour un joueur de moins de 18 ans", go: "profil" });
  if (coach) {
    E.push({ ok: !!Saison.structure?.id, t: "Être rattaché à ton club", d: "c'est l'administrateur qui te rattache à ton club (ou te déclare coach indépendant)", go: "coach" });
    E.push({ ok: (Saison.joueurs || []).length > 0, t: "Ajoute tes premiers joueurs", d: "par leur licence, ou invite-les par e-mail", go: "coach" });
  }
  if (!coachSeul()) {
    E.push({ ok: !!f.merite, t: "Trouve ta fiche Mérite", d: "index, moyenne vs SSS : sert à estimer ta place", go: "profil" });
    E.push({ ok: !!Saison.licence?.num, t: "Saisis ta licence ffgolf", d: "pour retrouver tes places obtenues et tes stats", go: "profil", focus: "p-licence" });
  }
  if (Saison.role !== "coach") E.push({ ok: !!f.cp, t: "Ton code postal", d: "pour les distances jusqu'aux golfs", go: "profil", focus: "p-cp" });
  if (!coachSeul()) E.push({ ok: aTournoi, t: "Choisis tes premiers tournois", d: "l'étoile ☆ d'un tournoi l'ajoute à « Ma saison »", go: "tournois" });
  return E;
}
function rendreBienvenue() {
  const box = $("bienvenue"); if (!box) return;
  const f = Saison.fiche || {};
  if (Saison.mode !== "compte" || Saison.demo || f.accueilFini) { box.hidden = true; return; }
  const E = etapesAccueil(), faits = E.filter((x) => x.ok).length;
  if (faits === E.length && Saison.releve !== "en cours") { box.hidden = true; return; }
  box.hidden = false;
  const statsPret = (Saison.stats?.mois || []).length > 0;
  box.innerHTML = `<div class="bv-tete"><h2>Bienvenue sur GolfNexus${f.nom ? `, ${esc(String(f.nom).split(" ")[0])}` : ""} 👋</h2>
      <span class="bv-prog">${faits} / ${E.length}</span><button type="button" class="lien" id="bv-masquer">Masquer</button></div>
    <div class="bv-barre"><span style="width:${Math.round((100 * faits) / E.length)}%"></span></div>
    <ol class="bv-etapes">${E.map((x, i) => `<li class="${x.ok ? "ok" : ""}"><span class="bv-coche">${x.ok ? "✓" : i + 1}</span>
      <div><b>${x.t}</b><small>${x.d}</small></div>${x.ok ? "" : `<button type="button" class="btn" data-bv-go="${x.go}" data-bv-focus="${x.focus || ""}">Faire</button>`}</li>`).join("")}</ol>
    ${!coachSeul() && Saison.licence?.num && f.merite ? `<p class="meta">${Saison.releve === "en cours" ? "⏳ Relevé en cours : tes stats arrivent dans 1 à 2 minutes."
      : statsPret ? "✓ Tes stats sont prêtes : onglet « Mes stats »." : `Tes stats se remplissent au relevé du lundi. <button type="button" class="lien" id="st-releve">Lancer mon relevé maintenant</button>`}</p>` : ""}`;
}
$("bienvenue").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "bv-masquer") { Saison.setFiche({ accueilFini: true }); rendreBienvenue(); return; }
  if (b.dataset.bvGo) { ecran(b.dataset.bvGo); const f = b.dataset.bvFocus && $(b.dataset.bvFocus); if (f) setTimeout(() => { f.scrollIntoView({ block: "center" }); f.focus(); }, 50); }
});

// ------------------------------------------------------------------ assistant de démarrage (05/11)
// À la première connexion, un écran par étape. Obligatoires : mot de passe (si arrivé par un lien), validation
// parentale (moins de 18 ans), fiche Mérite (ou « je ne suis pas au Mérite »), structure (coach). Les autres
// (licence, code postal) proposent « Plus tard » et restent ensuite dans l'encadré d'accueil.
const asst = { etapes: [], i: 0, res: null };
function etapesAssistant() {
  const f = Saison.fiche || {}, E = [];
  E.push(...nexusEtapesCommunes(Saison));   // mot de passe, accord parental : briques communes
  if (!coachSeul() && !f.merite && !f.pasMerite) E.push("merite");
  if (!f.assistantFait) {
    if (!coachSeul() && !Saison.licence?.num) E.push("licence");
    if (!f.cp && Saison.role !== "coach") E.push("cp");   // un coach n'a pas à dire où il habite
  }
  return E;
}
const OBLIG = new Set(["mdp", "parent", "structure", "merite"]);
function ouvrirAssistant() {
  if (nexus.mdpConnu && !(Saison.fiche || {}).mdpChoisi) Saison.setFiche({ mdpChoisi: true });
  const E = etapesAssistant();
  if (!E.length) { if (!(Saison.fiche || {}).assistantFait) Saison.setFiche({ assistantFait: true }); return; }
  Object.assign(asst, { etapes: [...E, "fin"], i: 0, res: null });
  $("assistant").hidden = false; document.body.classList.add("assistant-ouvert");
  rendreAssistant();
}
function fermerAssistant() {
  $("assistant").hidden = true; document.body.classList.remove("assistant-ouvert");
  // un seul relevé, une fois la fiche Mérite ET la licence connues (sinon le 2e serait bloqué par la limite d'un par jour)
  if ((Saison.fiche || {}).merite || Saison.licence?.num) lancerReleve(true);
  Saison.setFiche({ assistantFait: true }); ecran("tournois"); rendreBienvenue();
}
function rendreAssistant() {
  const k = asst.etapes[asst.i], n = asst.etapes.length - 1, f = Saison.fiche || {}, prenom = String(f.nom || "").split(" ")[0];
  const pied = (ok, plusTard = !OBLIG.has(k)) => `<div class="as-pied">${plusTard ? `<button type="button" class="lien" data-as="passer">Plus tard</button>` : "<span></span>"}
    <button type="submit" class="btn plein">${ok}</button></div>`;
  const C = {
    mdp: NEXUS_ETAPES.mdp.html(pied("Enregistrer")),
    parent: NEXUS_ETAPES.parent.html(pied("Valider")),
    structure: `<h2>Ta structure</h2><p>Les joueurs et les parents la verront dans tes demandes d'accès : ils doivent savoir qui tu représentes.</p>
      <select id="as-st-type" required><option value="">Type…</option>${Object.entries(STRUCTURES).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <input id="as-st-nom" maxlength="80" required placeholder="ex. Golf de Massane, Ligue Occitanie…">${pied("Enregistrer")}`,
    merite: `<h2>Trouve ta fiche Mérite</h2><p>GolfNexus y lit ton index et ta moyenne par rapport au SSS : c'est ce qui sert à <b>estimer ta place</b> sur chaque tournoi et à remplir <b>« Mes stats »</b>.
      Même <b>non classé</b>, tu as une fiche dès que tu as joué des compétitions : cherche ton nom.</p>
      <div class="as-ligne"><select id="as-sexe"><option value="H">Messieurs</option><option value="D" ${f.sexe === "D" ? "selected" : ""}>Dames</option></select>
      <input id="as-nom" required minlength="2" placeholder="ton nom (et prénom)" autocomplete="family-name"></div>
      <div id="as-res">${asst.res === "…" ? "<p class='meta'>Lecture du Mérite…</p>" : Array.isArray(asst.res) ? (asst.res.length ? asst.res.map((x, i) =>
        `<button type="button" class="p-res" data-as-res="${i}"><b>${esc(x.NOM)} ${esc(x.PRENOM)}</b><span>${esc(x.CATEGORIE || "")} · ${esc(titre(x.GOLF || ""))} · ${/^\d+$/.test(String(x.RANK)) ? x.RANK + "e" : "non classé"}</span></button>`).join("")
        : "<p class='meta'>Personne de ce nom au Mérite de ce mois.</p>") : typeof asst.res === "string" ? `<p class="meta">${esc(asst.res)}</p>` : ""}</div>
      <div class="as-pied"><button type="button" class="lien" data-as="pas-merite">Je ne trouve pas ma fiche</button><button type="submit" class="btn plein">Chercher</button></div>`,
    licence: `<h2>Ta licence ffgolf</h2><p>Elle sert à retrouver <b>tes places obtenues</b> dans les résultats (et le trou par trou). Elle est sur ta carte de licence ou l'appli ffgolf. <b>Vérifie-la bien : elle ne pourra plus être changée</b> (seul l'administrateur peut la corriger).</p>
      <input id="as-lic" inputmode="numeric" pattern="[0-9 ]{6,14}" required placeholder="ex. 123456789">
      <p class="meta">Sans licence : pas de <b>places obtenues</b> dans « Ma saison », pas de <b>trou par trou</b> ni de comparaison estimée / obtenue. Modifiable une fois par mois ensuite.</p>${pied("Enregistrer")}`,
    cp: `<h2>Ton code postal</h2><p>Pour les distances jusqu'aux golfs et la carte autour de chez toi.</p>
      <input id="as-cp" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" required placeholder="ex. 34270">${pied("Enregistrer")}`,
    fin: `<h2>C'est parti${prenom ? ", " + esc(prenom) : ""} ! ⛳</h2><p>Sur la carte, clique sur un tournoi puis sur l'étoile <b>☆</b> pour l'ajouter à <b>Ma saison</b>.
      ${f.merite || Saison.licence?.num ? "Ton relevé va démarrer : « Mes stats », ta saison et tes places obtenues se remplissent dans 1 à 2 minutes." : ""}</p>
      ${asst.etapes.some((x) => ["licence", "cp"].includes(x)) ? `<p class="meta">Ce que tu as passé reste dans l'encadré « Bienvenue » en haut de la page.</p>` : ""}
      <div class="as-pied"><span></span><button type="submit" class="btn plein">Voir les tournois</button></div>`,
  }[k];
  $("as-carte").innerHTML = `${k !== "fin" ? `<div class="as-etape">Étape ${asst.i + 1} sur ${n}${OBLIG.has(k) ? "" : " · facultative"}</div>
    <div class="bv-barre"><span style="width:${Math.round((100 * asst.i) / n)}%"></span></div>` : ""}<form id="as-form">${C}</form><p class="a-msg" id="as-msg"></p>`;
  setTimeout(() => $("as-carte").querySelector("input:not([type=checkbox]),select")?.focus(), 30);
}
const suivant = () => { asst.i++; asst.res = null; rendreAssistant(); };
const msgAs = (t) => { const m = $("as-msg"); if (m) { m.textContent = t; m.classList.add("erreur"); } };
$("assistant").addEventListener("submit", async (e) => {
  e.preventDefault();
  const k = asst.etapes[asst.i], btn = e.target.querySelector("button[type=submit]");
  if (k === "fin") { fermerAssistant(); return; }
  btn.disabled = true;
  try {
    if (NEXUS_ETAPES[k]) {   // étapes communes (mot de passe, accord parental)
      await NEXUS_ETAPES[k].valider(Saison);
    } else if (k === "structure") {
      const type = $("as-st-type").value, nom = $("as-st-nom").value.trim();
      const { error } = await sb.from("profils").update({ structure_type: type, structure_nom: nom }).eq("id", Saison.moi.id); if (error) throw error;
      Saison.structure = { type, nom };
    } else if (k === "merite") {   // « Chercher » : la liste du Mérite du mois (lue une fois par session)
      const sexe = $("as-sexe").value, mots = plier($("as-nom").value).split(" ").filter(Boolean);
      asst.res = "…"; rendreAssistant(); $("as-nom").value = mots.join(" "); $("as-sexe").value = sexe;
      try { const L = await meriteListe(sexe); asst.res = (L.datas || []).filter((x) => { const n = plier(x.NOM + " " + x.PRENOM); return mots.every((w) => n.includes(w)); }).slice(0, 12); asst.sexe = sexe; }
      catch (err) { asst.res = "Mérite ffgolf illisible pour le moment : réessaie, ou « Je ne suis pas au Mérite »."; }
      rendreAssistant(); $("as-nom").value = mots.join(" "); $("as-sexe").value = sexe; return;
    } else if (k === "licence") {
      const n = $("as-lic").value.replace(/\s/g, "");
      if (!/^\d{6,12}$/.test(n)) throw new Error("6 à 12 chiffres");
      const { data, error } = await sb.from("profils").update({ licence: n }).eq("id", Saison.moi.id).select("licence,licence_le,licence_verif").maybeSingle();
      if (error) throw error; Saison.licence = { num: data.licence, le: data.licence_le, verif: data.licence_verif };
    } else if (k === "cp") {
      const cp = $("as-cp").value.trim(); if (!/^\d{5}$/.test(cp)) throw new Error("5 chiffres");
      const L = await communesDe(cp); if (!L.length) throw new Error("code postal inconnu");
      Saison.setFiche({ cp }); domicileDe(L[0], cp);
    }
    suivant();
  } catch (err) { btn.disabled = false; msgAs("Impossible : " + (err.message || err)); }
});
$("assistant").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.as === "passer") { suivant(); return; }
  if (b.dataset.as === "pas-merite") {
    if (!confirm("Sans fiche Mérite, tu perds :\n• l'estimation de ta place sur chaque tournoi,\n• l'onglet « Mes stats » (progression, régularité, Mérite mois par mois).\n\nTu pourras la relier plus tard dans « Mon profil ». Continuer sans ?")) return;
    Saison.setFiche({ pasMerite: true }); suivant(); return;
  }
  if (b.dataset.asRes != null) {
    const x = asst.res[+b.dataset.asRes]; b.disabled = true;
    try {
      Saison.setFiche({ sexe: asst.sexe, nom: Saison.fiche.nom || titre(`${x.PRENOM} ${x.NOM}`), club: Saison.fiche.club || titre(x.GOLF || "") });
      await majMerite(x.CODE, { nom: x.NOM, prenom: x.PRENOM });
      suivant();   // le relevé part à la fin de l'assistant (fiche Mérite + licence d'un coup)
    } catch (err) { b.disabled = false; msgAs("Lecture de la fiche impossible : " + (err.message || err)); }
  }
});

demarrage();
