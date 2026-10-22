# Observation de gestion des tâches planifiées

Le 26 août 2026, la session propriétaire Manus a été ouverte avec succès. L’interface **Scheduled** est accessible et affiche les vues **Calendar** et **Tasks**. La vue calendrier montre les passages planifiés de l’Observatoire Météo ; l’exécution ponctuelle de v8 doit être recherchée depuis l’onglet Tasks, sans modifier les archives météo existantes.

La vue **Tasks** ne présente actuellement qu’une tâche **agent** intitulée « Observatoire Météo (Matin) », identifiée dans l’interface par `fqrLNUKT8euTkxyFZtbv2q`. Son prompt correspond à la formulation utilisateur sur une collecte de prévisions à 05:00, mais son écran d’édition expose uniquement les paramètres d’une tâche agent (titre, répétition quotidienne, prompt, connecteurs, projet) et ne l’identifie pas comme la tâche Heartbeat v8 (`YSVnbPqUuQkAB3y96C6WF3`). Aucune action « Run Now » pour v8 n’a été trouvée dans cette vue ; cette tâche agent n’est pas modifiée afin d’éviter de déclencher un flux non vérifié.

L’ouverture de la tâche MeteoAI depuis la liste globale de Manus mène à une conversation déjà marquée comme terminée, avec une proposition de copie, et non à la console de gestion du projet web. Cette vue ne fournit pas la commande d’exécution ponctuelle de la tâche Heartbeat v8. Aucune action de lancement n’a été envoyée.
