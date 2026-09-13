# Feature: Site statique optionnel

> **Parent Initiative:** `layout-v3`  
> **Status:** Planned  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-13  

---

## 1. Problem & Trigger

Le graphe (initiatives → features → specs, progression) n'est navigable qu'en ouvrant les fichiers un par un ; un site statique offre une vue navigable du delivery sans jamais toucher aux artefacts.

## 2. Wireframe / Visual Behavior

```text
spec render --site   →   .sdd/site/   (non commité)
index.html (dashboard) → initiative → feature → spec
badges d'état, progression, liens croisés
```

Livraison : déferrable — dernière de l'initiative (les features 01–03 délivrent 100 % de la valeur « layout »).

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `spec render --site`.
2. **Interaction & Display:** le site est généré depuis le même modèle, dans `.sdd/site/`, jamais commité ; l'entrée `.sdd/site/` du `.gitignore` racine est posée par le script de setup du workspace, pas par le rendu.
3. **Validation & Persistence:** régénérable à la demande ; le modèle reste la seule source de vérité.

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** le site est un artefact de consommation — jamais source de vérité, jamais commité.
* **INV-2:** générable sans dépendance runtime externe (zéro dépendance npm).
* **INV-3:** `spec render --site` n'écrit que dans `.sdd/site/` — jamais le `.gitignore` racine ni quoi que ce soit hors `.sdd/`.
* **INV-4:** `spec render --check` ne vérifie que `generated/` ; le site est exclusivement régénéré à la demande.

## 5. Out of Scope

* Hébergement et déploiement automatisés (GitHub Pages, CI).
* Serveur local de prévisualisation.
* Édition ou commentaire via le site (lecture seule).
* L'écriture du `.gitignore` racine (posée par le script de setup).

---

## 6. Implementation Spec(s)

- [ ] **`004-static-site`** : Site statique de consommation  
  ↳ *Spec:* [`generated/initiatives/layout-v3/specs/004.md`](../specs/004.md)
