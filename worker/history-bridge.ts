// La calibration historique complète n'est pas importée dans cette première tranche.
// Le moteur d'origine reçoit explicitement « historique indisponible ».
export const makeLocationKey = (lat: number, lon: number) => `${lat.toFixed(3)}_${lon.toFixed(3)}`;
export async function getHourlyForecastEvaluationHistory() { throw new Error("Historique de calibration non migré"); }
