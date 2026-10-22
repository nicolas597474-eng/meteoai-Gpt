export type TemperatureSeries = "hourly" | "maximum" | "minimum";

export type TemperatureTone = {
  status: "normal" | "heat" | "frost";
  stroke: string;
  glow: string;
  fill: string;
  label: string;
};

type ChartPoint = { x: number; y: number };

const HEAT_TONE: TemperatureTone = {
  status: "heat",
  stroke: "#f43f5e",
  glow: "rgba(244, 63, 94, 0.46)",
  fill: "#f43f5e",
  label: "#fecdd3",
};

const FROST_TONE: TemperatureTone = {
  status: "frost",
  stroke: "#22d3ee",
  glow: "rgba(34, 211, 238, 0.44)",
  fill: "#22d3ee",
  label: "#cffafe",
};

const NORMAL_TONES: Record<TemperatureSeries, TemperatureTone> = {
  hourly: {
    status: "normal",
    stroke: "#fb923c",
    glow: "rgba(249, 115, 22, 0.38)",
    fill: "#fb923c",
    label: "#ffedd5",
  },
  maximum: {
    status: "normal",
    stroke: "#fb923c",
    glow: "rgba(249, 115, 22, 0.38)",
    fill: "#fb923c",
    label: "#fdba74",
  },
  minimum: {
    status: "normal",
    stroke: "#60a5fa",
    glow: "rgba(96, 165, 250, 0.30)",
    fill: "#60a5fa",
    label: "#93c5fd",
  },
};

export function getTemperatureTone(value: number | null | undefined, series: TemperatureSeries): TemperatureTone {
  if (typeof value === "number" && value > 35) return HEAT_TONE;
  if (typeof value === "number" && value < 0) return FROST_TONE;
  return NORMAL_TONES[series];
}

export function drawTemperatureCurveSegments(
  context: CanvasRenderingContext2D,
  points: ChartPoint[],
  values: Array<number | null | undefined>,
  series: TemperatureSeries,
) {
  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const point = points[index];
    const previousValue = values[index - 1];
    const value = values[index];
    if (typeof previousValue !== "number" || !Number.isFinite(previousValue)
      || typeof value !== "number" || !Number.isFinite(value)) continue;
    const previousTone = getTemperatureTone(previousValue, series);
    const tone = getTemperatureTone(value, series);
    const midpointX = (previousPoint.x + point.x) / 2;

    const glow = context.createLinearGradient(previousPoint.x, previousPoint.y, point.x, point.y);
    glow.addColorStop(0, previousTone.glow);
    glow.addColorStop(1, tone.glow);
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.bezierCurveTo(midpointX, previousPoint.y, midpointX, point.y, point.x, point.y);
    context.strokeStyle = glow;
    context.lineWidth = 3.2;
    context.stroke();

    const line = context.createLinearGradient(previousPoint.x, previousPoint.y, point.x, point.y);
    line.addColorStop(0, previousTone.stroke);
    line.addColorStop(1, tone.stroke);
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.bezierCurveTo(midpointX, previousPoint.y, midpointX, point.y, point.x, point.y);
    context.strokeStyle = line;
    context.lineWidth = series === "minimum" ? 1.8 : 2.1;
    context.stroke();
  }
}
