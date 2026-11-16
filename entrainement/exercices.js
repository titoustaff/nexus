"use strict";
// Catalogue d'Entraînement : des DONNÉES. L'écran de saisie, la feuille, le score et le niveau se construisent à partir d'elles
// (décision 16/11 : un exercice = des données ; l'éditeur du coach puis du joueur remplira plus tard ces mêmes données).
// Vocabulaire : exercice → séance (exercices enchaînés, mêmes conditions) → programme (plus tard).
// Premier lot : les 6 exercices de l'évaluation ffgolf (protocoles « Groupes de Ligue », tableaux de Mark Broadie,
// « Every shot counts », 2014). Les niveaux vont du meilleur pro PGA (0) au golfeur 100-110 (5).

const NIVEAUX = ["Meilleur pro PGA", "Pro PGA moyen", "Meilleur amateur", "Golfeur 80", "Golfeur 90", "Golfeur 100-110"];

// Choix de saisie (un bouton = un résultat) : p = points du barème ; v = valeur retenue en mètres (milieu de la zone) ;
// max = borne haute de la zone (pour classer une mesure radar) ; bon = compte comme réussite dans Stats ; trois = 3 putts.
const CHOIX = {
  putts: { bon: "1er putt à 3 pieds (0,90 m) ou moins", L: [
    { c: "p1", t: "1 putt", p: 5, court: "1", bon: 1 },
    { c: "in", t: "2 putts, le 1er dans les 3 pieds", p: 1, court: "2●", bon: 1 },
    { c: "out", t: "2 putts, le 1er dehors", p: 0, court: "2○" },
    { c: "p3", t: "3 putts et +", p: -3, court: "3+", trois: 1 }] },
  chip: { bon: "à 6 pieds (1,80 m) ou moins", L: [
    { c: "in", t: "Dans le trou", p: 5, court: "●", bon: 1 },
    { c: "z6", t: "6 pieds ou moins (1,80 m)", p: 2, court: "≤6", bon: 1 },
    { c: "z12", t: "6 à 12 pieds (1,80 à 3,60 m)", p: 1, court: "≤12" },
    { c: "vert", t: "Plus de 12 pieds, sur le green", p: 0, court: ">12" },
    { c: "hors", t: "Hors du green (plus de 10 m)", p: -1, court: "hors" }] },
  wedge: { bon: "sur le green (10 m)", L: [
    { c: "w3", t: "3 m ou moins", v: 2, max: 3, court: "≤3", bon: 1 },
    { c: "w5", t: "3 à 5 m", v: 4, max: 5, court: "≤5", bon: 1 },
    { c: "w7", t: "5 à 7 m", v: 6, max: 7, court: "≤7", bon: 1 },
    { c: "w10", t: "7 à 10 m, sur le green", v: 8.5, max: 10, court: "≤10", bon: 1 },
    { c: "hors", t: "Hors du green (plus de 10 m)", v: 13, max: 1e9, court: "hors" }] },
  fer: { bon: "sur le green (10 m)", L: [
    { c: "f5", t: "5 m ou moins", v: 3.5, max: 5, court: "≤5", bon: 1 },
    { c: "f10", t: "5 à 10 m, sur le green", v: 7.5, max: 10, court: "≤10", bon: 1 },
    { c: "f20", t: "10 à 20 m", v: 15, max: 20, court: "≤20" },
    { c: "f30", t: "20 à 30 m", v: 25, max: 30, court: "≤30" },
    { c: "f99", t: "Plus de 30 m", v: 35, max: 1e9, court: ">30" }] },
  drive: { bon: "fairway touché", L: [
    { c: "fc", t: "Fairway, 7 m ou moins de l'axe", court: "FW●", bon: 1 },
    { c: "fb", t: "Fairway, 7 à 15 m de l'axe", court: "FW", bon: 1 },
    { c: "g", t: "Hors fairway à gauche", court: "G" },
    { c: "d", t: "Hors fairway à droite", court: "D" }] },
};

