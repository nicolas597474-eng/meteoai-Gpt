ALTER TABLE `station_collection_snapshots`
  ADD COLUMN `dailyVariableCoverage` JSON NULL;

ALTER TABLE `hourly_forecast_collection_results`
  ADD COLUMN `variableCoverage` JSON NULL;
