"use strict";
// Carte · saisie COUP PAR COUP (essai, 12/11/2026) — reprend la démo validée (carte/MD_DOC/PLAN.md § V2 coup par coup).
// Le plan du trou vient d'OpenStreetMap, la photo de l'IGN (Géoplateforme, sans clé). Plans préparés à l'avance par
// outils/plans_osm.py (page/plans/<slug>.json, publiés avec Carte) ; à défaut, interrogation d'Overpass depuis le téléphone
// autour du contour OSM du golf (page/golfs-osm.json). Plan mis en cache dans ce navigateur.
// Modes : « Classique » (saisie actuelle), « Coup par coup » (une touche par coup), « Visée + résultat » (cible puis balle).
// Données : chaque trou garde ses coups dans carte_parties.trous[].coups (latitude / longitude, 6 décimales) ;
// score, putts, pénalités, mise en jeu et bunker s'en déduisent. Les pars restent ceux de la ffgolf (OSM se trompe parfois).
// Dépend de app.js : etat, sauver, rendreSaisie, signaler, esc, $, ecartPar, etat.golfs.

const CPC = (() => {
  const Z = 18, NS = "http://www.w3.org/2000/svg", VERSION_PLAN = 3;
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const POSITIONS = ["Fairway", "Rough", "Bunker", "Arbres", "Zone à pénalité", "Hors limites", "Green", "Dans le trou"];
  const CLUBS = ["Driver", "Bois", "Hybride", "Fer 5-6", "Fer 7-8", "Fer 9", "PW", "SW", "Putter"];
  const PEN = ["Hors limites", "Zone à pénalité"];
  const S = {
    mode: (() => { try { return localStorage.getItem("carte-cpc-mode") || "classique"; } catch { return "classique"; } })(),
    plans: new Map(),     // clé partie → { etat: "chargement" | "ok" | "absent" | "erreur", G: [plan par trou], info }
    travail: new Map(),   // clé partie:trou → coups en pixels locaux (balles, drops, visées)
    sel: null, panneau: null, geste: null,
    vue: null,            // zoom de la photo { i, x, y, w, h, base: [x, y, w, h] } (la page, elle, ne zoome pas sur la photo)
    doigts: new Map(), pince: null,
  };

  // ---------------------------------------------------------------- projection Web Mercator (zoom 18) ↔ latitude / longitude
  const K = 256 * 2 ** Z;
  const versPx = (lat, lon) => [(lon + 180) / 360 * K, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * K];
  const versLL = (x, y) => [+(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / K))) * 180 / Math.PI).toFixed(6), +(x / K * 360 - 180).toFixed(6)];
  const loc = (G, ll) => { const [x, y] = versPx(ll[0], ll[1]); return [x - G.o[0], y - G.o[1]]; };
  const glob = (G, p) => versLL(p[0] + G.o[0], p[1] + G.o[1]);

  // ---------------------------------------------------------------- géométrie (pixels locaux de la photo du trou)
  function dedans(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
  const metres = (G, a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * G.mpp;
  const centreDe = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  const drapeauDe = (G) => G.pin || G.trou[G.trou.length - 1];
  const formes = (G, k) => G.f.filter((f) => f.k === k && f.p.length > 2);
  function deviner(G, p) {
    if (G.green && dedans(p, G.green)) return ["Green", "contour du green"];
    if (formes(G, "bunker").some((f) => dedans(p, f.p))) return ["Bunker", "contour du bunker"];
    if (formes(G, "water_hazard").some((f) => dedans(p, f.p))) return ["Zone à pénalité", "contour de la zone à pénalité"];
    if (formes(G, "fairway").some((f) => dedans(p, f.p))) return ["Fairway", "contour du fairway"];
    return ["Rough", "hors des contours dessinés"];
  }
  function clubPour(m, surGreen) { if (surGreen) return "Putter"; return m > 200 ? "Driver" : m > 180 ? "Bois" : m > 160 ? "Hybride" : m > 140 ? "Fer 5-6" : m > 115 ? "Fer 7-8" : m > 95 ? "Fer 9" : m > 60 ? "PW" : "SW"; }
  function cote(G, p) {
    const L = G.trou; let best = null;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
      if (!best || d < best.d) best = { d, x: dx * (p[1] - a[1]) - dy * (p[0] - a[0]) };
    }
    return best.x < 0 ? "gauche" : "droite";
  }
  function ecart(G, de, vise, p) {
    const ax = vise[0] - de[0], ay = vise[1] - de[1], L = Math.hypot(ax, ay) || 1, ux = ax / L, uy = ay / L, vx = p[0] - de[0], vy = p[1] - de[1];
    return { lat: (ux * vy - uy * vx) * G.mpp, lon: (vx * ux + vy * uy - L) * G.mpp, vise: L * G.mpp };
  }
  const texteEcart = (e) => `${Math.abs(e.lat) < 2 ? "dans l'axe" : Math.round(Math.abs(e.lat)) + " m " + (e.lat > 0 ? "à droite" : "à gauche")}, ${Math.abs(e.lon) < 3 ? "bonne longueur" : Math.round(Math.abs(e.lon)) + " m " + (e.lon > 0 ? "long" : "court")}`;

  // ---------------------------------------------------------------- chargement du plan (OSM + IGN)
  const cleP = (p) => `${p.golf}|${p.parcours || p.parcours_nom || ""}`;
  const plier = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const VIDES = new Set(["golf", "de", "du", "des", "la", "le", "les", "club", "country", "gc", "cc", "d", "l", "et", "en", "sur", "parcours", "trou"]);
  const mots = (s) => plier(s).split(" ").filter((w) => w.length > 1 && !VIDES.has(w));
  async function overpass(q) {
    let derniere;
    for (const u of OVERPASS) {
      try {
        const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout?.(30000) });
        if (!r.ok) { derniere = new Error("Overpass " + r.status); continue; }
        return await r.json();
      } catch (e) { derniere = e; }
    }
    throw derniere || new Error("Overpass injoignable");
  }
  const geomDe = (x) => (x.geometry || []).map((g) => [g.lat, g.lon]);
  // golf ffgolf → [lat, lon du contour OSM, nombre de trous dessinés (-1 : inconnu), élément OSM] (outils/plans_osm.py)
  let golfsOsm = null;
  const lireGolfsOsm = async () => (golfsOsm ||= fetch("golfs-osm.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  async function donneesGolf(g) {
    try { const r = await fetch(`plans/${encodeURIComponent(g.slug)}.json`); if (r.ok) { const d = await r.json(); return { d, source: "plan préparé " + (d.date || "") }; } } catch { /* pas de plan préparé */ }
    const M = (await lireGolfsOsm())[g.slug];
    if (M && M[2] === 0) return { raison: "trous non dessinés dans OpenStreetMap" };
    const [la, lo] = M ? M : [g.lat, g.lon];
    if (!la) return { raison: "golf sans position GPS" };
    const s = la - 0.013, w = lo - 0.018, n = la + 0.013, e = lo + 0.018;
    const d = await overpass(`[out:json][timeout:60];(way["golf"](${s},${w},${n},${e});node["golf"="pin"](${s},${w},${n},${e});relation["golf"](${s},${w},${n},${e}););out geom;`);
    return { d, source: "Overpass" + (M ? " · " + M[3] : "") };
  }
  function planTrou(holeWay, tout, t) {
    let L = geomDe(holeWay);
    const pas = (L) => L.map(([la, lo]) => versPx(la, lo));
    const greens = tout.filter((x) => x.tags?.golf === "green");
    const greenC = greens.map((x) => centreDe(pas(geomDe(x))));
    // sens du trou : départ → green (on retourne la ligne si son début est plus près d'un green)
    const proche = (q) => Math.min(Infinity, ...greenC.map((c) => Math.hypot(c[0] - q[0], c[1] - q[1])));
    const P = pas(L);
    if (greenC.length && proche(P[0]) < proche(P[P.length - 1])) L = L.reverse();
    const Pa = pas(L), mpp = 156543.03392 * Math.cos(L[0][0] * Math.PI / 180) / 2 ** Z, m = 60 / mpp;
    let x0 = Math.min(...Pa.map((q) => q[0])) - m, x1 = Math.max(...Pa.map((q) => q[0])) + m, y0 = Math.min(...Pa.map((q) => q[1])) - m, y1 = Math.max(...Pa.map((q) => q[1])) + m;
    const o = [Math.floor(x0 / 256) * 256, Math.floor(y0 / 256) * 256];
    const tuiles = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++)
      for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) tuiles.push([tx, ty]);
    const G = { o, mpp, tuiles, f: [], osm: holeWay.id, ref: holeWay.tags?.ref, nom: holeWay.tags?.name || "", parOsm: +holeWay.tags?.par || null };
    const L2 = (geo) => geo.map(([la, lo]) => { const [x, y] = versPx(la, lo); return [+(x - o[0]).toFixed(1), +(y - o[1]).toFixed(1)]; });
    G.trou = L2(L);
    for (const x of tout) {
      const k = x.tags?.golf;
      if (!["tee", "green", "fairway", "bunker", "water_hazard", "lateral_water_hazard", "pin"].includes(k)) continue;
      const geo = x.type === "node" ? [[x.lat, x.lon]] : geomDe(x);
      if (!geo.length) continue;
      const pp = pas(geo);
      if (!pp.some(([px, py]) => px > x0 && px < x1 && py > y0 && py < y1)) continue;
      G.f.push({ k: k.includes("water") ? "water_hazard" : k, p: L2(geo) });
    }
    const fin = G.trou[G.trou.length - 1];
    G.green = (G.f.find((f) => f.k === "green" && f.p.length > 2 && dedans(fin, f.p)) || {}).p || null;
    if (!G.green) {
      const c = G.f.filter((f) => f.k === "green" && f.p.length > 2).map((f) => [Math.min(...f.p.map((q) => Math.hypot(q[0] - fin[0], q[1] - fin[1]))) * mpp, f.p]).filter((x) => x[0] < 35).sort((a, b) => a[0] - b[0]);
      G.green = c.length ? c[0][1] : null;
    }
    const pin = G.f.find((f) => f.k === "pin" && G.green && dedans(f.p[0], G.green));
    G.pin = pin ? pin.p[0] : null;
    G.f = G.f.filter((f) => f.k !== "pin");
    G.w = Math.ceil((x1 - o[0]) / 256) * 256 + 256; G.h = Math.ceil((y1 - o[1]) / 256) * 256 + 256;
    return G;
  }
  async function construirePlan(p) {
    const g = etat.golfs?.[p.golf];
    if (!g) return { etat: "absent", raison: "golf inconnu" };
    const { d, source, raison } = await donneesGolf(g);
    if (!d) return { etat: "absent", raison };
    const c = { nom: g.nom, source };
    // relations (greens / bunkers en multipolygone) : on garde le contour extérieur
    const tout = [];
    for (const e of d.elements || []) {
      if (e.type === "relation") for (const m of e.members || []) { if (m.role === "outer" && m.geometry) tout.push({ type: "way", id: e.id, tags: e.tags, geometry: m.geometry }); }
      else tout.push(e);
    }
    const trous = tout.filter((x) => x.type === "way" && x.tags?.golf === "hole");
    if (!trous.length) return { etat: "absent", raison: "trous non dessinés dans OpenStreetMap", contour: c };
    // plusieurs parcours sur le golf : le nom du parcours dans le nom du trou, sinon le par ffgolf, sinon la continuité
    const P = (g.parcours || []).find((x) => x.code === p.parcours) || {};
    const ici = new Set(mots(P.nom || p.parcours_nom)), autres = new Set((g.parcours || []).filter((x) => x !== P).flatMap((x) => mots(x.nom)).filter((w) => !ici.has(w)));
    const G = [];
    let prec = null;
    for (const t of p.trous) {
      const cand = trous.filter((x) => String(x.tags.ref || "").trim() === String(t.t));
      if (!cand.length) { G.push(null); continue; }
      const note = (x) => {
        const n = mots(x.tags.name || x.tags["golf:course:name"] || "");
        let s = n.some((w) => ici.has(w)) ? 100 : 0;
        if (n.some((w) => autres.has(w))) s -= 100;
        if (+x.tags.par === t.par) s += 20;
        if (prec) { const q = versPx(x.geometry[0].lat, x.geometry[0].lon); s -= Math.min(...[prec[0], prec[1]].map((r) => Math.hypot(r[0] - q[0], r[1] - q[1]))) / 300; }
        return s;
      };
      const h = cand.sort((a, b) => note(b) - note(a))[0];
      const plan = planTrou(h, tout, t);
      G.push(plan);
      const L = plan.trou; prec = [[L[0][0] + plan.o[0], L[0][1] + plan.o[1]], [L[L.length - 1][0] + plan.o[0], L[L.length - 1][1] + plan.o[1]]];
    }
    if (!G.some(Boolean)) return { etat: "absent", raison: "numéros de trous absents dans OpenStreetMap", contour: c };
    // départ automatique : le rang de plateforme dont la somme colle à la longueur ffgolf du repère
    // rang du départ = place du repère parmi ceux du parcours, du plus long au plus court (Blancs 0, Jaunes 1…) ;
    // un trou qui a moins de plateformes prend la plus proche. (Les longueurs OSM sont ~5 % plus courtes que la ffgolf :
    // on ne compare pas les sommes en absolu ; elles sont gardées pour les retours.)
    const RR = (P.reperes || []).filter((r) => r.distance).sort((a, b) => b.distance - a.distance);
    const rang = Math.max(0, RR.findIndex((r) => plier(r.couleur) === plier(p.repere)));
    const dessines = G.filter(Boolean);
    c.sommes = [0, 1, 2, 3].map((k) => Math.round(dessines.reduce((a, Gi) => { const T = plateformes(Gi); return a + (T.length ? longueurDepuis(Gi, T[Math.min(k, T.length - 1)]) : 0); }, 0)));
    return { etat: "ok", G, rang, contour: c, v: VERSION_PLAN };
  }
  // position d'un point par rapport à la ligne de jeu : distance à la ligne et abscisse (en pixels) depuis le début
  function surLigne(G, p) {
    const L = G.trou; let best = { d: Infinity, s: 0 }, cum = 0;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), d = Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
      if (d < best.d) best = { d, s: cum + u * Math.sqrt(l2) };
      cum += Math.sqrt(l2);
    }
    return { ...best, tot: cum };
  }
  // longueur du trou depuis un départ, le long de la ligne de jeu (les doglegs comptent, comme les distances ffgolf)
  function longueurDepuis(G, c) { const q = surLigne(G, c); return ((q.tot - q.s) + (q.s < 1 ? Math.hypot(c[0] - G.trou[0][0], c[1] - G.trou[0][1]) : 0)) * G.mpp; }
  // plateformes de départ du trou : près de la ligne de jeu (30 m), dans sa première moitié ; de la plus loin à la plus près du drapeau
  // (les départs d'un même trou peuvent être espacés de plus de 100 m : départs avancés)
  function plateformes(G) {
    if (G._dep) return G._dep;
    const d = drapeauDe(G);
    const T = formes(G, "tee").map((f) => centreDe(f.p)).filter((c) => { const q = surLigne(G, c); return q.d * G.mpp < 30 && q.s < q.tot * 0.55; })
      .sort((x, y) => longueurDepuis(G, y) - longueurDepuis(G, x));
    Object.defineProperty(G, "_dep", { value: T, enumerable: false });   // pas dans le cache JSON
    return T;
  }
  function charger(p) {
    const k = cleP(p) + "|" + p.trous.map((t) => t.t).join(",") + "|" + (p.repere || "");
    if (S.plans.has(k)) return S.plans.get(k);
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem("carte-cpc:" + k) || "null"); } catch { /* */ }
    if (cache && cache.v === VERSION_PLAN && cache.etat === "ok") { S.plans.set(k, cache); return cache; }
    const P = { etat: "chargement" };
    S.plans.set(k, P);
    construirePlan(p).then((r) => {
      S.plans.set(k, r);
      if (r.etat === "ok") try { localStorage.setItem("carte-cpc:" + k, JSON.stringify(r)); } catch { /* place pleine : pas de cache */ }
    }).catch((e) => { S.plans.set(k, { etat: "erreur", raison: e.message || String(e) }); })
      .finally(() => { if (etat.ecran === "saisie" && etat.partie === p) rendreSaisie(); });
    return P;
  }
  const planDe = (p) => charger(p);
  const geo = (i) => { const P = planDe(etat.partie); return P.etat === "ok" ? P.G[i] : null; };

  // ---------------------------------------------------------------- coups du trou : stockés en lat/lon, travaillés en pixels locaux
  function travail(i) {
    const p = etat.partie, t = p.trous[i], G = geo(i), k = (p.id || "") + ":" + i;
    let W = S.travail.get(k);
    if (!W || W.G !== G) {
      W = { G, coups: (t.coups || []).map((c) => ({ ...c, p: loc(G, c.ll), drop: c.drop ? loc(G, c.drop) : null, vise: c.vise ? loc(G, c.vise) : null })), dep: t.dep ? loc(G, t.dep) : null, viseEnCours: null };
      S.travail.set(k, W);
    }
    return W;
  }
  const departDu = (i) => { const W = travail(i), G = W.G; if (W.dep) return W.dep; const T = plateformes(G); return T.length ? T[Math.min(planDe(etat.partie).rang ?? 1, T.length - 1)] : G.trou[0]; };
  function origines(i) {
    const W = travail(i); let o = departDu(i);
    return W.coups.map((c) => { const de = o; o = c.pos === "Hors limites" ? de : c.pos === "Zone à pénalité" ? (c.drop || c.p) : c.p; return de; });
  }
  const prochaineOrigine = (i) => { const W = travail(i), C = W.coups; if (!C.length) return departDu(i); const O = origines(i), c = C[C.length - 1]; return c.pos === "Hors limites" ? O[O.length - 1] : c.pos === "Zone à pénalité" ? (c.drop || c.p) : c.p; };
  const dropAttendu = (W) => W.coups.findIndex((c) => c.pos === "Zone à pénalité" && !c.drop);
  function recalculer(i) {
    const W = travail(i), G = W.G;
    W.coups.forEach((c) => { if (c.devine) { const [pos, raison] = deviner(G, c.p); c.pos = pos; c.raison = raison; } if (c.pos !== "Zone à pénalité") c.drop = null; });
    const O = origines(i);
    W.coups.forEach((c, k) => { if (!c.clubMain) c.club = clubPour(metres(G, O[k], c.p), k > 0 && W.coups[k - 1].pos === "Green"); });
    const j = W.coups.findIndex((c) => c.pos === "Dans le trou");
    if (j >= 0) W.coups.splice(j + 1);
  }
  // écrit les coups dans la carte (lat/lon) et en déduit les champs classiques ; sans coup, la saisie classique reste intacte
  function ecrire(i) {
    const t = etat.partie.trous[i], W = travail(i), G = W.G, C = W.coups, avait = !!t.coups?.length;
    t.coups = C.map((c) => {
      const o = { ll: glob(G, c.p), pos: c.pos, club: c.club };
      if (c.devine) o.devine = true;
      if (c.clubMain) o.clubMain = true;
      if (c.drop) o.drop = glob(G, c.drop);
      if (c.vise) o.vise = glob(G, c.vise);
      return o;
    });
    if (W.dep) t.dep = glob(G, W.dep); else delete t.dep;
    if (!C.length) { delete t.coups; if (avait) { t.score = null; t.putts = null; t.pen = null; t.fw = null; t.bunker = null; t.puttsVu = false; } return; }
    const der = C[C.length - 1].pos;
    t.pen = C.filter((c) => PEN.includes(c.pos)).length;
    t.bunker = C.some((c) => c.pos === "Bunker");
    if (t.par > 3) { const c = C[0]; t.fw = c.pos === "Fairway" ? "fairway" : c.pos === "Green" || c.pos === "Dans le trou" ? null : cote(G, c.p); }
    if (der === "Dans le trou") { t.putts = 0; t.score = C.length + t.pen; }
    else if (der === "Green") { if (t.putts == null || (t.putts === 0 && !t.puttsVu)) t.putts = 2; t.score = C.length + t.putts + t.pen; }
    else if (t.puttsVu && t.putts != null && !PEN.includes(der)) t.score = C.length + t.putts + t.pen;   // putts saisis : le dernier coup a fini sur le green
    else t.score = null;
  }
  const actif = (i) => S.mode !== "classique" && !!geo(i);
  const aDesCoups = (i) => actif(i) && travail(i).coups.length > 0;

  // ---------------------------------------------------------------- dessin
  const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const pts = (p) => p.map((q) => q.join(",")).join(" ");
  function repere(G) {
    const a = G.trou[0], b = drapeauDe(G), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), th = -Math.PI / 2 - ang;
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, co = Math.cos(th), si = Math.sin(th);
    const rot = (p) => [cx + (p[0] - cx) * co - (p[1] - cy) * si, cy + (p[0] - cx) * si + (p[1] - cy) * co];
    const R = G.trou.concat([b]).map(rot); if (G.green) R.push(...G.green.map(rot));
    let x0 = Math.min(...R.map((q) => q[0])), x1 = Math.max(...R.map((q) => q[0])), y0 = Math.min(...R.map((q) => q[1])) - 60, y1 = Math.max(...R.map((q) => q[1])) + 50;
    const lmin = (y1 - y0) * 0.62; if (x1 - x0 < lmin) { const m = (x0 + x1) / 2; x0 = m - lmin / 2; x1 = m + lmin / 2; } else { x0 -= 40; x1 += 40; }
    return { deg: th * 180 / Math.PI, cx, cy, rot, view: [x0, y0, x1 - x0, y1 - y0] };
  }
  const tuile = (tx, ty) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}&FORMAT=image/jpeg`;
  function dessiner(i) {
    const svg = $("cpc-svg"); if (!svg) return;
    const W = travail(i), G = W.G, Rp = repere(G), mode = S.mode;
    if (!S.vue || S.vue.i !== i) S.vue = { i, x: Rp.view[0], y: Rp.view[1], w: Rp.view[2], h: Rp.view[3], base: Rp.view };
    appliquerVue();
    svg.replaceChildren();
    const g = el("g", { transform: `rotate(${Rp.deg.toFixed(2)} ${Rp.cx} ${Rp.cy})`, id: "cpc-photo" });
    for (const [tx, ty] of G.tuiles) g.append(el("image", { href: tuile(tx, ty), x: tx * 256 - G.o[0], y: ty * 256 - G.o[1], width: 256.6, height: 256.6, preserveAspectRatio: "none" }));
    for (const f of formes(G, "fairway")) g.append(el("polygon", { points: pts(f.p), fill: "#9fe3a8", "fill-opacity": .2, stroke: "#d6f7da", "stroke-width": 1.4, "stroke-opacity": .8 }));
    for (const f of formes(G, "tee")) g.append(el("polygon", { points: pts(f.p), fill: "#8fd19e", "fill-opacity": .45, stroke: "#d8f5df", "stroke-width": 1.2 }));
    for (const f of formes(G, "green")) g.append(el("polygon", { points: pts(f.p), fill: "#57c46b", "fill-opacity": f.p === G.green ? .45 : .2, stroke: "#eaffee", "stroke-width": f.p === G.green ? 2.4 : 1 }));
    for (const f of formes(G, "water_hazard")) g.append(el("polygon", { points: pts(f.p), fill: "#4aa3df", "fill-opacity": .5, stroke: "#cfeaff", "stroke-width": 1.4 }));
    for (const f of formes(G, "bunker")) g.append(el("polygon", { points: pts(f.p), fill: "#e8cf8f", "fill-opacity": .85, stroke: "#fff3cf", "stroke-width": 1.4 }));
    g.append(el("polyline", { points: pts(G.trou), fill: "none", stroke: "#fff", "stroke-width": 2.5, "stroke-dasharray": "9 7", "stroke-opacity": .8 }));
    svg.append(g);
    const d = Rp.rot(drapeauDe(G)), mat = el("g", { transform: `translate(${d[0]},${d[1]})` });
    mat.append(el("line", { x1: 0, y1: 0, x2: 0, y2: -32, stroke: "#fff", "stroke-width": 3 }), el("polygon", { points: "0,-32 20,-26 0,-20", fill: "#e5484d" }));
    svg.append(mat);
    const O = origines(i), etiquettes = [];
    const txt = (gg, x, y, v, taille, coul) => { const e = el("text", { "text-anchor": "middle", x, y, "font-size": taille, "font-weight": 800, fill: coul, "font-family": "inherit" }); e.textContent = v; gg.append(e); };
    W.coups.forEach((c, k) => {
      const a = Rp.rot(O[k]), q = Rp.rot(c.p), hl = c.pos === "Hors limites";
      svg.append(el("line", { x1: a[0], y1: a[1], x2: q[0], y2: q[1], stroke: hl ? "#ff6b6b" : "#ffd23f", "stroke-width": 3, "stroke-linecap": "round", "stroke-dasharray": hl ? "8 6" : "none" }));
      etiquettes.push([(a[0] + q[0]) / 2, (a[1] + q[1]) / 2, Math.round(metres(G, O[k], c.p)) + " m"]);
      if (c.pos === "Zone à pénalité" && c.drop) { const r = Rp.rot(c.drop); svg.append(el("line", { x1: q[0], y1: q[1], x2: r[0], y2: r[1], stroke: "#8fd3ff", "stroke-width": 2.5, "stroke-dasharray": "4 5" })); }
    });
    for (const [x, y, v] of etiquettes) {
      const g2 = el("g", { transform: `translate(${x + 16},${y})`, "pointer-events": "none" });
      g2.append(el("rect", { x: -4, y: -11, width: v.length * 8.4 + 8, height: 20, rx: 6, fill: "rgba(15,23,18,.82)" }));
      const e2 = el("text", { x: 0, y: 4, "font-size": 13, "font-weight": 700, fill: "#fff", "font-family": "inherit" }); e2.textContent = v; g2.append(e2);
      svg.append(g2);
    }
    const cible = (q, attrs) => { const g3 = el("g", { transform: `translate(${q[0]},${q[1]})`, class: "cpc-balle", ...attrs });
      g3.append(el("circle", { r: 22, fill: "transparent" }), el("circle", { r: 9, fill: "rgba(0,0,0,.25)", stroke: "#fff", "stroke-width": 2.5 }),
        el("line", { x1: -14, y1: 0, x2: 14, y2: 0, stroke: "#fff", "stroke-width": 2 }), el("line", { x1: 0, y1: -14, x2: 0, y2: 14, stroke: "#fff", "stroke-width": 2 })); svg.append(g3); };
    W.coups.forEach((c, k) => { if (!c.vise) return;
      const a = Rp.rot(O[k]), v = Rp.rot(c.vise), q = Rp.rot(c.p);
      svg.append(el("line", { x1: a[0], y1: a[1], x2: v[0], y2: v[1], stroke: "#fff", "stroke-width": 1.8, "stroke-dasharray": "3 6", "stroke-opacity": .9 }));
      svg.append(el("line", { x1: v[0], y1: v[1], x2: q[0], y2: q[1], stroke: "#ff9f43", "stroke-width": 2.5, "stroke-dasharray": "2 4" }));
      cible(v, { "data-vise": k }); });
    if (W.viseEnCours && mode === "visee") { const a = Rp.rot(prochaineOrigine(i)), v = Rp.rot(W.viseEnCours);
      svg.append(el("line", { x1: a[0], y1: a[1], x2: v[0], y2: v[1], stroke: "#fff", "stroke-width": 2, "stroke-dasharray": "3 6" })); cible(v, { "data-vise-attente": 1 }); }
    { const q = Rp.rot(departDu(i)), b = el("g", { transform: `translate(${q[0]},${q[1]})`, "data-depart": 1, class: "cpc-balle" });
      b.append(el("circle", { r: 26, fill: "transparent" }), el("circle", { r: 12, fill: "#fff", stroke: "#1c2a20", "stroke-width": 2 })); txt(b, 0, 5, "D", 13, "#1c2a20"); svg.append(b); }
    W.coups.forEach((c, k) => { if (c.pos !== "Zone à pénalité" || !c.drop) return;
      const q = Rp.rot(c.drop), b = el("g", { transform: `translate(${q[0]},${q[1]})`, "data-drop": k, class: "cpc-balle" });
      b.append(el("circle", { r: 24, fill: "transparent" }), el("circle", { r: 10, fill: "#8fd3ff", stroke: "#0b3a57", "stroke-width": 2 })); txt(b, 0, 4, "d", 12, "#0b3a57"); svg.append(b); });
    W.coups.forEach((c, k) => {
      const q = Rp.rot(c.p), sel = S.sel === k, hl = c.pos === "Hors limites", b = el("g", { transform: `translate(${q[0]},${q[1]})`, "data-balle": k, class: "cpc-balle" });
      b.append(el("circle", { r: 26, fill: "transparent" }));
      if (sel) b.append(el("circle", { r: 19, fill: "none", stroke: "#fff", "stroke-width": 3.5 }));
      b.append(el("circle", { r: sel ? 14 : 12, fill: hl ? "#ff6b6b" : c.pos === "Zone à pénalité" ? "#4aa3df" : "#ffd23f", stroke: "#1c2a20", "stroke-width": 2 }));
      txt(b, 0, 5, k + 1, 14, "#1c2a20"); svg.append(b);
    });
  }

  // ---------------------------------------------------------------- blocs HTML insérés dans la saisie de Carte
  // plan déjà connu (mémoire ou cache), sans rien télécharger : en mode classique on n'interroge pas OpenStreetMap
  function planConnu(p) {
    const k = cleP(p) + "|" + p.trous.map((t) => t.t).join(",") + "|" + (p.repere || "");
    if (S.plans.has(k)) return S.plans.get(k);
    try { const c = JSON.parse(localStorage.getItem("carte-cpc:" + k) || "null"); if (c && c.v === VERSION_PLAN) return c; } catch { /* */ }
    return null;
  }
  function bascule(i) {
    const p = etat.partie, P = S.mode === "classique" ? planConnu(p) : planDe(p), G = P?.etat === "ok" ? P.G[i] : null;
    if (S.mode === "classique" && P && P.etat !== "chargement" && !G) return "";   // on sait déjà que ce trou n'a pas de plan
    const info = S.mode === "classique" || G ? "" : P.etat === "chargement" ? "Recherche du plan du trou dans OpenStreetMap…"
      : P.etat === "ok" ? `Trou ${p.trous[i].t} pas dessiné dans OpenStreetMap : utilise la saisie classique.`
      : `Coup par coup indisponible ici : ${P.raison || "plan introuvable"}. Utilise la saisie classique.`;
    return `${info ? `<p class="cpc-info">${esc(info)}</p>` : ""}<div class="cpc-bascule" role="group" aria-label="Mode de saisie"><button type="button" data-cpc-mode="classique" aria-pressed="${S.mode === "classique"}">Classique</button><button type="button" data-cpc-mode="cpc" aria-pressed="${S.mode === "cpc"}">Coup par coup</button><button type="button" data-cpc-mode="visee" aria-pressed="${S.mode === "visee"}">Visée + résultat</button></div><span class="cpc-essai">essai</span>`;
  }
  function aide(i) {
    const W = travail(i), C = W.coups, fini = C.length && ["Green", "Dans le trou"].includes(C[C.length - 1].pos);
    if (dropAttendu(W) >= 0) return `Coup ${dropAttendu(W) + 1} dans la zone à pénalité (+1) : touche la photo là où tu as droppé`;
    if (S.sel != null && C[S.sel]) return `Coup ${S.sel + 1} sélectionné : fais-le glisser, ou touche la photo pour le déplacer. Touche-le encore pour le lâcher.`;
    if (fini) return C[C.length - 1].pos === "Green" ? "Balle sur le green : indique les putts" : "Balle dans le trou";
    if (S.mode === "visee") return W.viseEnCours ? `Coup ${C.length + 1} : touche maintenant là où la balle a fini` : `Coup ${C.length + 1} : touche d'abord l'endroit que tu vises (ou « 🎯 Le drapeau »)`;
    if (C.length) return C[C.length - 1].pos === "Hors limites" ? `Hors limites (+1) : tu rejoues d'où tu avais joué. Touche la photo là où a fini le coup ${C.length + 1}` : `Touche la photo là où a fini le coup ${C.length + 1}`;
    return "Touche la photo là où a fini ton départ";
  }
  function bloc(i) {
    const W = travail(i), G = W.G, C = W.coups, O = origines(i), t = etat.partie.trous[i];
    const fini = C.length && ["Green", "Dans le trou"].includes(C[C.length - 1].pos);
    let lg = 0; for (let k = 0; k < G.trou.length - 1; k++) lg += metres(G, G.trou[k], G.trou[k + 1]);
    const lignes = C.map((c, k) => {
      const d = Math.round(metres(G, O[k], c.p)), r = Math.round(metres(G, c.p, drapeauDe(G)));
      return `<li class="cpc-coup${S.sel === k ? " choisi" : ""}"><button type="button" class="cpc-resume" data-cpc-ouvrir="${k}"><b>${k + 1}</b><span>${esc(c.club || "")} · <strong>${d} m</strong></span><span class="cpc-pos">${esc(c.pos)}</span>${c.vise ? `<span class="cpc-ecart">${texteEcart(ecart(G, O[k], c.vise, c.p))}</span>` : ""}<span class="cpc-reste">${c.pos === "Dans le trou" ? "dans le trou" : c.pos === "Green" ? r + " m du drapeau" : "reste " + r + " m"}</span></button></li>`;
    }).join("");
    return `<div class="cpc">
      <p class="cpc-aide" aria-live="polite">${aide(i)}</p>
      <div class="cpc-carte"><svg id="cpc-svg" role="img" aria-label="Photo aérienne du trou ${t.t}, départ en bas, green en haut"></svg>
        <div class="cpc-zoom"><button type="button" data-cpc-zoom="1.6" aria-label="Rapprocher la photo">+</button><button type="button" data-cpc-zoom="0.625" aria-label="Éloigner la photo">−</button></div>
        <span class="cpc-long">${Math.round(lg)} m</span></div>
      <div class="cpc-outils">${S.mode === "visee" && !fini ? `<button type="button" class="btn" data-cpc-drapeau>🎯 Le drapeau</button>` : ""}<button type="button" class="btn" data-cpc-gps>📍 Ma balle est ici</button><button type="button" class="btn" data-cpc-annuler ${C.length || W.viseEnCours ? "" : "disabled"}>Annuler le dernier coup</button></div>
      ${C.length ? `<ol class="cpc-liste">${lignes}</ol>` : ""}
      <p class="cpc-pied"><button type="button" class="lien" data-cpc-retour>Signaler un problème sur ce trou</button> · <span>Plan © contributeurs OpenStreetMap · photo IGN</span></p>
    </div>`;
  }
  function panneauHTML(i) {
    const P = S.panneau, W = travail(i), G = W.G, C = W.coups, t = etat.partie.trous[i];
    const pied = (html) => `<div class="pan-pied">${html}</div>`;
    let corps;
    if (P.type === "depart") {
      corps = `<div class="pan-tete"><b>Départ</b><button type="button" class="pan-x" data-cpc-fermer aria-label="Fermer">×</button></div>
        <p>Départ${etat.partie.repere ? ` des <b>${esc(etat.partie.repere)}</b>` : ""}, placé d'après le repère de ta carte. Seulement si le départ est ailleurs aujourd'hui (travaux, départ avancé) : fais glisser la balle <b>D</b>.</p>
        ${pied(`${W.dep ? `<button type="button" class="lien" data-cpc-dep-auto>Remettre le départ prévu</button>` : ""}<button type="button" class="btn plein" data-cpc-fermer>OK</button>`)}`;
    } else {
      const k = P.k, c = C[k]; if (!c) { S.panneau = null; return ""; }
      const O = origines(i), d = Math.round(metres(G, O[k], c.p)), r = Math.round(metres(G, c.p, drapeauDe(G)));
      const fini = c.pos === "Green" || c.pos === "Dans le trou", dernier = k === C.length - 1;
      corps = `<div class="pan-tete"><b>Coup ${k + 1}</b><span>${d} m · ${c.pos === "Dans le trou" ? "dans le trou" : c.pos === "Green" ? r + " m du drapeau" : "reste " + r + " m"}</span><button type="button" class="pan-x" data-cpc-fermer aria-label="Fermer">×</button></div>
        ${c.vise ? (() => { const e = ecart(G, O[k], c.vise, c.p); return `<p class="pan-ecart">Visé <b>${Math.round(e.vise)} m</b> · ${texteEcart(e)}</p>`; })() : ""}
        <h3>Où a fini la balle ?</h3>
        <div class="sa-choix cpc-puces" role="group" aria-label="Position">${POSITIONS.map((x) => `<button type="button" data-cpc-pos="${k}" data-val="${x}" aria-pressed="${x === c.pos}">${x}</button>`).join("")}</div>
        ${c.devine ? `<p class="cpc-devine">Deviné : ${esc(c.raison || "")}.</p>` : ""}
        ${c.pos === "Hors limites" ? `<p class="cpc-regle"><b>+1 pénalité</b> : tu rejoues d'où tu avais joué.</p>` : ""}
        ${c.pos === "Zone à pénalité" ? `<p class="cpc-regle"><b>+1 pénalité</b> : ${c.drop ? "drop placé (balle « d »), fais-le glisser pour le corriger." : "<b>touche la photo là où tu as droppé.</b>"}</p>` : ""}
        ${c.pos === "Green" && dernier ? `<h3>Putts</h3><div class="sa-choix" role="group">${[0, 1, 2, 3, 4].map((v) => `<button type="button" data-cpc-putts="${v}" aria-pressed="${t.putts === v}">${v}</button>`).join("")}<button type="button" class="sa-plus" data-cpc-putts="${Math.max(5, (t.putts || 0) + 1)}" aria-label="Ajouter 1">+</button></div>` : ""}
        ${c.pos === "Green" ? "" : `<h3>Club</h3><div class="sa-choix cpc-puces" role="group" aria-label="Club">${CLUBS.map((x) => `<button type="button" data-cpc-club="${k}" data-val="${x}" aria-pressed="${x === c.club}">${x}</button>`).join("")}</div>`}
        ${fini && dernier && t.score ? `<p class="pan-score">Score du trou : <b>${t.score}</b> (${ecartPar(t.score - t.par)})</p>` : ""}
        ${pied(`<button type="button" class="lien" data-cpc-suppr="${k}">Supprimer</button><button type="button" class="btn" data-cpc-deplacer="${k}">Déplacer</button>${
          fini && dernier && t.score && i < etat.partie.trous.length - 1 ? `<button type="button" class="btn plein" data-pas="1">Trou ${etat.partie.trous[i + 1].t} →</button>` : `<button type="button" class="btn plein" data-cpc-fermer>Valider</button>`}`)}`;
    }
    return `<div class="pan volet" id="cpc-panneau" role="dialog" aria-label="Questions du coup">${corps}</div>`;
  }
  function apres(i) {
    if (!actif(i)) return;
    dessiner(i);
    if (S.panneau) {
      const svg = $("cpc-svg"), cadre = svg.parentNode;
      cadre.insertAdjacentHTML("beforeend", panneauHTML(i));
      // volet sur le côté droit (12/11, demande utilisateur : pas de fenêtre par-dessus la photo) ; la photo reste visible à gauche
      const r = cadre.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) cadre.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  const verrou = (i, html) => (aDesCoups(i) ? html.replace(/<button /g, "<button disabled ") + `<p class="cpc-calc">Calculé à partir des coups</p>` : html);

  // ---------------------------------------------------------------- actions
  const majTrou = (i, tout = false) => { recalculer(i); ecrire(i); sauver(tout); rendreSaisie(); };
  function poser(i, p) {   // une touche sur la photo (ou le GPS) à l'endroit p
    const W = travail(i), C = W.coups;
    if (S.sel != null && C[S.sel]) { C[S.sel].p = p; S.panneau = { type: "coup", k: S.sel }; majTrou(i); return; }
    const kd = dropAttendu(W);
    if (kd >= 0) { C[kd].drop = p; S.panneau = { type: "coup", k: kd }; majTrou(i); return; }
    if (C.length && ["Green", "Dans le trou"].includes(C[C.length - 1].pos)) { signaler("La balle est sur le green : indique les putts. Pour corriger, touche une balle puis déplace-la."); return; }
    if (S.mode === "visee" && !W.viseEnCours) { W.viseEnCours = p; S.panneau = null; rendreSaisie(); return; }
    C.push({ p, devine: true, vise: S.mode === "visee" ? W.viseEnCours : null });
    W.viseEnCours = null; S.sel = C.length - 1; S.panneau = { type: "coup", k: C.length - 1 };
    majTrou(i);
  }
  async function retour(i) {
    const msg = prompt("Qu'est-ce qui ne va pas sur ce trou ? (plan faux, départ mal placé, position mal devinée, gêne à l'usage…)");
    if (!msg || !msg.trim()) return;
    const p = etat.partie, t = p.trous[i], G = geo(i), P = planDe(p);
    const contexte = { plan: P.etat, raison: P.raison, golf_osm: P.contour, trou_osm: G && { id: G.osm, ref: G.ref, nom: G.nom, par_osm: G.parOsm, departs: formes(G, "tee").length, greens: formes(G, "green").length, green_trouve: !!G.green },
      coups: t.coups || [], score: t.score, par: t.par, repere: p.repere, rang_depart: P.rang, ecran: innerWidth + "x" + innerHeight, navigateur: navigator.userAgent.slice(0, 160) };
    const { error } = await sb.from("carte_retours").insert({ golf: p.golf, golf_nom: p.golf_nom, parcours: p.parcours || p.parcours_nom, trou: t.t, mode: S.mode, message: msg.trim().slice(0, 2000), contexte });
    signaler(error ? (/carte_retours/.test(error.message) ? "Retours pas encore installés dans la base (script carte-retours.sql)." : "Envoi impossible : " + error.message) : "Merci, ton retour est enregistré.");
  }
  // clics dans la saisie : renvoie true si le bouton concernait le coup par coup
  function clic(e, b) {
    const d = b.dataset, i = etat.i;
    if (d.cpcMode) { S.mode = d.cpcMode; try { localStorage.setItem("carte-cpc-mode", S.mode); } catch { /* */ } S.sel = null; S.panneau = null; rendreSaisie(); return true; }
    if (d.aller != null || d.pas != null) { S.sel = null; S.panneau = null; return false; }   // changement de trou : géré par Carte
    if (!actif(i)) return false;
    const W = travail(i), C = W.coups;
    if (d.cpcZoom != null) { zoomer(+d.cpcZoom); return true; }
    if (d.cpcFermer != null) { S.panneau = null; S.sel = null; rendreSaisie(); return true; }
    if (d.cpcDeplacer != null) { S.sel = +d.cpcDeplacer; S.panneau = null; rendreSaisie(); signaler(`Fais glisser la balle ${S.sel + 1}, ou touche la photo là où elle a fini.`); return true; }
    if (d.cpcSuppr != null) { C.splice(+d.cpcSuppr, 1); S.sel = null; S.panneau = null; majTrou(i); return true; }
    if (d.cpcOuvrir != null) { S.sel = +d.cpcOuvrir; S.panneau = { type: "coup", k: S.sel }; rendreSaisie(); return true; }
    if (d.cpcPos != null) { const k = +d.cpcPos, c = C[k]; c.pos = d.val; c.devine = false; if (c.pos === "Green" || c.pos === "Dans le trou") C.splice(k + 1); if (c.pos === "Zone à pénalité" && !c.drop) { S.panneau = null; S.sel = null; } majTrou(i); return true; }
    if (d.cpcClub != null) { const c = C[+d.cpcClub]; c.club = d.val; c.clubMain = true; majTrou(i); return true; }
    if (d.cpcPutts != null) { const t = etat.partie.trous[i]; t.putts = +d.cpcPutts; t.puttsVu = true; ecrire(i); sauver(); rendreSaisie(); return true; }
    if (d.cpcDrapeau != null) { W.viseEnCours = drapeauDe(W.G); rendreSaisie(); return true; }
    if (d.cpcDepAuto != null) { W.dep = null; S.panneau = null; majTrou(i); return true; }
    if (d.cpcAnnuler != null) {
      if (W.viseEnCours) { W.viseEnCours = null; rendreSaisie(); return true; }
      S.sel = null; S.panneau = null; C.pop(); etat.partie.trous[i].puttsVu = false; majTrou(i); return true;
    }
    if (d.cpcGps != null) {
      if (!navigator.geolocation) { signaler("Ce téléphone ne donne pas sa position."); return true; }
      signaler("Recherche de ta position…");
      navigator.geolocation.getCurrentPosition((pos) => {
        const p = loc(W.G, [pos.coords.latitude, pos.coords.longitude]);
        const loin = metres(W.G, p, drapeauDe(W.G)) > 900 && metres(W.G, p, W.G.trou[0]) > 900;
        if (loin) { signaler("Tu sembles loin de ce trou : touche plutôt la photo."); return; }
        poser(i, p); signaler(`Balle posée à ta position (précision ${Math.round(pos.coords.accuracy)} m).`);
      }, () => signaler("Position indisponible : autorise la localisation, ou touche la photo."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
      return true;
    }
    if (d.cpcRetour != null) { retour(i); return true; }
    // putts : toujours saisissables (le score se recalcule) ; les autres champs se déduisent des coups
    if ((d.cle === "putts" || d.plus === "putts") && aDesCoups(i)) {
      const t = etat.partie.trous[i], v = d.cle ? +d.val : Math.max(typeof t.putts === "number" ? t.putts : +d.max, +d.max) + 1;
      t.putts = v; t.puttsVu = true; ecrire(i); sauver(); rendreSaisie(); return true;
    }
    if (d.cle && aDesCoups(i) && ["score", "pen", "fw", "bunker"].includes(d.cle)) return true;   // champs calculés
    return false;
  }
  // zoom de la photo seule (pincer, glisser un doigt, boutons + −) : la page ne zoome pas, le volet garde sa taille
  function appliquerVue() { const svg = $("cpc-svg"), v = S.vue; if (svg && v) svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map((n) => n.toFixed(1)).join(" ")); }
  function zoomer(f, cx, cy) {   // f > 1 : on rapproche ; (cx, cy) : point fixe, en unités de la photo
    const v = S.vue; if (!v) return;
    const [bx, by, bw, bh] = v.base, w = Math.max(bw / 8, Math.min(bw, v.w / f)), k = w / v.w;
    cx ??= v.x + v.w / 2; cy ??= v.y + v.h / 2;
    v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.w = w; v.h = v.h * k;
    borner(); appliquerVue();
  }
  function borner() {
    const v = S.vue, [bx, by, bw, bh] = v.base;
    if (v.w >= bw - 0.5) { v.x = bx; v.y = by; v.w = bw; v.h = bh; return; }
    v.x = Math.max(bx, Math.min(bx + bw - v.w, v.x)); v.y = Math.max(by, Math.min(by + bh - v.h, v.y));
  }
  const zoome = () => S.vue && S.vue.w < S.vue.base[2] - 0.5;
  const unites = (svg) => S.vue.w / svg.getBoundingClientRect().width;   // unités de photo par pixel d'écran
  const versVue = (svg, x, y) => { const r = svg.getBoundingClientRect(); return [S.vue.x + (x - r.left) * unites(svg), S.vue.y + (y - r.top) * unites(svg)]; };
  // gestes sur la photo
  const versPhoto = (e) => { const svg = $("cpc-svg"), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform($("cpc-photo").getScreenCTM().inverse()); return [q.x, q.y]; };
  function brancher(box) {
    box.addEventListener("pointerdown", (e) => {
      const svg = e.target.closest("#cpc-svg"); if (!svg) return;
      if (e.isPrimary) S.doigts.clear();   // premier doigt : on repart de zéro (photo redessinée entre-temps)
      S.doigts.set(e.pointerId, [e.clientX, e.clientY]);
      try { svg.setPointerCapture(e.pointerId); } catch { /* */ }
      if (S.doigts.size === 2) {   // deux doigts : on pince, plus de touche ni de glissé de balle
        const [[x1, y1], [x2, y2]] = [...S.doigts.values()];
        S.pince = { d: Math.hypot(x2 - x1, y2 - y1) || 1, m: [(x1 + x2) / 2, (y1 + y2) / 2] }; S.geste = null; e.preventDefault(); return;
      }
      if (S.doigts.size > 2) return;
      const balle = e.target.closest("[data-balle]"), dep = e.target.closest("[data-depart]"), drop = e.target.closest("[data-drop]"), vis = e.target.closest("[data-vise]"), visA = e.target.closest("[data-vise-attente]");
      S.geste = { k: balle ? +balle.dataset.balle : null, dep: !!dep, drop: drop ? +drop.dataset.drop : null, vis: vis ? +vis.dataset.vise : null, visA: !!visA, x: e.clientX, y: e.clientY, bouge: false, id: e.pointerId };
      if (balle || dep || drop || vis || visA) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    box.addEventListener("pointermove", (e) => {
      if (S.doigts.has(e.pointerId)) S.doigts.set(e.pointerId, [e.clientX, e.clientY]);
      const svg = $("cpc-svg");
      if (S.pince && S.doigts.size >= 2 && svg) {
        const [[x1, y1], [x2, y2]] = [...S.doigts.values()], d = Math.hypot(x2 - x1, y2 - y1) || 1, m = [(x1 + x2) / 2, (y1 + y2) / 2];
        const u = unites(svg); S.vue.x -= (m[0] - S.pince.m[0]) * u; S.vue.y -= (m[1] - S.pince.m[1]) * u;   // les deux doigts déplacent
        const [cx, cy] = versVue(svg, m[0], m[1]); zoomer(d / S.pince.d, cx, cy);
        S.pince = { d, m }; e.preventDefault(); return;
      }
      const g0 = S.geste;
      if (g0 && e.pointerId === g0.id && g0.k == null && !g0.dep && g0.drop == null && g0.vis == null && !g0.visA && svg) {   // un doigt sur la photo
        const dx = e.clientX - (g0.lx ?? g0.x), dy = e.clientY - (g0.ly ?? g0.y);
        if (!g0.glisse && Math.hypot(e.clientX - g0.x, e.clientY - g0.y) < 8) return;
        g0.glisse = true; g0.lx = e.clientX; g0.ly = e.clientY;
        if (zoome()) { const u = unites(svg); S.vue.x -= dx * u; S.vue.y -= dy * u; borner(); appliquerVue(); }
        else window.scrollBy(0, -dy);   // photo entière : le doigt fait défiler la page
        return;
      }
      const g = S.geste; if (!g || (g.k == null && !g.dep && g.drop == null && g.vis == null && !g.visA) || e.pointerId !== g.id) return;
      if (!g.bouge && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
      g.bouge = true;
      const W = travail(etat.i), q = versPhoto(e);
      if (g.vis != null) W.coups[g.vis].vise = q; else if (g.visA) W.viseEnCours = q; else if (g.dep) W.dep = q; else if (g.drop != null) W.coups[g.drop].drop = q; else { S.sel = g.k; W.coups[g.k].p = q; }
      dessiner(etat.i);
    });
    const fin = (e) => { S.doigts.delete(e.pointerId); if (S.pince && S.doigts.size < 2) { S.pince = null; S.geste = null; return true; } return false; };
    box.addEventListener("pointercancel", (e) => { fin(e); S.geste = null; });
    box.addEventListener("pointerup", (e) => {
      if (fin(e)) return;
      const g = S.geste; if (!g || e.pointerId !== g.id) { S.geste = null; return; }
      S.geste = null;
      if (!e.target.closest("#cpc-svg") && g.k == null && !g.dep && g.drop == null && g.vis == null && !g.visA) return;
      const i = etat.i; if (!actif(i)) return;
      const W = travail(i), C = W.coups;
      if (g.vis != null) { if (g.bouge) { C[g.vis].vise = versPhoto(e); majTrou(i); } else { S.panneau = { type: "coup", k: g.vis }; rendreSaisie(); } return; }
      if (g.visA) { if (g.bouge) W.viseEnCours = versPhoto(e); rendreSaisie(); return; }
      if (g.dep) { if (g.bouge) { W.dep = versPhoto(e); S.panneau = null; majTrou(i); } else { S.sel = null; S.panneau = { type: "depart" }; rendreSaisie(); } return; }
      if (g.drop != null) { if (g.bouge) { C[g.drop].drop = versPhoto(e); majTrou(i); } else { S.panneau = { type: "coup", k: g.drop }; rendreSaisie(); } return; }
      if (g.k != null) {
        if (g.bouge) { C[g.k].p = versPhoto(e); S.sel = null; S.panneau = null; majTrou(i); }   // glissé : on pose, sans fenêtre
        else { S.sel = g.k; S.panneau = { type: "coup", k: g.k }; rendreSaisie(); }            // simple touche : les questions
        return;
      }
      if (g.glisse || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) return;   // déplacement de la photo, pas une touche
      poser(i, versPhoto(e));
    });
  }
  brancher($("sa-contenu"));
  return { bascule, bloc, apres, verrou, clic, actif, aDesCoups, charger: (p) => charger(p), get mode() { return S.mode; }, outils: { plateformes, longueur: longueurDepuis, planDe: () => planDe(etat.partie) } };
})();
