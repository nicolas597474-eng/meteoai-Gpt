# Sources environnementales du Dashboard

- **Qualité de l’air** : Open-Meteo Air Quality API — `https://open-meteo.com/en/docs/air-quality-api`.
  - Paramètres retenus : `current=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone` et `hourly=european_aqi`.
  - Les prévisions européennes reposent sur CAMS Europe, à une résolution annoncée d’environ 11 km et actualisées toutes les 24 heures.
  - L’indice européen consolidé est le maximum des sous-indices ; intervalles documentés : 0–20 bon, 20–40 acceptable, 40–60 modéré, 60–80 mauvais, 80–100 très mauvais, au-delà extrêmement mauvais.

- **Soleil et lune** : Open-Meteo Weather Forecast API — `https://open-meteo.com/en/docs`.
  - Variables quotidiennes retenues : `sunrise`, `sunset`, `daylight_duration`, `moonrise`, `moonset`, `moon_phase`.
  - La requête inclut `timezone=Europe/Paris` afin de présenter les heures locales du lieu actif.

## Vérification directe du 15 août 2026 à Hondeghem

Les réponses directes des deux API ont confirmé le contrat utilisé par le Dashboard. La qualité de l’air a retourné un AQI européen courant de 31 à 07:00 Europe/Paris, les concentrations PM2.5, PM10, NO₂ et O₃, ainsi que 24 points horaires. L’API météo a retourné un lever de soleil à 06:37, un coucher à 21:11, une durée du jour de 52 412 secondes, un lever de lune à 10:02, un coucher à 21:59 et une phase lunaire fractionnaire de 0,097.

Le Dashboard local a ensuite affiché ces mêmes valeurs réelles dans les panneaux placés sous les deux graphiques, avec l’attribution « Open-Meteo / CAMS » et sans substituer de valeur lorsque la source est absente.

Les panneaux sont maintenant cliquables. La modale Qualité de l’air a été contrôlée avec les valeurs réellement retournées : AQI, PM2.5, PM10, NO₂, O₃ et le maximum prévu sur les 24 prochaines heures ; elle propose une fermeture explicite et conserve l’attribution de la source.

La modale Soleil et Lune a également été vérifiée : elle présente les levers et couchers de soleil et de lune, la durée du jour, la progression diurne, la phase et l’éclairage lunaire, avec un contrôle de fermeture explicite.
