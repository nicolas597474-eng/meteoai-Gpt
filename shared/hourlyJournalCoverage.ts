/** Résumé du lot reçu, distinct d'une preuve d'écriture ou de qualité météo. */
export type HourlyJournalVariableSummary = {
  key: string;
  receivedCount: number;
  expectedCount: number;
  providerNullCount: number;
};
