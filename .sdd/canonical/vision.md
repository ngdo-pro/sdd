## 1. Core Purpose (*The Why & Who*)

* **Mission:** Transformer le développement assisté par IA en un processus d'ingénierie orchestré, où des agents aux missions verrouillées exécutent un pipeline rigoureux et où l'humain conserve l'arbitrage.
* **The Problem:** Les agents IA codent vite mais sans gouvernance : aucune traçabilité entre l'intention, la décision et l'implémentation. La documentation se périmète, le contexte se perd entre les sessions, et les équipes qui délèguent massivement le code n'ont aucun moyen de prouver que ce qui est livré correspond à ce qui a été décidé.
* **Target Audience:** Les équipes produit et tech qui délèguent massivement le développement à des agents IA (Antigravity, Claude Code, opencode) et veulent industrialiser cette délégation avec des garde-fous process.
* **North Star Metric:** Le taux de conformité code ↔ spec, mesuré à chaque livraison par la revue clean-room et les quality gates — la preuve chiffrée que le pipeline gouverne réellement la livraison.

---

## 2. Experience Pillars

1. **Orchestration régie par rôles:** Chaque phase du cycle — discovery, delivery, knowledge — est pilotée par un orchestrateur spécialisé qui délègue à des agents aux missions verrouillées. L'humain arbitre, les agents exécutent : la rigueur du process ne dépend de la mémoire de personne.
2. **Modèle canonique, projections générées:** Une source de vérité unique détient chaque artefact ; les documents, roadmaps et issues distantes en sont des projections régénérées automatiquement. Zéro chirurgie manuelle, zéro drift entre ce qui est écrit, ce qui est suivi et ce qui est livré.
3. **Traçabilité de bout en bout:** L'intention, l'initiative, la feature, la spec et la PR restent reliées dans un graphe validable en CI et miroitable vers l'outil de tickets. La décision reste lisible jusqu'à la livraison — et après.

---

## 3. Product Tenets

* **Souveraineté du modèle:** Un référentiel canonique unique détient la vérité ; toute écriture passe par l'outil dédié. Éditer une projection à la main est une faute, pas une commodité.
* **Rigueur sur fluidité:** Quand la rigueur sémantique et le confort s'affrontent — validation de graphe, garde-fous CI — la rigueur gagne. L'écriture reste conversationnelle ; la validation ne se négocie pas.
* **Une page par artefact:** Aucun document ne dépasse la page scannable. Un artefact s'écrit en minutes via interview, pas en heures de rédaction.
* **Dry-run d'abord:** Toute mutation est prévisualisable avant application, idempotente en ré-exécution et réversible. L'outil n'est jamais destructif par surprise.

---

## 4. Guardrails (*What the Product Refuses to Be*)

* **NOT un gestionnaire de tickets:** Linear et Jira restent les maîtres des sprints ; le framework n'en est qu'un miroir traçable, jamais le tableau kanban du quotidien.
* **NOT un whiteboard jetable sans modèle:** Tout artefact doit être relié au graphe canonique. Une documentation décorative, hors modèle, est rejetée par principe.
* **NOT un générateur de code:** Le framework gouverne le process et orchestre les agents ; il n'implémente jamais à leur place. La valeur est dans la gouvernance, pas dans la génération.
