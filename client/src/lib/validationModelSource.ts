export type ValidationModelSource = {
  type?: string;
  models?: string[];
};

export function getValidationModelSource<T extends ValidationModelSource>(sources?: T[] | null): T | null {
  return sources?.find((source) => source.type === "Collecte d'observation") ?? null;
}
