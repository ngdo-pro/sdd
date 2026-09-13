# Domaine : Workspace Management (workspace-management) — Comportement Produit

> **Mission :** Gouverner le workspace SDD : créer, lier, faire vivre et archiver les artefacts du modèle canonique (`vision`, `initiative`, `feature`, `spec`) via le CLI `spec`, avec un cycle de vie porté par les métadonnées — jamais par les chemins.
> **Acteurs & Personas :** Utilisateur humain (lead/dev qui pilote le process), Agent (orchestrateurs spécialisés : `/initiative`, `/feature`, `/spec`, `/sync-knowledge`…).

---

## 1. Périmètre & Frontières du Domaine (Bounded Context)

* **Ce qui relève de ce domaine (In Scope) :**
  * Bootstrap et layout du workspace : `.specs/canonical/` sans état, tout répertoire créé à la volée.
  * Cycle de vie des artefacts : cadrage du graphe, transitions d'état, achèvement en cascade.
  * Intégrité du graphe : relations, unicité des ids, dérivabilité des chemins.
* **Ce qui relève d'autres domaines (Out of Scope & Frontières) :**
  * *Rendu des projections :* délégué à `02-generated-namespace` — aujourd'hui projections interim v2 (cf. tech.md §6).
  * *Migration de workspaces :* délégué à `03-sdd-migration` (`spec migrate`, à venir).
  * *Mirroring distant :* Linear reste un miroir ; le modèle canonique est la seule vérité.

---

## 2. Vue d'Ensemble & Diagramme des Flux

```mermaid
flowchart TD
    Start([Workspace vierge ou existant]) --> Init[spec init — arbre minimal]
    Init --> Frame[Upsert initiative → feature → spec]
    Frame -->|dirs créés à la volée| Move[spec move — état muté in situ]
    Move --> Done[spec done --cascade — archivage métadonnées seules]
    Done --> Valid([spec validate exit 0 — graphe conforme])
    Frame -.->|sans --feature / ref inconnue| Err([UsageError / ResolutionError — rien d'écrit])
```

---

## 3. Cartographie des Parcours

| Réf | Parcours | Acteur principal | Déclencheur | Résultat visible |
|---|---|---|---|---|
| `PAR-WM-01` | Bootstrap du workspace | Utilisateur / Agent | `spec init` | `.specs/` + `canonical/` + `config.json`, rien d'autre |
| `PAR-WM-02` | Cadrer le graphe | Agent orchestrateur | `spec upsert <kind>` | Artefacts écrits à leur emplacement canonique définitif |
| `PAR-WM-03` | Piloter le cycle de vie | Utilisateur / Agent | `spec move <ref> --to <state>` | État muté, zéro fichier déplacé |
| `PAR-WM-04` | Achever & archiver en cascade | Agent orchestrateur | `spec done <ref> --cascade` | Spec puis parents complets archivés |

---

## 4. Fiches Détaillées des Parcours

### `PAR-WM-01` : Bootstrap du workspace
* **Acteur :** Utilisateur / Agent.
* **Prérequis :** répertoire de travail ; `--force` seul écrase une config existante.
* **Déclencheur :** `spec init`.
* **Déroulement nominal :** 1. création de `.specs/` et `.specs/canonical/` ; 2. écriture de `config.json` ; 3. aucun autre répertoire n'est pré-alloué.
* **Post-conditions :** workspace minimal ; le reste naît à la volée à la première écriture.

### `PAR-WM-02` : Cadrer le graphe
* **Acteur :** Agent orchestrateur (skills `/initiative`, `/feature`, `/spec`).
* **Prérequis :** workspace initialisé ; pour une spec, une feature parente existante.
* **Déclencheur :** `spec upsert <kind> --slug … [--feature <ref>]`.
* **Déroulement nominal :** 1. résolution du parent ; 2. dérivation des `relations` (l'initiative dérive de la feature) ; 3. écriture JSON + MD à l'emplacement définitif.
* **Post-conditions :** artefact indexé, projections régénérées ; re-upserter un slug existant met à jour titre/état in situ sans déplacer le répertoire.
* **Variantes :** *Re-parentage :* `spec link <ref> --feature|--initiative` change le parent et reloge les fichiers de la spec (et de ses descendants pour une feature) — seule opération qui déplace des fichiers.

### `PAR-WM-03` : Piloter le cycle de vie
* **Acteur :** Utilisateur / Agent.
* **Prérequis :** artefact existant ; transition cible légale : `planned → active|archived`, `active → planned|archived`, `archived → active`.
* **Déclencheur :** `spec move <ref> --to <state>` (saisie tolérante : `archive`, `Active`, `plan`…).
* **Déroulement nominal :** 1. mutation de `state` + `updatedAt` dans la métadonnée ; 2. régénération index + projections ; 3. confirmation de la transition.
* **Post-conditions :** arborescence bit-à-bit inchangée ; idempotent, `--dry-run` n'écrit rien.

### `PAR-WM-04` : Achever & archiver en cascade
* **Acteur :** Agent orchestrateur (`/sync-knowledge`), après quality gates verts.
* **Prérequis :** spec livrée ; parents à archiver identifiables par complétude des enfants.
* **Déclencheur :** `spec done <ref> [--cascade]`.
* **Déroulement nominal :** 1. `progress.done = true` + archivage de la spec ; 2. remontée : chaque parent dont **tous** les enfants sont complets est archivé à son tour ; 3. régénération des projections affectées.
* **Post-conditions :** `--undo` rouvre l'artefact en `active` ; aucun fichier déplacé.

---

## 5. Invariants & Règles Métier

* **`RULE-WM-01` (État en métadonnées) :** l'état de cycle de vie vit exclusivement dans la métadonnée `state` et l'index ; aucun chemin ne l'encode, `spec move` ne déplace aucun fichier.
* **`RULE-WM-02` (Slug immuable) :** le slug d'un artefact — donc son chemin — ne change jamais après création ; seul le titre est modifiable (PDR-001).
* **`RULE-WM-03` (Ids uniques et non réutilisés) :** l'id de spec est unique au niveau du modèle, alloué séquentiellement (max+1), jamais réalloué ; 3 ou 4 chiffres.
* **`RULE-WM-04` (Chemin dérivé des relations) :** tout chemin canonique dérive des slugs/ids et de `relations` seul ; une spec sans parent est rejetée avant toute écriture.
* **`RULE-WM-05` (Dry-run d'abord) :** toute mutation est prévisualisable (`--dry-run`), idempotente en ré-exécution, réversible (`done --undo`) ; toute erreur laisse le workspace intact.

---

## 6. Matrice des États, Échecs & Cas Limites

| Situation / Déclencheur | Comportement & Réaction visible | Action de reprise utilisateur |
|---|---|---|
| `spec upsert spec` sans `--feature` | UsageError « spec requires --feature », rien d'écrit | Lier la spec à une feature existante via `--feature` |
| Ref inconnue ou ambiguë (`move`, `done`, `link`) | ResolutionError, sortie non nulle, rien d'écrit | Vérifier la ref via `spec list` / `spec status` |
| Transition illégale (ex. `archived → planned`) | TransitionError listant les transitions permises | Repasser par `archived → active` ou choisir un état légal |
| Id de spec dupliqué (2 features distinctes) | `spec validate` → règle `spec-id-uniqueness`, exit 1 | Réallouer l'id du nouvel artefact (max+1) |