// Conditions du jour : demandées une fois par séance, seulement celles utiles à ses exercices
const CONDITIONS = {
  v: { t: "Green", L: [["lent", "lent"], ["normal", "normal"], ["rapide", "rapide"]] },
  f: { t: "Fermeté", L: [["mou", "mou"], ["normal", "normal"], ["ferme", "ferme"]] },
  p: { t: "Practice", L: [["herbe", "herbe"], ["tapis", "tapis"]] },
  w: { t: "Vent", L: [["faible", "faible"], ["modere", "modéré"], ["fort", "fort"]] },
  s: { t: "Distances", L: [["G", "garçons"], ["F", "filles"]] },
};

// type : spirale (séries jusqu'à 6 sur 6) | grille (lignes × tours, un choix par balle) | mesure (valeurs tapées, la meilleure compte)
// lignes[].niv : seuils de points par niveau (plus haut = mieux) ; lignes[].med : seuils de médiane en mètres (plus bas = mieux)
const EXERCICES = [
  { id: "spirale", titre: "Spiral Game", secteur: "Putting", type: "spirale", duree: "5 à 30 min", conds: ["v", "w"], source: "ffgolf",
    resume: "6 putts de 2 à 7 pieds (0,60 à 2,10 m) à rentrer d'affilée.",
    aide: ["6 balles en spirale autour d'un trou, de 2 à 7 pieds (60 cm à 2,10 m), une tous les 30 cm.",
      "On les joue de la plus près à la plus loin. Le but : les rentrer toutes les 6 d'affilée.",
      "Un putt raté : on note sa distance et on recommence une série sur un autre trou, dans l'autre sens (10 séries au plus).",
      "Score : le nombre de séries ratées avant de réussir les 6. 0 est le meilleur."],
    niv: [0, 1, 2, 3, 5] },
  { id: "putts-longs", titre: "Putts longs 6/9/12 m", secteur: "Putting", type: "grille", duree: "25 à 30 min", conds: ["v", "w"], source: "ffgolf",
    tours: 10, score: "points",
    resume: "30 putts depuis 6, 9 et 12 m, joués jusqu'au trou. Barème : 1 putt = 5 points, 3 putts = −3.",
    aide: ["3 repères sur un green plat : à 6, 9 et 12 m du trou.",
      "À chaque tour, une balle depuis chaque repère, jouée jusqu'au trou. 10 tours, 30 balles.",
      "Points : 1 putt = 5 · 2 putts avec le 1er fini à 3 pieds (0,90 m) ou moins = 1 · 2 putts avec le 1er plus loin = 0 · 3 putts ou plus = −3."],
    lignes: [{ t: "6 m", choix: "putts", niv: [15, 14, 12, 10, 7] }, { t: "9 m", choix: "putts", niv: [10, 8, 7, 4, 0] },
      { t: "12 m", choix: "putts", niv: [5, 4, 2, -1, -5] }],
    nivTot: [30, 26, 21, 13, 2] },
  { id: "chipping", titre: "Chipping 4 situations", secteur: "Chipping", type: "grille", duree: "25 à 30 min", conds: ["v", "f", "w"], source: "ffgolf",
    tours: 5, score: "points",
    resume: "20 chips : 18 m fairway, 9 m bunker, 27 m fairway, 18 m rough. Points selon la zone d'arrêt.",
    aide: ["Le green est un cercle de 10 m de rayon autour du trou : au-delà, la balle est hors du green.",
      "4 situations jouées l'une après l'autre, 5 tours (20 balles) : 18 m fairway · 9 m bunker à plat (balle posée) · 27 m fairway · 18 m rough moyen. Hors bunker, la balle est droppée.",
      "Zone d'arrêt : dans le trou 5 points · 6 pieds (1,80 m) ou moins 2 · 6 à 12 pieds 1 · plus loin sur le green 0 · hors du green −1."],
    lignes: [{ t: "18 m fairway", choix: "chip", niv: [8, 7, 6, 5, 4] }, { t: "9 m bunker", choix: "chip", niv: [6, 5, 4, 2, 1] },
      { t: "27 m fairway", choix: "chip", niv: [6, 5, 4, 3, 2] }, { t: "18 m rough", choix: "chip", niv: [5, 4, 3, 2, 1] }],
    nivTot: [25, 21, 17, 12, 8] },
  { id: "wedging", titre: "Wedging 55/70/60/90 m", secteur: "Wedging", type: "grille", duree: "25 à 30 min", conds: ["p", "w"], source: "ffgolf",
    tours: 5, score: "dispersion", radar: true,
    resume: "20 balles vers un green de 10 m : 55 m, 70 m, 60 m rough, 90 m. Dispersion autour du drapeau.",
    aide: ["Au practice : 4 cibles, chacune au centre d'un green de 10 m de rayon.",
      "4 situations l'une après l'autre, 5 tours : 55 m fairway · 70 m fairway · 60 m rough moyen · 90 m fairway (balle droppée).",
      "Sans radar : la zone où la balle s'arrête (à 3 m ou moins, 3 à 5 m…). Avec radar : la distance au drapeau en mètres.",
      "Score : la médiane des 5 balles de chaque situation, comparée au tableau ffgolf."],
    lignes: [{ t: "55 m fairway", choix: "wedge", med: [3.0, 3.9, 5.1, 7.5, 9.3] }, { t: "70 m fairway", choix: "wedge", med: [3.6, 4.2, 6.0, 9.9, 11.7] },
      { t: "60 m rough", choix: "wedge", med: [4.8, 6.3, 7.8, 10.8, 13.2] }, { t: "90 m fairway", choix: "wedge", med: [3.9, 4.8, 6.9, 11.1, 13.8] }] },
  { id: "long-jeu", titre: "Long jeu et drive", secteur: "Long jeu", type: "grille", duree: "30 min", conds: ["p", "w", "s"], source: "ffgolf",
    tours: 5, score: "dispersion", radar: true,
    resume: "3 distances de fers vers un green de 10 m, puis des drives sur un fairway de 30 m de large.",
    aide: ["Fers : un green de 10 m de rayon à 110, 140 et 170 m (garçons) ou 95, 120 et 145 m (filles). Drive : un fairway de 30 m de large.",
      "4 situations l'une après l'autre, 5 tours.",
      "Sans radar : la zone d'arrêt. Avec radar : la dispersion au carry en mètres pour les fers.",
      "Score des fers : la médiane des 5 balles, comparée au tableau ffgolf. Drive : fairways touchés, et de quel côté on rate."],
    lignes: [{ t: "110 m", tF: "95 m", choix: "fer", med: [4.5, 5.4, 6.6, 14.1, 17.4] }, { t: "140 m", tF: "120 m", choix: "fer", med: [6.3, 6.9, 8.7, 16.8, 21.9] },
      { t: "170 m", tF: "145 m", choix: "fer", med: [9.3, 10.2, 12.9, 24.6, 32.4] }, { t: "Drive", choix: "drive" }] },
  { id: "vmax", titre: "Vitesse max au drive", secteur: "Long jeu", type: "mesure", duree: "10 min", conds: ["w"], source: "ffgolf",
    n: 5, unite: "mph",
    resume: "5 drives à pleine vitesse, au moins 1 minute entre chaque. Score : la meilleure vitesse (radar nécessaire).",
    aide: ["5 drives, au moins 1 minute entre chaque balle, en faisant circuler le club le plus vite possible.",
      "À chaque balle, note la vitesse de club lue sur le radar, en mph.", "Score : la meilleure des 5."] },
];

const SEANCES_TYPES = [
  { id: "eval-pc", titre: "Évaluation ffgolf · putting et chipping", exos: ["spirale", "putts-longs", "chipping"], duree: "1 h à 1 h 30",
    resume: "Les 3 exercices de petit jeu de l'évaluation fédérale, enchaînés sous les mêmes conditions." },
  { id: "eval-tout", titre: "Évaluation ffgolf complète", exos: ["spirale", "putts-longs", "chipping", "wedging", "long-jeu", "vmax"], duree: "2 h 30 à 3 h",
    resume: "Les 6 exercices de l'évaluation fédérale. Le wedging et le long jeu se font au practice, la vitesse max demande un radar." },
];
