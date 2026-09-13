# Domaine : Workspace Management (workspace-management) — Contrats d'API & Schémas

> **Spécification Formelle :** pas d'API réseau — le contrat de ce domaine est la **surface CLI `spec`** (`bin/spec.js`) et les **formats générés** (`index.json`, `config.json`, métadonnées schema v3).
> **Format d'échange :** JSON (métadonnées / index / config) + Markdown (corps / projections) ; sortie machine via `--json`.

---

## 1. Périmètre & Frontières des Contrats

* **Contrats gérés dans ce domaine :**
  * Commandes de cycle de vie : `init`, `upsert`, `move`, `done`, `link`.
  * Contrats de lecture / audit : `status`, `list`, `model`, `validate`, `render` (`--check`, `--dry-run`).
  * Contrat de rendu : `spec render` — projections markdown écrites exclusivement sous `.sdd/generated/`, purge des orphelins de `generated/` listée et prévisualisable via `--dry-run` (l'horizon de purge est limité à `generated/` — l'ancien sweep de l'arbre hérité est tombé avec la feature `03`).
  * Contrat de migration : `spec migrate` — détection déterministe de layout, plan `--dry-run`, reconstruction intégrale depuis les métadonnées, gate strict, suppression de la source au succès, marker d'échec sinon (livrée : feature `03`).
  * Format généré consommable : `.sdd/canonical/index.json` (version 3 — champ `projection` reciblé vers `.sdd/generated/…`).
* **Contrats délégués à d'autres domaines :**
  * *Conversion de markdown legacy :* `spec import` — re-ownée (patch de compat levé) : conversion complète via le finish partagé de la migration ; refuse (exit 2) si un modèle JSON existe → orienter `spec migrate`.
  * *Mirroring distant :* `sync`, `backend` — le modèle canonique reste la seule vérité ; la migration ne déclenche aucune resynchronisation (refs `remote` copiées telles quelles).

---

## 2. Cartographie des Endpoints (commandes CLI)

| Commande | Contrat d'entrée | Effet garanti | Erreur (exit ≠ 0, rien d'écrit) |
|---|---|---|---|
| `spec init` | `--force` | Crée exactement `.sdd/`, `canonical/`, `config.json` — `generated/` n'est pas pré-alloué (il naît au premier rendu) | — |
| `spec upsert <kind>` | `--slug`, `--title`, `--from`, `--field` ; **spec exige `--feature`** | Écrit métadonnée + corps à l'emplacement canonique définitif ; dirs à la volée ; projections régénérées sous `generated/` | `UsageError` sans `--feature` |
| `spec move <ref>` | `--to planned\|active\|archived`, `--dry-run` | Mute `state` in situ ; régénère index + projections **au même chemin** (zéro mv, zéro rename) | `TransitionError` si illégale |
| `spec done <ref>` | `--cascade`, `--undo`, `--dry-run` | `progress.done` + archivage ; cascade sur parents dont tous les enfants sont complets | `ResolutionError` |
| `spec link <ref>` | `--feature <ref>` / `--initiative <slug>` | Écrit `relations` ; relocation des fichiers si le parent change (descendants inclus pour une feature) | `ResolutionError` |
| `spec migrate` | `--dry-run`, `--json` | Détection **déterministe** du layout (seuls marqueurs lus : `config.json` + `index.json` — jamais d'heuristique de disque) ; `--dry-run` : plan complet (artefacts par kind, divergences `position-mismatch` / `state-mismatch` / `unresolved-relations` (bloquante) / `legacy-residue`, réécritures de tokens fichier par fichier, mentions non réécrites listées, warnings de conversion config, suppressions planifiées) terminé par `(dry-run: nothing was written)` — exit 0 même si des divergences bloquantes existent (abort planifié) ; exécution : reconstruction intégrale depuis les métadonnées (un `.sdd/` partiel est effacé, jamais fusionné), gate strict (0 finding `validate` ET 0 drift `render --check`), suppression de `.sdd/` au succès ; second appel = no-op (« already migrated », exit 0) | `MigrationError` exit 1 : layout non identifiable (message orienté récupération git / `spec import` / `spec init`), relation non résolue (abort avant toute écriture), gate en échec (marker `.sdd/.migration-failed.json` écrit, source conservée) |
| `spec render` | `--check` (lecture seule), `--dry-run` | Écrit les projections attendues sous `.sdd/generated/` (dirs à la volée) ; purge les orphelins de `generated/` ; table des changements `created` / `updated` / `removed` ; `--dry-run` : mêmes calculs sans aucune écriture, sortie terminée par `(dry-run: nothing was written)` ; `projections.markdown: false` : aucune projection markdown écrite (index régénéré) | `--check` : exit 1 sur tout drift (`stale`, `missing`, `unexpected`) — couverture limitée à `generated/` |
| `spec validate` | `--json` | Applique `portable-paths` (forme absolue — slash initial suivi de `.sdd/…` — = violation ; mention nue `.sdd/…` = workspace-relatif tolérée, verrouillée par test), `invariant-traceability`, `canonical-layout`, `spec-id-uniqueness`, `graph-integrity`, `root-layout` (racine `.sdd/` exhaustive : `config.json`, `canonical/`, `generated/`, `knowledge/` — fichiers cachés tolérés dont le marker de migration, `generated/` permise sans être exigée) | exit 1 si finding(s) |
| `spec model` | `--write` | Inspecte le graphe / régénère `index.json` | — |
| `spec import` | `--dry-run`, `--force`, `--json` | Conversion complète des markdown legacy v2 sous `.sdd/` : relations dérivées du **contenu** (section `## 6.` → spec parente ; bloc Parent Initiative → initiative), tokens de racine des corps réécrits, finish partagé avec la migration (index + projections + gate strict + suppression de `.sdd/` au succès) | `UsageError` exit 2 si un modèle JSON existe (`.sdd/canonical/index.json` ou `.sdd/model/index.json`) → orienter `spec migrate` |

> **Garde de coexistence (INV-5 de la feature `03`) :** tant que `.sdd/` et `.specs/` coexistent, toute commande mutatrice est refusée (`MigrationError`, exit 1 — « relancez `spec migrate` ») : `upsert`, `move`, `done`, `link`, `render` (mode écriture), `import` (y compris `--dry-run`), `init --force`, `model --write`, `sync`, `backend enable/disable`. Les lectures (`status`, `list`, `validate`, `render --check` / `--dry-run`, `model` en lecture) opèrent sur `.sdd/` uniquement. `spec migrate` s'affranchit explicitement du garde — c'est l'outil de reprise.

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
  "meta": ".sdd/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.json",
  "body": ".sdd/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.md",
  "projection": ".sdd/generated/initiatives/layout-v3/specs/002.md",
  "relations": { "feature": "02-generated-namespace", "initiative": "layout-v3" },
  "progress": { "done": false, "children": 0, "completedChildren": 0, "complete": false },
  "remote": {}
}
```

* **Format :** version 3 **inchangée** — seul le champ `projection` est reciblé vers `.sdd/generated/…` (basculé par la feature `02` ; pas de version 4). Préfixes `meta`/`body` inchangés (`.sdd/canonical/…`). La migration préserve ce format tel quel : les préfixes dérivent de la racine, aucune conversion de format (pas de version 4).
* **Grammaire des chemins de projection (namespace `generated/`) :** vision → `generated/vision.md` (une seule vision) ; initiative → `generated/initiatives/<slug>/README.md` ; feature → `generated/initiatives/<initiative>/features/<slug>.md` (aplatie au niveau initiative) ; spec → `generated/initiatives/<initiative>/specs/<id>.md` (nom de fichier = id seul, listes triées par id). Aucun segment d'état : un `spec move` régénère la projection au même chemin.
* **Conventions de nommage :** fichiers de spec = **`<id>.{json,md}`** (id seul, sans suffixe) ; grammaire de résolution `<ref>` : id nu (`042`), slug (`042-login`), chemin — inchangée.
* **Grammaire des chemins portables (règle `portable-paths` — arbitrage 10 de la feature `03`) :** tout chemin référencé dans un corps est **workspace-relatif** : `.sdd/canonical/…`, `.sdd/generated/…`, `.sdd/knowledge/…` (mention nue, sans slash initial — tolérée et verrouillée par test). La **forme absolue** — slash initial suivi de `.sdd/…` (chemin ancré hors workspace) — est une violation `portable-paths`.
* **Convention de chemins du modèle (post-bascule `03`) :** chemins de modèle = `.sdd/canonical/initiatives/<initiative>/features/<feature>/specs/<id>.{json,md}` (jamais la forme héritée `model/…`) ; projections = `.sdd/generated/…` ; config = `.sdd/config.json` ; knowledge = `.sdd/knowledge/…` ; index = `.sdd/canonical/index.json` ; marker de migration = `.sdd/.migration-failed.json`.

*Schéma de `config.json` v3 (consommé par le CLI — la conversion `convertConfig` force `version: 3`, retire toute clé top-level inconnue et tout backend `filesystem` avec warning listé) :*

```json
{
  "version": 3,
  "sourceOfTruth": "model",
  "projections": { "markdown": true },
  "backends": []
}
```

* Clés conservées : `version` (const 3), `sourceOfTruth`, `projections`, `backends` ; le backend `filesystem` est intrinsèque en v3 et n'y figure plus.

---

## 4. Modèle Standard d'Erreur

| Condition | Erreur CLI | Garantie |
|---|---|---|
| Mauvais usage / option manquante (ex. `upsert spec` sans `--feature`) | `UsageError` | Aucun fichier écrit |
| Ref inconnue ou ambiguë | `ResolutionError` | Aucun fichier écrit |
| Transition d'état illégale ou état cible inconnu | `TransitionError` (liste les transitions permises) | Aucun fichier écrit |
| Layout non identifiable (`spec migrate`) : markdown seul sans `index.json`, index corrompu ou version inattendue | `MigrationError` (code `MIGRATION_ERROR`), exit 1, message orienté : récupération git / `spec import` / `spec init` | Jamais d'heuristique de layout — rien d'écrit |
| Relation non résolue (`spec migrate` en écriture) : artefact référencé par aucune feature/initiative | `MigrationError`, exit 1 (abort avant toute écriture ; prévisualisable en `--dry-run` comme divergence bloquante `unresolved-relations`) | Rien d'écrit |
| Gate strict en échec (`spec migrate` / `spec import`) : findings `validate` ≠ 0 ou drift `render --check` ≠ 0 | `MigrationError`, exit 1 ; marker `.sdd/.migration-failed.json` écrit : `{ "failedAt", "stage": "validate\|render-check", "message" }` | Source `.sdd/` conservée intégralement — reprise : corriger la cause puis relancer `spec migrate` (reprise de zéro) |
| Coexistence `.specs/` + `.sdd/` sur une commande mutatrice | `MigrationError`, exit 1 — « relancez `spec migrate` » | Rien d'écrit par la commande refusée ; les lectures opèrent sur `.sdd/` uniquement |
| Modèle JSON existant lors d'un `spec import` | `UsageError`, exit 2 — oriente `spec migrate` | Rien d'écrit |
| Drift de projections (`render --check`) : `stale`, `missing` ou `unexpected` sous `generated/` | findings listés, exit 1 | Lecture seule — `knowledge/` et les chemins hors `generated/` ne sont jamais inspectés |
| Violation de règles (`validate`) | findings + exit 1 (dont `root-layout` pour toute entrée parasite de la racine `.sdd/`) | Lecture seule, aucun effet de bord |
