import type { DashboardFusionTrace } from '@shared/dashboardFusionTrace';
import type { CurrentStateFieldLike } from './dashboardPresentation';

export const OBSERVATION_DETAILS = {
  temperature: { label: 'Température actuelle', unit: '°C', explanation: 'Température de la source retenue pour l’état actuel. Une mesure de station, un snapshot de modèle et une prévision horaire sont des données distinctes, même lorsque leurs valeurs sont proches.' },
  apparent_temperature: { label: 'Ressenti', unit: '°C', explanation: 'Température ressentie estimée, distincte de la température mesurée sous abri.' },
  cloud_cover: { label: 'Nuages actuels', unit: '%', explanation: 'Part du ciel couverte par les nuages. Cette valeur ne décrit pas la hauteur des nuages.' },
  wind_speed: { label: 'Vent actuel', unit: 'km/h', explanation: 'Vitesse du vent de la source affichée. La rafale est une valeur distincte.' },
  wind_gust: { label: 'Rafales actuelles', unit: 'km/h', explanation: 'Pointe de vitesse du vent prévue pour cette échéance, distincte du vent moyen.' },
  pressure: { label: 'Pression de surface estimée (modèle)', unit: 'hPa', explanation: 'Pression de surface au lieu sélectionné, non ramenée au niveau de la mer. Il s’agit d’une estimation de modèle.' },
  humidity: { label: 'Humidité actuelle', unit: '%', explanation: 'Humidité relative de l’air. Une valeur élevée ne constitue pas, à elle seule, une prévision de pluie.' },
  precipitation: { label: 'Précipitations actuelles', unit: 'mm', explanation: 'Quantité de précipitations de la source affichée. Les cumuls de stations et les prévisions horaires ne sont comparables que sur une même période.' },
  uv_index: { label: 'Indice UV prévu', unit: '', explanation: 'Intensité du rayonnement ultraviolet prévue. La valeur dépend de l’heure de la prévision indiquée ci-dessous.' },
  visibility: { label: 'Visibilité prévue', unit: 'km', explanation: 'Distance de visibilité météorologique estimée, distincte de la hauteur ou de la visibilité des nuages.' },
} as const;
export type ObservationDetailKey = keyof typeof OBSERVATION_DETAILS;

export function observationForecastInstant(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}

/** Une échéance absente ne doit jamais emprunter la trace d’une heure voisine. */
export function observationForecastDetail(points: DashboardFusionTrace, validAt: number | null | undefined, key: ObservationDetailKey) {
  const row = typeof validAt === 'number' && Number.isFinite(validAt)
    ? points.find(point => point.validAt === validAt)?.variables.find(variable => variable.key === key) ?? null
    : null;
  const values = row?.models.flatMap(model => typeof model.value === 'number' && Number.isFinite(model.value) ? [model.value] : []) ?? [];
  return { row, availableModels: values.length, spread: values.length >= 2 ? Math.max(...values) - Math.min(...values) : null };
}

/** Provenance des champs déjà affichés comme prévisions (UV, pression, visibilité).
 * Aucun recours aux stations ou au snapshot ne complète une valeur absente. */
export function observationForecastField(value: number | null | undefined, validAt: number | null | undefined, computedAt: string | null, source: string): CurrentStateFieldLike {
  return {
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    provenance: {
      kind: 'official_hourly_forecast', label: 'Prévision horaire officielle', stationCount: 0,
      stationSources: [source], observedAt: observationForecastInstant(validAt),
      computedAt, ageMinutes: null, reason: 'Valeur de l’échéance affichée sur le Dashboard.', measurements: [],
    },
  };
}

export function observationInstant(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(time) : 'Horodatage indisponible';
}
