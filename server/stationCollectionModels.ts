export function getMissingModelNames(missingModels: unknown): string[] {
  return Array.isArray(missingModels)
    ? missingModels.filter((model): model is string => typeof model === "string")
    : [];
}

export function getCollectedModelNames(expectedModels: readonly string[], missingModels: unknown): string[] {
  const missing = new Set(getMissingModelNames(missingModels));
  return expectedModels.filter((model) => !missing.has(model));
}
