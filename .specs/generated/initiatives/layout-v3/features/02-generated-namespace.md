# Feature: Namespace generated/

> **Parent Initiative:** `layout-v3`  
> **Status:** Archived  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-13  

---

## 1. Problem & Trigger

Les projections markdown sont éparpillées à la racine du workspace (`vision.md` isolée) et dans deux arbres parallèles au modèle : impossible de distinguer visuellement l'authored du généré — d'où la confusion récurrente « deux vision.md ».

## 2. Wireframe / Visual Behavior

```text
<racine>/generated/
├── vision.md
└── initiatives/<slug>/
    ├── README.md
    ├── features/<slug>.md
    └── specs/<id>.md
```

**Note d'intention:** `generated/` n'est pas un miroir 1:1 de `canonical/` — l'arborescence générée optimise la lecture (specs aplaties au niveau initiative, triées par id, liens croisés générés). Le modèle encode le graphe ; le rendu optimise la lecture.

Livraison : 2ᵉ de l'initiative (après 01, avant 03).

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `spec upsert`, `spec render` ou `spec done`.
2. **Interaction & Display:** toutes les projections sont écrites sous `generated/` ; aucune écriture de projection en dehors de ce namespace.
3. **Validation & Persistence:** `spec render --check` détecte tout drift entre modèle et projections (exit 1).

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** toute projection vit sous `generated/`, vision comprise — la racine ne contient que `config.json`, `canonical/`, `generated/`, `knowledge/` (et `site/` uniquement si la feature `04-static-site` est activée) ; `spec validate` traite toute autre entrée de racine comme une violation.
* **INV-2:** `generated/` est intégralement régénérable depuis le modèle : `spec render` purge tout fichier non projeté attendu (`knowledge/` est hors périmètre du render) ; toute suppression est listée dans la sortie et prévisualisable via `--dry-run`.
* **INV-3:** `spec render --check` échoue avec exit 1 sur tout drift, et ne couvre que `generated/`.
* **INV-4:** le CLI tolère l'absence de l'option `projections.markdown` dans la config (défaut : activé).

## 5. Out of Scope

* Le rendu HTML optionnel (feature `04-static-site`).
* La migration v2 → v3 (feature `03-sdd-migration`), y compris la conversion de `config.json`.

---

## 6. Implementation Spec(s)

- [x] **`002-generated-projections`** : Projections sous generated/  
  ↳ *Spec:* [`generated/initiatives/layout-v3/specs/002.md`](../specs/002.md)
