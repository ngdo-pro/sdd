## 1. Intent & The Gap

* **Today:** la structure produite cumule cinq défauts : deux états imbriqués dans un même chemin (`initiatives/<étatInit>/<slug>/<étatFeat>/`), douze répertoires d'état pré-créés vides et non trackés par git, l'incohérence `archived`/`archive`, la confusion canonique/généré (deux `vision.md` sans signal visuel), et `decisions/`/`knowledge/` hors modèle qui échappent au canon du single writer.
* **Tomorrow:** un layout où l'état vit exclusivement dans les métadonnées (une transition ne déplace aucun fichier), une séparation visuelle triviale entre authored (`canonical/`, `knowledge/`) et généré (`generated/`), une racine `.sdd/` alignée sur le nom du framework, et une migration idempotente des workspaces existants.

## 2. Target System Architecture

```text
.sdd/
├── config.json
├── canonical/                      # source de vérité (état en métadonnées)
│   ├── index.json
│   ├── vision.{json,md}
│   └── initiatives/<slug>/
│       ├── <slug>.{json,md}
│       └── features/<slug>/
│           ├── <slug>.{json,md}
│           └── specs/<id>.{json,md}
├── generated/                      # 100% généré par le CLI — jamais édité
│   ├── vision.md
│   └── initiatives/<slug>/ (README.md, features, specs)
└── knowledge/                      # authored — capitalisation
    ├── decisions/{architecture,product}/
    └── domains/
```

## 3. Strategic Invariants & Guardrails

* **État en métadonnées uniquement:** aucun état de cycle de vie n'apparaît dans un chemin ; `sdd move` ne déplace plus aucun fichier, il ne mute que les métadonnées et l'index.
* **Séparation authored/généré visible:** `canonical/` et `knowledge/` sont les seules zones éditables ; `generated/` est intégralement régénérable et vérifié par `sdd render --check`.
* **Migration idempotente:** `sdd migrate` convertit un workspace v2 (`.sdd/`) vers v3 (`.sdd/`) sans perte, ré-exécutable sans effet de bord, et le graphe (ids, relations, progress) est préservé.
