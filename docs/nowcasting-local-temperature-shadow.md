# Nowcasting local de température — mode shadow

**Statut :** implémenté et observé en shadow uniquement.  
**Version :** `local-temperature-nowcasting-shadow-v1`  
**Périmètre :** température à 2 m, de l’heure du snapshot à **+6 h**.  
**Exclus :** tout lecteur public, toute écriture de prévision officielle, tout poids de production, Best Match.

## Objectif

Tester une correction locale de court terme à partir de :

1. une **observation physique qualifiée** déjà enregistrée ;
2. les **archives horaires déjà disponibles** au moment de cette observation ;
3. une ligne de base de sept modèles déterministes — AROME, ARPEGE, ICON, ECMWF, GFS, GEM et UKMET.

> Le module n’effectue aucun appel à un fournisseur météo. Il réutilise les snapshots et archives internes déjà stockés par MeteoAI.

## Séquence contrôlée

```text
Snapshot physique qualifié
        ↓
Archive horaire disponible avant le snapshot
        ↓
Base de température (fusion officielle qualifiée, sinon médiane shadow de 7 modèles)
        ↓
Résidu local = observation − base
        ↓
Résidu borné à ±3 °C et atténué sur 6 heures
        ↓
Candidat nowcasting shadow uniquement
```

## Règles de sécurité et d’alignement

| Garde-fou | Règle appliquée |
|---|---|
| Vérité terrain | Snapshot physique ayant au moins une station qualifiée et une température réelle |
| Fraîcheur | Au-delà de 90 minutes, statut `STALE_OBSERVATION` et aucune correction n’est produite |
| Disponibilité de la prévision | `forecastAvailableAt <= observationReferenceAt` obligatoire |
| Data leakage | Une prévision disponible après le snapshot reçoit `LEAKAGE_BLOCKED` ; aucune valeur corrigée n’est écrite |
| Horizon | 0 à +6 h seulement ; hors fenêtre, statut `UNAVAILABLE` |
| Correction | Résidu brut borné à ±3 °C, puis facteur de décroissance : 100 %, 75 %, 55 %, 35 %, 15 %, 5 %, 0 % |
| Sortie publique | Verrouillée : `productionReadsEnabled=0`, `appliedToProduction=0`, `shadowMode=1` |

## Ligne de base

La priorité est :

1. **fusion horaire officielle avec pondération historique qualifiée**, lorsqu’elle existe ;
2. sinon, **médiane des températures archivées des sept modèles déterministes**, marquée explicitement `seven_model_median_shadow`.

La médiane shadow ne remplace jamais la fusion officielle. Elle sert uniquement à obtenir une référence robuste de test tant que l’historique de pondération horaire reste insuffisant.

## Premier replay réel

Le replay du snapshot du **3 octobre 2026 à 09:00 Europe/Paris**, pour `50.756_2.521`, a créé sept candidats :

| Échéance | Base shadow | Observation | Correction | Candidat | Statut |
|---:|---:|---:|---:|---:|---|
| 0 h | 10,2 °C | 10,6 °C | +0,40 °C | 10,6 °C | `READY` |
| +1 h | 12,5 °C | 10,6 °C | −1,43 °C | 11,08 °C | `READY` |
| +2 h | 14,7 °C | 10,6 °C | −1,65 °C | 13,05 °C | `READY` |
| +3 h | 17,0 °C | 10,6 °C | −1,05 °C | 15,95 °C | `READY` |
| +4 h | 18,5 °C | 10,6 °C | −0,45 °C | 18,05 °C | `READY` |
| +5 h | 19,5 °C | 10,6 °C | −0,15 °C | 19,35 °C | `READY` |
| +6 h | 19,9 °C | 10,6 °C | 0,00 °C | 19,9 °C | `BASELINE_ONLY` |

Les sept archives utilisées étaient disponibles avant l’observation. Le contrôle a retourné **0 fuite temporelle**, **0 lecteur public**, **0 application en production** et **0 violation shadow**.

## Observation et critères avant toute décision produit

Avant toute proposition de branchement public, comparer les candidats aux observations physiques ultérieures sur plusieurs journées et au moins les fenêtres suivantes :

- 0–2 h ;
- 3–4 h ;
- 5–6 h.

Évaluer MAE, RMSE, biais, couverture des snapshots, fraîcheur et taux de blocage anti-fuite. Aucune promotion vers la production ne peut être déduite de ce premier replay.
