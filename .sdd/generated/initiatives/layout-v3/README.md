# Initiative: SDD Layout v3

> **Type:** Architecture / Tech  
> **Initiative Slug:** `layout-v3`  
> **Owner:** TBD  
> **Status:** Planned  
> **Started:** 2026-09-13  

---

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

* **État en métadonnées uniquement:** aucun état de cycle de vie n'apparaît dans un chemin ; `spec move` ne déplace plus aucun fichier, il ne mute que les métadonnées et l'index.
* **Séparation authored/généré visible:** `canonical/` et `knowledge/` sont les seules zones éditables ; `generated/` est intégralement régénérable et vérifié par `spec render --check`.
* **Migration idempotente:** `spec migrate` convertit un workspace v2 (`.sdd/`) vers v3 (`.sdd/`) sans perte, ré-exécutable sans effet de bord, et le graphe (ids, relations, progress) est préservé.

---

## 4. Feature Roadmap

*Ordered sequence of discrete features planned for this initiative:*

- [x] **`01-canonical-tree`**: Arborescence canonique v3  
  ↳ *Feature:* [`generated/initiatives/layout-v3/features/01-canonical-tree.md`](./features/01-canonical-tree.md)  *(Archived ✅)*
- [x] **`02-generated-namespace`**: Namespace generated/  
  ↳ *Feature:* [`generated/initiatives/layout-v3/features/02-generated-namespace.md`](./features/02-generated-namespace.md)  *(Archived ✅)*
- [x] **`03-sdd-migration`**: Racine .sdd et migration idempotente  
  ↳ *Feature:* [`generated/initiatives/layout-v3/features/03-sdd-migration.md`](./features/03-sdd-migration.md)  *(Archived ✅)*
- [ ] **`04-static-site`**: Site statique optionnel  
  ↳ *Feature:* [`generated/initiatives/layout-v3/features/04-static-site.md`](./features/04-static-site.md)  *(Framed ✅ — Ready for `/spec`)*
