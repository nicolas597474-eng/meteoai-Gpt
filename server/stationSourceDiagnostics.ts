export type StationSourceDiagnosticReason =
  | "network_error"
  | "timeout"
  | "provider_http_error"
  | "invalid_response"
  | "source_unavailable"
  | "source_error";

/** A source failure with a fixed safe category; provider details stay internal. */
export class StationSourceCollectionError extends Error {
  constructor(readonly reason: StationSourceDiagnosticReason) {
    super("Station source collection failed.");
    this.name = "StationSourceCollectionError";
  }
}

/** Normalize errors without reading or returning their message, URL, or payload. */
export function getStationSourceDiagnosticReason(error: unknown): StationSourceDiagnosticReason {
  if (error instanceof StationSourceCollectionError) return error.reason;
  if (!(error instanceof Error)) return "source_error";
  if (error.name === "AbortError" || error.name === "TimeoutError") return "timeout";
  if (error.name === "SyntaxError") return "invalid_response";
  if (error.name === "TypeError") return "network_error";
  return "source_error";
}
