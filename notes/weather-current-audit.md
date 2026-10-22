# Audit de cohérence météo actuelle — 16 août 2026

- La réponse courante de la source au point de Hondeghem indique, à 11:45 Europe/Paris, 22,9 °C, 0 mm de précipitation, 68 % de nébulosité et le code WMO 2 (« Partiellement nuageux »).
- L’ancien flux affichait seulement la prévision de la tranche horaire 11:00 et déduisait la condition à partir de la nébulosité et des précipitations, ce qui pouvait produire une température et un ciel périmés ou trop génériques.
- La collecte horaire privilégie désormais la donnée actuelle à 15 minutes pour la tranche en cours et traduit le code WMO source, tout en conservant les prévisions horaires pour les autres créneaux.
