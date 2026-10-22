/** Diagnostics de lecture, distincts des journaux fournisseurs et des preuves qualifiées. */
export type ArchivedModelCoverage={model:string;hoursArchived:number;valuesArchived:number;firstValidAt:number;lastValidAt:number};
export type ArchiveDiagnostics={
 scope:'hondeghem'|'not_covered';
 forecastStatus:'verified'|'none'|'integrity_error'|'unavailable'|'not_covered';
 checkedArchives:number;rejectedArchives:number;boundedRead:boolean;
 models:ArchivedModelCoverage[];
 observationFiles?:{status:'verified'|'partial'|'none'|'unavailable';checkedArchives:number;rejectedArchives:number;boundedRead:boolean;measurements:number;stations:number;rawHours:number;overlappingHours:number|null;forecastArchives:number;forecastReadBounded:boolean};
 observationIndex:{status:'available'|'unavailable'|'not_covered';windowHours:48;measurements:number|null;stations:number|null;rawHours:number|null;flagged:number|null;firstMeasuredAt:number|null;lastMeasuredAt:number|null;lastReceivedAt:number|null};
};

/** Le contrôle d'intégrité et le recouvrement temporel ne qualifient aucun score. */
export function describeObservationFiles(files:ArchiveDiagnostics['observationFiles']):string {
 if(!files||files.status==='unavailable')return 'Le contrôle des fichiers de mesures est indisponible ; aucun résultat physique vérifié ne peut être annoncé.';
 if(files.status==='none')return 'Aucun lot de mesures n’est disponible dans la fenêtre de 48 h.';
 return `${files.measurements} relevé(s) de ${files.stations} station(s), sur ${files.rawHours} créneau(x), concordent avec les fichiers contrôlés et leur index.${files.rejectedArchives?` ${files.rejectedArchives} lot(s) ont été écartés du contrôle.`:''}${files.boundedRead?' Lecture limitée aux huit lots les plus récents.':''} ${files.overlappingHours===null?'Le recouvrement avec les prévisions est indisponible.':`${files.overlappingHours} créneau(x) UTC terminé(s) commun(s) avec ${files.forecastArchives} capture(s) de prévision vérifiée(s), reçues avant leur échéance ; les mesures signalées sont exclues de ce rapprochement.`}${files.forecastReadBounded?' La lecture des prévisions est également limitée à huit captures.':''} Ce contrôle reste partiel : aucune couverture quotidienne qualifiée, référence spatiale, MAE ni calibration n’en est déduite.`;
}
