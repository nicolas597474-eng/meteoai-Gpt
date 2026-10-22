export const TEMPERATURE_TICK_STEP = 10;

export function getChartTemperatureScale(values: Array<number | null | undefined>, padding: number) {
  const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const dataHigh = available.length > 0 ? Math.max(...available) : 0;
  const dataLow = available.length > 0 ? Math.min(...available) : 0;
  const scaleTop = Math.ceil((dataHigh + padding) / TEMPERATURE_TICK_STEP) * TEMPERATURE_TICK_STEP;
  const scaleBot = Math.floor((dataLow - padding) / TEMPERATURE_TICK_STEP) * TEMPERATURE_TICK_STEP;

  return {
    scaleTop,
    scaleBot,
    scaleRange: scaleTop - scaleBot || TEMPERATURE_TICK_STEP,
    gridStep: TEMPERATURE_TICK_STEP,
    ticks: Array.from(
      { length: Math.max(0, Math.round((scaleTop - scaleBot) / TEMPERATURE_TICK_STEP) + 1) },
      (_, index) => scaleBot + index * TEMPERATURE_TICK_STEP,
    ),
  };
}
