# Domaine : Workspace Management (workspace-management) — Contrats d'API & Schémas

> **Spécification Formelle :** pas d'API réseau — le contrat de ce domaine est la **surface CLI `spec`** (`bin/spec.js`) et les **formats générés** (`index.json`, métadonnées schema v3).
> **Format d'échange :** JSON (métadonnées / index) + Markdown (corps / projections) ; sortie machine via `--json`.

---

## 1. Périmètre & Frontières des Contrats

* **Contrats gérés dans ce domaine :**
  * Commandes de cycle de vie : `init`, `upsert`, `move`, `done`, `link`.
  * Contrats de lecture / audit : `status`, `list`, `model`, `validate`, `render --check`.
  * Format généré consommable : `.specs/canonical/index.json` (version 3).
* **Contrats délégués à d'autres domaines :**
  * *Import de markdown legacy :* `spec import` — gelé, obsolète après cutover (feature `03`).
  * *Mirroring distant :* `sync`, `backend` — le modèle canonique reste la seule vérité.

---

## 2. Cartographie des Endpoints (commandes CLI)

| Commande | Contrat d'entrée | Effet garanti | Erreur (exit ≠ 0, rien d'écrit) |
|---|---|---|---|
| `spec init` | `--force` | Crée exactement `.specs/`, `canonical/`, `config.json` | — |
| `spec upsert <kind>` | `--slug`, `--title`, `--from`, `--field` ; **spec exige `--feature`** | Écrit métadonnée + corps à l'emplacement canonique définitif ; dirs à la volée | `UsageError` sans `--feature` |
| `spec move <ref>` | `--to planned\|active\|archived`, `--dry-run` | Mute `state` in situ ; régénère index + projections (zéro mv) | `TransitionError` si illégale |
| `spec done <ref>` | `--cascade`, `--undo`, `--dry-run` | `progress.done` + archivage ; cascade sur parents dont tous les enfants sont complets | `ResolutionError` |
| `spec link <ref>` | `--feature <ref>` / `--initiative <slug>` | Écrit `relations` ; relocation des fichiers si le parent change (descendants inclus pour une feature) | `ResolutionError` |
| `spec validate` | `--json` | Applique `portable-paths`, `invariant-traceability`, `canonical-layout`, `spec-id-uniqueness`, `graph-integrity` | exit 1 si finding(s) |
| `spec render --check` | `--dry-run` | Détecte tout drift modèle → projections | exit 1 si drift |
| `spec model` | `--write` | Inspecte le graphe / régénère `index.json` | — |

---

## 3. Schémas de Validation Client / Consommateurs

*Entrée typique d'`index.json` v3 (consommé par agents, mirrors et scripts — généré par le CLI, ne jamais éditer à la main) :*

```json
{
  "kind": "spec",
  "id": "001",
  "slug": "001-canonical-layout",
  "title": "Layout canonique v3",
  "state": "active",
  "meta": ".specs/canonical/initiatives/layout-v3/features/01-canonical-tree/specs/001.json",
  "body": ".specs/canonical/initiatives/layout-v3/features/01-canonical-tree/specs/001.md",
  "projection": ".specs/specs/active/001-canonical-layout.md",
  "relations": { "feature": "01-canonical-tree", "initiative": "layout-v3" },
  "progress": { "done": false, "children": 1, "completedChildren": 0, "complete": false },
  "remote": {}
}
```

* Conventions de nommage : fichiers de spec = **`<id>.{json,md}`** (id seul, sans suffixe — cf. tech.md §6, ne pas « réparer ») ; grammaire de résolution `<ref>` : id nu (`042`), slug (`042-login`), chemin — inchangée.
* *Interim :* le champ `projection` pointe les chemins v2 (dirs d'état) jusqu'à la feature `02-generated-namespace`.

---

## 4. Modèle Standard d'Erreur

| Condition | Erreur CLI | Garantie |
|---|---|---|
| Mauvais usage / option manquante (ex. `upsert spec` sans `--feature`) | `UsageError` | Aucun fichier écrit |
| Ref inconnue ou ambiguë | `ResolutionError` | Aucun fichier écrit |
| Transition d'état illégale ou état cible inconnu | `TransitionError` (liste les transitions permises) | Aucun fichier écrit |
| Violation de règles (`validate`, `render --check`) | findings + exit 1 | Lecture seule, aucun effet de bord |
