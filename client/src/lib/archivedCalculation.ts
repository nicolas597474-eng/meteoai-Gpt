export function archivedCalculationLabel(value:unknown){
 if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))return 'Heure de calcul non archivée';
 return 'Calcul archivé : '+new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'})+' (Paris)';
}
