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
