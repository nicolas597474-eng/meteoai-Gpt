/** Filtres de lecture uniquement : aucun changement des calculs météo ou de leurs poids.
 * Les identifiants historiques sont conservés pour les requêtes et liens existants.
 * Intervalles contigus [min,max), sauf la borne finale de 360 h qui est incluse. */
export const RELIABILITY_HORIZONS = [
  {id:'0-6h',label:'0–6 h',min:0,max:6,storageBucket:null},
  {id:'6-24h',label:'6–24 h',min:6,max:24,storageBucket:'6_24h'},
  {id:'24-48h',label:'24–48 h',min:24,max:48,storageBucket:null},
  {id:'2-3d',label:'2–3 jours',min:48,max:72,storageBucket:null},
  {id:'4-7d',label:'3–7 jours',min:72,max:168,storageBucket:null},
  {id:'8-10d',label:'7–10 jours',min:168,max:240,storageBucket:null},
  {id:'11-15d',label:'10–15 jours',min:240,max:360,storageBucket:null},
] as const;
export type ReliabilityHorizonId = (typeof RELIABILITY_HORIZONS)[number]['id'];
