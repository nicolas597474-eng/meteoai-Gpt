import { getEclipseVisibilityLayers, getMeteorVisibilityLayers, type EclipseMapLayer } from "./eclipseVisibility";

import * as Astronomy from "astronomy-engine";



export type MoonMilestone = {
  id: "new_moon" | "first_quarter" | "full_moon" | "last_quarter";
  label: string;
  date: string;
};

export type SolarMilestone = {
  label: string;
  date: string;
};

export type EclipseAlert = {
  id: string;
  title: string;
  date: string;
  visibility: string;
  safetyNote: string | null;
  sourceLabel: string;
  sourceUrl: string;
  skyOutlook: { cloudCoverMean: number; label: string; moonIllumination: number | null } | null;
};

export type MeteorShowerAlert = {
  id: string;
  title: string;
  date: string;
  activeRange: string;
  zhr: number;
  observationNote: string;
  sourceLabel: string;
  sourceUrl: string;
  skyOutlook: { cloudCoverMean: number; label: string; moonIllumination: number | null } | null;
};

export type AstronomyOutlook = {
  moonMilestones: MoonMilestone[];
  nextSolarMilestone: SolarMilestone | null;
  daylightChangeTomorrowSeconds: number | null;
  upcomingEclipses: EclipseAlert[];
  eclipseMapLayers: EclipseMapLayer[];
  eventMapLayers: EclipseMapLayer[];
  upcomingMeteorShowers: MeteorShowerAlert[];
};

const MOON_TARGETS: Array<{ id: MoonMilestone["id"]; label: string; phase: number }> = [
  { id: "new_moon", label: "Nouvelle lune", phase: 0 },
  { id: "first_quarter", label: "Premier quartier", phase: 0.25 },
  { id: "full_moon", label: "Pleine lune", phase: 0.5 },
  { id: "last_quarter", label: "Dernier quartier", phase: 0.75 },
];

const SOLAR_MILESTONES: SolarMilestone[] = [
  { label: "Équinoxe de septembre", date: "2026-09-23" },
  { label: "Solstice de décembre", date: "2026-12-21" },
  { label: "Équinoxe de mars", date: "2027-03-20" },
  { label: "Solstice de juin", date: "2027-06-21" },
  { label: "Équinoxe de septembre", date: "2027-09-23" },
  { label: "Solstice de décembre", date: "2027-12-21" },
  { label: "Équinoxe de mars", date: "2028-03-20" },
  { label: "Solstice de juin", date: "2028-06-20" },
];

const ECLIPSES: Omit<EclipseAlert, "skyOutlook">[] = [
  {
    id: "lunar_partial_2026_08_28",
    title: "Éclipse lunaire partielle",
    date: "2026-08-28",
    visibility: "Visible depuis la France",
    safetyNote: null,
    sourceLabel: "NASA / Timeanddate",
    sourceUrl: "https://science.nasa.gov/eclipses/future-eclipses/",
  },
  {
    id: "lunar_penumbral_2027_02_20",
    title: "Éclipse lunaire pénombrale",
    date: "2027-02-20",
    visibility: "Visible depuis la France ; assombrissement discret",
    safetyNote: null,
    sourceLabel: "NASA / Timeanddate",
    sourceUrl: "https://science.nasa.gov/eclipses/future-eclipses/",
  },
  {
    id: "solar_partial_2027_08_02",
    title: "Éclipse solaire totale",
    date: "2027-08-02",
    visibility: "Partielle depuis la France",
    safetyNote: "Observation directe uniquement avec des lunettes d’éclipse homologuées.",
    sourceLabel: "NASA / ESA",
    sourceUrl: "https://www.esa.int/Science_Exploration/Space_Science/European_solar_eclipses",
  },
  {
    id: "lunar_partial_2028_01_12",
    title: "Éclipse lunaire partielle",
    date: "2028-01-12",
    visibility: "Visible depuis la France",
    safetyNote: null,
    sourceLabel: "Timeanddate",
    sourceUrl: "https://www.timeanddate.com/eclipse/in/france",
  },
  {
    id: "solar_annular_2028_01_26",
    title: "Éclipse solaire annulaire",
    date: "2028-01-26",
    visibility: "Partielle depuis la France",
    safetyNote: "Observation directe uniquement avec des lunettes d’éclipse homologuées.",
    sourceLabel: "ESA / Timeanddate",
    sourceUrl: "https://www.esa.int/Science_Exploration/Space_Science/European_solar_eclipses",
  },
];

