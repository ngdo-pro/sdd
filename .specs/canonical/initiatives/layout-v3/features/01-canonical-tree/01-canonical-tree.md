## 1. Problem & Trigger

Le modèle actuel encode l'état du cycle de vie dans les chemins (`initiatives/<étatInit>/<slug>/<étatFeat>/`), pré-alloue douze répertoires d'état vides, isole les specs du reste du graphe (`specs/<état>/`) et maintient `decisions/` hors de `knowledge/`. Chaque création d'artefact ou transition d'état déclenche des déplacements physiques de fichiers et du bruit fantôme non tracké par git.

## 2. Wireframe / Visual Behavior

```text
<racine>/canonical/                 (racine = .sdd/ à partir de la feature 03 ; .specs/ d'ici là)
├── index.json
├── vision.{json,md}
└── initiatives/<slug>/
    ├── <slug>.{json,md}
    └── features/<slug>/
        ├── <slug>.{json,md}
        └── specs/<id>.{json,md}

<racine>/knowledge/
├── decisions/{architecture,product}/
└── domains/
```

Livraison : 1ʳᵉ de l'initiative (avant 02 et 03).

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `spec upsert <kind>` ou `spec move <ref> --to <state>`.
2. **Interaction & Display:** les fichiers sont écrits à leur emplacement canonique définitif (aucun répertoire d'état) ; l'état vit dans la métadonnée `state` et l'index.
3. **Validation & Persistence:** `spec validate` vérifie les invariants de chemin du nouveau layout.

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** aucun état de cycle de vie n'apparaît dans un chemin canonique.
* **INV-2:** `spec move` ne déplace aucun fichier — il mute la métadonnée `state`, l'index et les projections, rien d'autre.
* **INV-3:** **tous** les répertoires (y compris `knowledge/decisions/{architecture,product}/` et `domains/`) sont créés à la volée ; `spec init` ne pré-alloue aucun répertoire vide.
* **INV-4:** `knowledge/` regroupe `decisions/{architecture,product}/` et `domains/` ; le dossier `decisions/` disparaît du premier niveau.
* **INV-5:** les ids de spec restent uniques au niveau du modèle ; la grammaire `<ref>` par id nu est inchangée.
* **INV-6:** le slug d'initiative est immuable après création (le titre peut changer, jamais le chemin) — cf. PDR slug-immuable.
* **INV-7:** allocation d'id séquentielle, jamais de réutilisation après suppression ; au-delà de 999, 4 chiffres tolérés.

## 5. Out of Scope

* Le namespace généré (feature `02-generated-namespace`) et le renommage `.sdd` (feature `03-sdd-migration`).
* Toute commande de renommage de slug (le slug est immuable, cf. INV-6).
* La migration des workspaces v2 existants.
* Le mirroring Linear et les backends distants.
