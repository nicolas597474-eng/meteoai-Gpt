import * as Astronomy from "astronomy-engine";
import type { AstroTime, Body as AstronomyBody, EclipseKind, Observer as AstronomyObserver } from "astronomy-engine";



export type EclipseVisibilityKind = "full_event" | "partial";

export type EclipseVisibilityCell = {
  north: number;
  south: number;
  east: number;
  west: number;
  visibility: EclipseVisibilityKind;
};

export type EclipseMapLayer = {
  eventId: string;
  title: string;
  date: string;
  type: "solar" | "lunar" | "meteor";
  sourceLabel: string;
  sourceUrl: string;
  precisionLabel: string;
  observationNote?: string;
  visibilityCells: EclipseVisibilityCell[];
  centralPath?: {
    northLimit: Array<{ lat: number; lng: number }>;
    southLimit: Array<{ lat: number; lng: number }>;
    centerLine: Array<{ lat: number; lng: number }>;
    attribution: string;
  };
};

export type LocalEclipseCircumstances = {
  eventId: string;
  visibility: "full_event" | "partial" | "not_visible";
  label: string;
  peakAt: string | null;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  altitudeDegrees: number | null;
  azimuthDegrees: number | null;
  azimuthCardinal: string | null;
  obscurationPercent: number | null;
  detail: string;
  precisionLabel: string;
};

type EclipseCandidate = {
  id: string;
  title: string;
  date: string;
};

export type MeteorVisibilityCandidate = {
  id: string;
  title: string;
  date: string;
  observationNote: string;
  sourceLabel: string;
  sourceUrl: string;
};

const layerCache = new Map<string, EclipseMapLayer>();
const GRID_STEP_DEGREES = 15;

function cellBounds(lat: number, lon: number): Omit<EclipseVisibilityCell, "visibility"> {
  const half = GRID_STEP_DEGREES / 2;
  return {
    north: Math.min(90, lat + half),
    south: Math.max(-90, lat - half),
    east: Math.min(180, lon + half),
    west: Math.max(-180, lon - half),
  };
}

function withinOneDay(actual: Date, expectedDate: string) {
  const expected = new Date(`${expectedDate}T12:00:00Z`).getTime();
  return Math.abs(actual.getTime() - expected) < 36 * 60 * 60 * 1_000;
}