const METEOR_SHOWERS: Omit<MeteorShowerAlert, "skyOutlook">[] = [
  {
    id: "orionids_2026",
    title: "Orionides",
    date: "2026-10-21",
    activeRange: "2 octobre–7 novembre",
    zhr: 20,
    observationNote: "À observer après minuit ; la Lune peut réduire le contraste en 2026.",
    sourceLabel: "NASA / American Meteor Society",
    sourceUrl: "https://www.amsmeteors.org/meteor-showers/meteor-shower-calendar/",
  },
  {
    id: "taurids_2026",
    title: "Taurides",
    date: "2026-11-04",
    activeRange: "20 septembre–20 novembre",
    zhr: 5,
    observationNote: "Faible cadence, mais possibilité de bolides lumineux ; observation nocturne recommandée.",
    sourceLabel: "American Meteor Society",
    sourceUrl: "https://www.amsmeteors.org/meteor-showers/meteor-shower-calendar/",
  },
  {
    id: "leonids_2026",
    title: "Léonides",
    date: "2026-11-16",
    activeRange: "6–30 novembre",
    zhr: 15,
    observationNote: "Meilleures conditions après minuit, loin des lumières directes.",
    sourceLabel: "NASA / American Meteor Society",
    sourceUrl: "https://science.nasa.gov/solar-system/meteors-meteorites/meteor-showers/",
  },
  {
    id: "geminids_2026",
    title: "Géminides",
    date: "2026-12-13",
    activeRange: "4–17 décembre",
    zhr: 150,
    observationNote: "Essaim majeur ; activité possible avant minuit lorsque le ciel est dégagé.",
    sourceLabel: "NASA / American Meteor Society",
    sourceUrl: "https://science.nasa.gov/solar-system/meteors-meteorites/meteor-showers/",
  },
  {
    id: "ursids_2026",
    title: "Ursides",
    date: "2026-12-21",
    activeRange: "17–26 décembre",
    zhr: 10,
    observationNote: "Essaim de l’hémisphère Nord ; fenêtre utile entre le coucher de la Lune et l’aube.",
    sourceLabel: "NASA / American Meteor Society",
    sourceUrl: "https://science.nasa.gov/solar-system/meteors-meteorites/meteor-showers/",
  },
  {
    id: "quadrantids_2027",
    title: "Quadrantides",
    date: "2027-01-03",
    activeRange: "28 décembre–12 janvier",
    zhr: 120,
    observationNote: "Pic bref ; le calendrier AMS indique une fenêtre favorable pour l’Europe en 2027.",
    sourceLabel: "NASA / American Meteor Society",
    sourceUrl: "https://www.amsmeteors.org/meteor-showers/meteor-shower-calendar/",
  },
];

function skyLabel(cloudCoverMean: number) {
  if (cloudCoverMean <= 25) return "Ciel plutôt dégagé prévu";
  if (cloudCoverMean <= 60) return "Ciel variable prévu";
  return "Ciel possiblement nuageux";
}

function moonIllumination(phase: number | null) {
  return phase == null || !Number.isFinite(phase) ? null : Math.round(50 * (1 - Math.cos(Math.PI * 2 * phase)));
}

function formatDateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function calculateMoonMilestones(referenceInstant: Date, timeZone: string) {
  return MOON_TARGETS.flatMap((target) => {
    const instant = Astronomy.SearchMoonPhase(target.phase * 360, referenceInstant, 40)?.date;
    return instant ? [{ id: target.id, label: target.label, date: formatDateInTimeZone(instant, timeZone) } satisfies MoonMilestone] : [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildAstronomyOutlook(input: {
  dates: string[];
  moonPhases: Array<number | null>;
  daylightDurations: Array<number | null>;
  cloudCoverMeans: Array<number | null>;
  today: string;
  referenceInstant?: Date;
  timeZone?: string;
}): AstronomyOutlook {
  const timeZone = input.timeZone ?? "UTC";
  const referenceInstant = input.referenceInstant ?? new Date(`${input.today}T00:00:00.000Z`);
  const moonMilestones = calculateMoonMilestones(referenceInstant, timeZone);
  const nextSolarMilestone = SOLAR_MILESTONES.find((milestone) => milestone.date >= input.today) ?? null;
  const daylightChangeTomorrowSeconds = input.daylightDurations[0] != null && input.daylightDurations[1] != null
    ? Math.round(input.daylightDurations[1]! - input.daylightDurations[0]!)
    : null;
  const cloudByDate = new Map(input.dates.map((date, index) => [date, input.cloudCoverMeans[index] ?? null]));
  const moonPhaseByDate = new Map(input.dates.map((date, index) => [date, input.moonPhases[index] ?? null]));
  const upcomingEclipses = ECLIPSES
    .filter((event) => event.date >= input.today)
    .slice(0, 3)
    .map((event) => {
      const cloudCoverMean = cloudByDate.get(event.date);
      return {
        ...event,
        skyOutlook: cloudCoverMean != null && Number.isFinite(cloudCoverMean)
          ? { cloudCoverMean: Math.round(cloudCoverMean), label: skyLabel(cloudCoverMean), moonIllumination: moonIllumination(moonPhaseByDate.get(event.date) ?? null) }
          : null,
      };
    });
  const upcomingMeteorShowers = METEOR_SHOWERS
    .filter((event) => event.date >= input.today)
    .slice(0, 3)
    .map((event) => {
      const cloudCoverMean = cloudByDate.get(event.date);
      return {
        ...event,
        skyOutlook: cloudCoverMean != null && Number.isFinite(cloudCoverMean)
          ? { cloudCoverMean: Math.round(cloudCoverMean), label: skyLabel(cloudCoverMean), moonIllumination: moonIllumination(moonPhaseByDate.get(event.date) ?? null) }
          : null,
      };
    });
  const eclipseMapLayers = getEclipseVisibilityLayers(upcomingEclipses);
  const eventMapLayers = [
    ...eclipseMapLayers,
    ...getMeteorVisibilityLayers(upcomingMeteorShowers),
  ].sort((left, right) => left.date.localeCompare(right.date) || left.eventId.localeCompare(right.eventId));
  return { moonMilestones, nextSolarMilestone, daylightChangeTomorrowSeconds, upcomingEclipses, eclipseMapLayers, eventMapLayers, upcomingMeteorShowers };
}
