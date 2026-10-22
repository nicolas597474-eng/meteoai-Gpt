import type {DailyOfficialFusionDisplay} from './dailyForecast';

export const DAILY_FUSION_FIELDS=[['tempMax','Température maximale'],['tempMin','Température minimale'],['precipitation','Précipitations'],['windSpeed','Vent maximal'],['windGust','Rafales'],['humidity','Humidité'],['cloudCover','Nuages']] as const;
/** Trace compacte du calcul existant, sans renormalisation ni score ajouté. */
export function projectDailyFusionDetails(fusion:DailyOfficialFusionDisplay) {
  return DAILY_FUSION_FIELDS.map(([key,label])=>{
    const diagnostic=fusion.diagnosticsByVariable?.[key];
    return {key,label,availability:fusion.availabilityStatus[key],calibration:fusion.calibrationStatus[key],
      availableModels:diagnostic?.availableModels??[],
      contributingCount:diagnostic?.contributingModelCount??null,
      models:(fusion.sourcesByVariable?.[key]??[]).map(source=>({name:source.modelName,weight:Number.isFinite(source.finalWeight)?source.finalWeight:null})),
      excluded:(diagnostic?.modelReasons??[]).map(source=>({name:source.modelName,reason:source.reason})),
    };
  });
}
export type DailyFusionDetails=ReturnType<typeof projectDailyFusionDetails>;
