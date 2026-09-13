# Domaine : Workspace Management (workspace-management) — Contrats d'API & Schémas

> **Spécification Formelle :** pas d'API réseau — le contrat de ce domaine est la **surface CLI `spec`** (`bin/spec.js`) et les **formats générés** (`index.json`, métadonnées schema v3).
> **Format d'échange :** JSON (métadonnées / index) + Markdown (corps / projections) ; sortie machine via `--json`.

---

## 1. Périmètre & Frontières des Contrats

* **Contrats gérés dans ce domaine :**
  * Commandes de cycle de vie : `init`, `upsert`, `move`, `done`, `link`.
  * Contrats de lecture / audit : `status`, `list`, `model`, `validate`, `render` (`--check`, `--dry-run`).
  * Contrat de rendu : `spec render` — projections markdown écrites exclusivement sous `.specs/generated/`, purge des orphelins + ancien arbre hérité listée, prévisualisable via `--dry-run`.
  * Format généré consommable : `.specs/canonical/index.json` (version 3 — champ `projection` reciblé vers `.specs/generated/…`).
* **Contrats délégués à d'autres domaines :**
  * *Import de markdown legacy :* `spec import` — gelé, obsolète après cutover (rework `spec migrate`, feature `03`).
  * *Mirroring distant :* `sync`, `backend` — le modèle canonique reste la seule vérité.

---

## 2. Cartographie des Endpoints (commandes CLI)

| Commande | Contrat d'entrée | Effet garanti | Erreur (exit ≠ 0, rien d'écrit) |
|---|---|---|---|
| `spec init` | `--force` | Crée exactement `.specs/`, `canonical/`, `config.json` — `generated/` n'est pas pré-alloué (il naît au premier rendu) | — |
| `spec upsert <kind>` | `--slug`, `--title`, `--from`, `--field` ; **spec exige `--feature`** | Écrit métadonnée + corps à l'emplacement canonique définitif ; dirs à la volée ; projections régénérées sous `generated/` | `UsageError` sans `--feature` |
| `spec move <ref>` | `--to planned\|active\|archived`, `--dry-run` | Mute `state` in situ ; régénère index + projections **au même chemin** (zéro mv, zéro rename) | `TransitionError` si illégale |
| `spec done <ref>` | `--cascade`, `--undo`, `--dry-run` | `progress.done` + archivage ; cascade sur parents dont tous les enfants sont complets | `ResolutionError` |
| `spec link <ref>` | `--feature <ref>` / `--initiative <slug>` | Écrit `relations` ; relocation des fichiers si le parent change (descendants inclus pour une feature) | `ResolutionError` |
| `spec render` | `--check` (lecture seule), `--dry-run` | Écrit les projections attendues sous `.specs/generated/` (dirs à la volée) ; purge les orphelins de `generated/` + l'arbre hérité (`specs/`, `initiatives/`, `vision.md`) ; table des changements `created` / `updated` / `removed` ; `--dry-run` : mêmes calculs sans aucune écriture, sortie terminée par `(dry-run: nothing was written)` ; `projections.markdown: false` : aucune projection markdown écrite (index régénéré) | `--check` : exit 1 sur tout drift (`stale`, `missing`, `unexpected`) — couverture limitée à `generated/` |
| `spec validate` | `--json` | Applique `portable-paths`, `invariant-traceability`, `canonical-layout`, `spec-id-uniqueness`, `graph-integrity`, `root-layout` (racine `.specs/` exhaustive : `config.json`, `canonical/`, `generated/`, `knowledge/` — dotfiles tolérés, `generated/` permise sans être exigée) | exit 1 si finding(s) |
| `spec model` | `--write` | Inspecte le graphe / régénère `index.json` | — |

---

## 3. Schémas de Validation Client / Consommateurs

*Entrée typique d'`index.json` v3 (consommé par agents, mirrors et scripts — généré par le CLI, ne jamais éditer à la main) :*

```json
{
  "kind": "spec",
  "id": "002",
  "slug": "002-generated-projections",
  "title": "Projections sous generated/",
  "state": "active",
  "meta": ".specs/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.json",
  "body": ".specs/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.md",
  "projection": ".specs/generated/initiatives/layout-v3/specs/002.md",
  "relations": { "feature": "02-generated-namespace", "initiative": "layout-v3" },
  "progress": { "done": false, "children": 0, "completedChildren": 0, "complete": false },
  "remote": {}
}
```

* **Format :** version 3 **inchangée** — seul le champ `projection` est reciblé vers `.specs/generated/…` (basculé par la feature `02` ; pas de version 4). Préfixes `meta`/`body` inchangés (`.specs/canonical/…`).
* **Grammaire des chemins de projection (namespace `generated/`) :** vision → `generated/vision.md` (une seule vision) ; initiative → `generated/initiatives/<slug>/README.md` ; feature → `generated/initiatives/<initiative>/features/<slug>.md` (aplatie au niveau initiative) ; spec → `generated/initiatives/<initiative>/specs/<id>.md` (nom de fichier = id seul, listes triées par id). Aucun segment d'état : un `spec move` régénère la projection au même chemin.
* **Conventions de nommage :** fichiers de spec = **`<id>.{json,md}`** (id seul, sans suffixe) ; grammaire de résolution `<ref>` : id nu (`042`), slug (`042-login`), chemin — inchangée.

---

## 4. Modèle Standard d'Erreur

| Condition | Erreur CLI | Garantie |
|---|---|---|
| Mauvais usage / option manquante (ex. `upsert spec` sans `--feature`) | `UsageError` | Aucun fichier écrit |
| Ref inconnue ou ambiguë | `ResolutionError` | Aucun fichier écrit |
| Transition d'état illégale ou état cible inconnu | `TransitionError` (liste les transitions permises) | Aucun fichier écrit |
| Drift de projections (`render --check`) : `stale`, `missing` ou `unexpected` sous `generated/` | findings listés, exit 1 | Lecture seule — `knowledge/` et les chemins hérités hors `generated/` ne sont jamais inspectés |
| Violation de règles (`validate`) | findings + exit 1 (dont `root-layout` pour toute entrée parasite de la racine `.specs/`) | Lecture seule, aucun effet de bord |
