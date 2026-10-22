# Ranking Page Design Specs (from mockup)

## Global
- Background: pure black (#000000)
- Font: system sans-serif, white text
- All cards: rounded-2xl (16px), bg very dark gray with subtle border
- Padding: 16px horizontal

## Section 1: Header
- Left: "📍 Hondeghem" (blue pin icon + white text)
- Right: "Mise à jour : 17:19" + refresh icon (gray text)

## Section 2: Hero Card (Detection IA)
- Layout: flex row
- Left (40%): landscape photo (the exact uploaded image), full height, object-cover, rounded-left
- Right (60%): dark card background
  - Top-left badge: "🔎 DÉTECTION IA" — small gray pill with white text
  - Top-right badge: "Aujourd'hui" — blue pill
  - Title: "Régimes actifs détectés" — white bold ~16px
  - Description: gray text ~12px, 2-3 lines
  - Bottom: 3 regime items side by side
    - Each: large weather icon (SVG/emoji ~32px), label below (white ~10px), percentage below (blue bold ~14px)
    - Example: Cloud icon "Ciel couvert" "60%" | Wind icon "Vent modéré" "25%" | Rain drops "Averses faibles" "15%"

## Section 3: Confidence Score
- Layout: flex row between
- Left: green shield icon (circle bg) + "Confiance globale" label + "87%" big bold white
- Right: "Voir détails >" button (gray border, small text)
- Below: full-width progress bar (green gradient, ~10px height, rounded-full, on dark track)

## Section 4: "Pourquoi ces régimes ?"
- Title: amber/orange color "Pourquoi ces régimes ?"
- Grid 4 columns (2 rows for 6 items, first row 4, second row 2)
- Each card: dark bg, rounded-xl, centered
  - Icon (colored SVG, ~20px)
  - Label (gray ~11px): "Température", "Précipitations", "Vent", "Couverture nuageuse", "Humidité", "Pression"
  - Value (white bold ~18px): "18.2 °C", "20%", "14 km/h", "92%", "78%", "1016 hPa"
  - Impact label (colored ~10px): "Impact : Élevé" (orange), "Impact : Modéré" (yellow), "Impact : Élevé" (orange)

## Section 5: "Pondération utilisée (combinaison des régimes)"
- Title: purple color
- Grid 6 columns
- Each item: centered
  - Icon (colored SVG ~16px)
  - Label (gray ~9px): "Température", "Nuages", "Précipitations", "Vent", "Humidité", "Pression"
  - Value (white bold ~14px): "25%", "30%", "20%", "10%", "10%", "5%"
  - Color bar below (thin ~4px, rounded, colored: red, blue, cyan, green, purple, amber)
- Footer note: "ℹ Les pondérations s'adaptent automatiquement en fonction de l'intensité de chaque régime."

## Section 6: "Tous les régimes possibles"
- Title: cyan color
- Grid 5 columns × 4 rows = 20 items
- Each item: small card, rounded-xl
  - Active: blue border + blue bg tint
  - Inactive: gray border, gray bg
  - Content: emoji (~24px), label (~9px white), percentage (~10px, green if active, gray if not)
- Items (row by row):
  Row 1: Ciel couvert 60% | Partiellement nuageux 30% | Peu nuageux 25% | Ensoleillé 15% | Brouillard 5%
  Row 2: Averses 15% | Pluie 10% | Orages 8% | Vent fort 8% | Neige 5%
  Row 3: Verglas/Gel 3% | Pluie verglaçante 2% | Gel 2% | Canicule 1% | Vague de froid 1%
  Row 4: Tempête 1% | Temps variable 10% | Printemps instable 10% | Été stable 15% | Automne perturbé 10%
- Footer: "✨ Sélection et pourcentages calculés automatiquement par l'IA en temps réel."

## Section 7: "Facteurs clés du moment"
- Title: amber color, smaller
- Horizontal flex wrap of pills
- Each pill: dark bg, rounded-lg, icon + label
  - "☁️ Haute couverture nuageuse"
  - "💧 Humidité élevée"
  - "🌡 Pression stable"
  - "🌧 Averses possibles"
  - "💨 Vent de sud-ouest modéré"

## Section 8: "Meilleur modèle" (bottom bar)
- Layout: flex row
- Left: trophy icon (gold circle bg) + "Meilleur modèle" label + "① UKMET" bold
- Center: "Score global" label + "91.2 /100" big bold
- Right: "Tendance" label + "↑ +2.3" green bold with arrow

## Bottom Navigation (already exists in app)
- 5 tabs: Dashboard | Classement | Historique | Stations | AI Lab