function moonAltitudeAt(time: AstroTime, observer: AstronomyObserver) {
  const equator = Astronomy.Equator(Astronomy.Body.Moon, time, observer, true, true);
  return Astronomy.Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

function sunAltitudeAt(time: AstroTime, observer: AstronomyObserver) {
  const equator = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  return Astronomy.Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

function bodyAzimuthAt(body: AstronomyBody, time: AstroTime, observer: AstronomyObserver) {
  const equator = Astronomy.Equator(body, time, observer, true, true);
  return Astronomy.Horizon(time, observer, equator.ra, equator.dec, "normal").azimuth;
}

function cardinalDirection(azimuth: number) {
  const labels = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return labels[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}

function buildLunarVisibilityLayer(event: EclipseCandidate): EclipseMapLayer {
  const cached = layerCache.get(event.id);
  if (cached) return cached;

  const eclipse = Astronomy.SearchLunarEclipse(new Date(`${event.date}T00:00:00Z`));
  const partialDuration = eclipse.sd_partial > 0 ? eclipse.sd_partial : eclipse.sd_penum;
  const partialStart = new Astronomy.AstroTime(eclipse.peak.ut - partialDuration / 1440);
  const partialEnd = new Astronomy.AstroTime(eclipse.peak.ut + partialDuration / 1440);
  const visibilityCells: EclipseVisibilityCell[] = [];

  for (let lat = -75; lat <= 75; lat += GRID_STEP_DEGREES) {
    for (let lon = -180; lon <= 180; lon += GRID_STEP_DEGREES) {
      const observer = new Astronomy.Observer(lat, lon, 0);
      const peakAltitude = moonAltitudeAt(eclipse.peak, observer);
      if (peakAltitude <= 0) continue;
      const startAltitude = moonAltitudeAt(partialStart, observer);
      const endAltitude = moonAltitudeAt(partialEnd, observer);
      visibilityCells.push({
        ...cellBounds(lat, lon),
        visibility: startAltitude > 0 && endAltitude > 0 ? "full_event" : "partial",
      });
    }
  }

  const layer: EclipseMapLayer = {
    eventId: event.id,
    title: event.title,
    date: event.date,
    type: "lunar",
    sourceLabel: "Calcul local Astronomy Engine · validation NASA / USNO",
    sourceUrl: "https://aa.usno.navy.mil/data/UpcomingEclipses",
    precisionLabel: `Maillage géographique de ${GRID_STEP_DEGREES}° : visibilité calculée à l’instant du maximum et aux contacts partiels ; l’horizon réel n’est pas modélisé.`,
    visibilityCells,
  };
  layerCache.set(event.id, layer);
  return layer;
}

/**
 * Limites WGS84 de la bande de totalité du 2 août 2027, échantillonnées dans
 * la table NASA à 120 secondes. Elles sont volontairement séparées de la zone
 * de visibilité partielle calculée sur maillage.
 */
const SOLAR_2027_PATH = {
  northLimit: [
    { lat: 28.8, lng: -44.943 }, { lat: 33.052, lng: -25.9 }, { lat: 36.425, lng: -7.087 },
    { lat: 36.815, lng: -3.637 }, { lat: 36.797, lng: -0.495 }, { lat: 36.164, lng: 7.65 },
    { lat: 34.713, lng: 15.398 }, { lat: 31.33, lng: 25.163 }, { lat: 27.874, lng: 31.733 },
    { lat: 22.93, lng: 38.788 }, { lat: 17.803, lng: 44.885 }, { lat: 12.59, lng: 50.703 },
    { lat: 7.987, lng: 55.982 }, { lat: 2.587, lng: 62.833 }, { lat: -3.38, lng: 72.063 },
    { lat: -6.138, lng: 77.267 }, { lat: -11.633, lng: 90.838 },
  ],
  southLimit: [
    { lat: 27.122, lng: -44.023 }, { lat: 32.277, lng: -24.867 }, { lat: 34.608, lng: -6.408 },
    { lat: 34.67, lng: -3.17 }, { lat: 34.62, lng: -0.212 }, { lat: 33.806, lng: 7.439 },
    { lat: 32.529, lng: 14.742 }, { lat: 29.262, lng: 24.0 }, { lat: 25.928, lng: 30.3 },
    { lat: 21.62, lng: 36.543 }, { lat: 16.193, lng: 43.102 }, { lat: 11.106, lng: 48.85 },
    { lat: 6.617, lng: 54.065 }, { lat: 1.327, lng: 60.783 }, { lat: -4.455, lng: 69.708 },
    { lat: -7.047, lng: 74.508 }, { lat: -13.332, lng: 90.05 },
  ],
  centerLine: [
    { lat: 27.962, lng: -44.477 }, { lat: 33.085, lng: -25.9 }, { lat: 35.66, lng: -6.727 },
    { lat: 35.743, lng: -5.01 }, { lat: 35.708, lng: -0.33 }, { lat: 35.074, lng: 7.55 },
    { lat: 33.621, lng: 16.038 }, { lat: 30.296, lng: 24.585 }, { lat: 26.885, lng: 31.0 },
    { lat: 22.028, lng: 37.95 }, { lat: 17.0, lng: 43.983 }, { lat: 11.851, lng: 49.768 },
    { lat: 7.315, lng: 55.01 }, { lat: 1.977, lng: 61.8 }, { lat: -3.904, lng: 70.851 },
    { lat: -6.575, lng: 75.851 }, { lat: -12.483, lng: 90.438 },
  ],
  attribution: "Eclipse Predictions by Fred Espenak, NASA's GSFC",
};

function buildSolarVisibilityLayer(event: EclipseCandidate): EclipseMapLayer {
  const cached = layerCache.get(event.id);
  if (cached) return cached;

  const visibilityCells: EclipseVisibilityCell[] = [];
  for (let lat = -75; lat <= 75; lat += GRID_STEP_DEGREES) {
    for (let lon = -180; lon <= 180; lon += GRID_STEP_DEGREES) {
      const observer = new Astronomy.Observer(lat, lon, 0);
      const local = Astronomy.SearchLocalSolarEclipse(new Date(`${event.date}T00:00:00Z`), observer);
      if (!withinOneDay(local.peak.time.date, event.date) || local.peak.altitude <= 0) continue;
      visibilityCells.push({
        ...cellBounds(lat, lon),
        visibility: local.kind === Astronomy.EclipseKind.Total || local.kind === Astronomy.EclipseKind.Annular ? "full_event" : "partial",
      });
    }
  }

  const layer: EclipseMapLayer = {
    eventId: event.id,
    title: event.title,
    date: event.date,
    type: "solar",
    sourceLabel: "Bande centrale NASA · visibilité partielle calculée localement",
    sourceUrl: "https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html",
    precisionLabel: `La bande de totalité provient de la table NASA WGS84 ; la visibilité partielle est calculée sur un maillage de ${GRID_STEP_DEGREES}°. Les limites NASA sans profil du limbe peuvent varier de 1 à 3 km.`,
    visibilityCells,
    centralPath: SOLAR_2027_PATH,
  };
  layerCache.set(event.id, layer);
  return layer;
}

function buildMeteorVisibilityLayer(event: MeteorVisibilityCandidate): EclipseMapLayer {
  const cached = layerCache.get(event.id);
  if (cached) return cached;

  const visibilityCells: EclipseVisibilityCell[] = [];
  const [year, month, day] = event.date.split("-").map(Number);
  for (let lat = -75; lat <= 75; lat += GRID_STEP_DEGREES) {
    for (let lon = -180; lon <= 180; lon += GRID_STEP_DEGREES) {
      // Minuit solaire local, approximation adaptée à une carte mondiale au pic.
      const localMidnight = new Date(Date.UTC(year, month - 1, day) - (lon / 15) * 60 * 60 * 1_000);
      const observer = new Astronomy.Observer(lat, lon, 0);
      const altitude = sunAltitudeAt(new Astronomy.AstroTime(localMidnight), observer);
      if (altitude > 0) continue;
      visibilityCells.push({
        ...cellBounds(lat, lon),
        visibility: altitude <= -18 ? "full_event" : "partial",
      });
    }
  }

  const layer: EclipseMapLayer = {
    eventId: event.id,
    title: event.title,
    date: event.date,
    type: "meteor",
    sourceLabel: event.sourceLabel,
    sourceUrl: event.sourceUrl,
    observationNote: event.observationNote,
    precisionLabel: `Zones de nuit calculées avec Astronomy Engine au minuit solaire local, le jour du pic, sur un maillage de ${GRID_STEP_DEGREES}°. Elles indiquent seulement l’obscurité potentielle : radiant, horizon local, météo et heure d’observation ne sont pas modélisés.`,
    visibilityCells,
  };
  layerCache.set(event.id, layer);
  return layer;
}

export function getMeteorVisibilityLayers(events: MeteorVisibilityCandidate[]) {
  return events.map(buildMeteorVisibilityLayer);
}

export function getEclipseVisibilityLayers(events: EclipseCandidate[]) {
  return events.flatMap((event) => {
    if (event.id.startsWith("lunar_")) return [buildLunarVisibilityLayer(event)];
    if (event.id === "solar_partial_2027_08_02") return [buildSolarVisibilityLayer(event)];
    return [];
  });
}

function toIso(time: AstroTime) {
  return time.date.toISOString();
}

function lunarKindLabel(kind: EclipseKind) {
  if (kind === Astronomy.EclipseKind.Total) return "Éclipse lunaire totale";
  if (kind === Astronomy.EclipseKind.Partial) return "Éclipse lunaire partielle";
  return "Éclipse lunaire pénombrale";
}

function solarKindLabel(kind: EclipseKind) {
  if (kind === Astronomy.EclipseKind.Total) return "Éclipse solaire totale";
  if (kind === Astronomy.EclipseKind.Annular) return "Éclipse solaire annulaire";
  return "Éclipse solaire partielle";
}

/**
 * Circumstances calculées à la demande pour le point choisi sur la carte.
 * Les résultats ne modélisent pas l'horizon, les bâtiments ou la météo locale.
 */
export function getLocalEclipseCircumstances(input: { eventId: string; lat: number; lon: number }): LocalEclipseCircumstances {
  const observer = new Astronomy.Observer(input.lat, input.lon, 0);

  if (input.eventId === "lunar_partial_2026_08_28") {
    const eclipse = Astronomy.SearchLunarEclipse(new Date("2026-08-28T00:00:00Z"));
    const duration = eclipse.sd_partial > 0 ? eclipse.sd_partial : eclipse.sd_penum;
    const start = new Astronomy.AstroTime(eclipse.peak.ut - duration / 1440);
    const end = new Astronomy.AstroTime(eclipse.peak.ut + duration / 1440);
    const peakAltitude = moonAltitudeAt(eclipse.peak, observer);
    const startAltitude = moonAltitudeAt(start, observer);
    const endAltitude = moonAltitudeAt(end, observer);
    const azimuth = bodyAzimuthAt(Astronomy.Body.Moon, eclipse.peak, observer);
    const visibility = peakAltitude <= 0 ? "not_visible" : startAltitude > 0 && endAltitude > 0 ? "full_event" : "partial";
    return {
      eventId: input.eventId,
      visibility,
      label: lunarKindLabel(eclipse.kind),
      peakAt: toIso(eclipse.peak),
      startAt: visibility === "not_visible" ? null : toIso(start),
      endAt: visibility === "not_visible" ? null : toIso(end),
      durationMinutes: visibility === "not_visible" ? null : Math.round(duration * 2),
      altitudeDegrees: Math.round(peakAltitude * 10) / 10,
      azimuthDegrees: Math.round(azimuth * 10) / 10,
      azimuthCardinal: cardinalDirection(azimuth),
      obscurationPercent: Math.round(eclipse.obscuration * 100),
      detail: visibility === "full_event" ? "La Lune est au-dessus de l’horizon pendant toute la phase calculée." : visibility === "partial" ? "La Lune est au-dessus de l’horizon au maximum, mais pas pendant toute la phase calculée." : "La Lune est sous l’horizon au maximum de l’éclipse pour cette position.",
      precisionLabel: "Calcul Astronomy Engine au point sélectionné ; horizon réel, obstacles et météo non modélisés.",
    };
  }

  if (input.eventId === "solar_partial_2027_08_02") {
    const eclipse = Astronomy.SearchLocalSolarEclipse(new Date("2027-08-02T00:00:00Z"), observer);
    const isExpectedDate = withinOneDay(eclipse.peak.time.date, "2027-08-02");
    const visibility = !isExpectedDate || eclipse.peak.altitude <= 0 ? "not_visible" : eclipse.partial_begin.altitude > 0 && eclipse.partial_end.altitude > 0 ? "full_event" : "partial";
    const duration = (eclipse.partial_end.time.ut - eclipse.partial_begin.time.ut) * 1440;
    const azimuth = isExpectedDate ? bodyAzimuthAt(Astronomy.Body.Sun, eclipse.peak.time, observer) : null;
    return {
      eventId: input.eventId,
      visibility,
      label: solarKindLabel(eclipse.kind),
      peakAt: isExpectedDate ? toIso(eclipse.peak.time) : null,
      startAt: visibility === "not_visible" ? null : toIso(eclipse.partial_begin.time),
      endAt: visibility === "not_visible" ? null : toIso(eclipse.partial_end.time),
      durationMinutes: visibility === "not_visible" ? null : Math.round(duration),
      altitudeDegrees: Math.round(eclipse.peak.altitude * 10) / 10,
      azimuthDegrees: azimuth == null ? null : Math.round(azimuth * 10) / 10,
      azimuthCardinal: azimuth == null ? null : cardinalDirection(azimuth),
      obscurationPercent: isExpectedDate ? Math.round(eclipse.obscuration * 100) : null,
      detail: visibility === "full_event" ? "Le Soleil est au-dessus de l’horizon pendant toute la phase partielle calculée." : visibility === "partial" ? "Le Soleil est au-dessus de l’horizon au maximum, mais la phase complète est tronquée par l’horizon." : "Le Soleil est sous l’horizon au maximum de l’éclipse pour cette position.",
      precisionLabel: "Calcul Astronomy Engine au point sélectionné ; horizon réel, obstacles, nuages et sécurité d’observation non modélisés.",
    };
  }

  throw new Error("Événement d’éclipse non pris en charge.");
}
