/**
 * Shared channel constants.
 *
 * Single source of truth for the server's voice/text channel groups so
 * /lock, /unlock, and /lfg don't each maintain their own copy.
 */

// Comp 1–15 + Squad 0–10 voice channel IDs (where /lock, /unlock and /lfg apply).
const COMP_SQUAD_VCS = new Set([
  // Comp
  '727443108488282152', '727443150460813383', '727443244228542514',
  '727443265875607583', '727443309919993916', '727443287585194035',
  '727443329243021332', '727443351045144587', '727443372834422794',
  '727443395685122119', '727703119617851403', '727703138542551112',
  '729663370692788255', '729663393421590558', '729663413432877076',
  // Squad
  '899115364728848415', '537889557853634571', '537932400831758357',
  '537932424953331722', '537932451935420416', '537932476832677898',
  '698801565070262354', '698801587929219113', '698801612835258368',
  '798981457900601396', '701277690660913223',
]);

// Looking-for-games text channels where /lfg may be run.
const LFG_CHANNELS = new Set([
  '680469080800493656', // Looking to play unrated
  '725441670321275001', // Looking to play competitive
]);

module.exports = { COMP_SQUAD_VCS, LFG_CHANNELS };
