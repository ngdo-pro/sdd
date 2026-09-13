## 1. Problem & Trigger

Le graphe (initiatives → features → specs, progression) n'est navigable qu'en ouvrant les fichiers un par un ; un site statique offre une vue navigable du delivery sans jamais toucher aux artefacts.

## 2. Wireframe / Visual Behavior

```text
sdd render --site   →   .sdd/site/   (non commité)
index.html (dashboard) → initiative → feature → spec
badges d'état, progression, liens croisés
```

Livraison : déferrable — dernière de l'initiative (les features 01–03 délivrent 100 % de la valeur « layout »).

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd render --site`.
2. **Interaction & Display:** le site est généré depuis le même modèle, dans `.sdd/site/`, jamais commité ; l'entrée `.sdd/site/` du `.gitignore` racine est posée par le script de setup du workspace, pas par le rendu.
3. **Validation & Persistence:** régénérable à la demande ; le modèle reste la seule source de vérité.

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** le site est un artefact de consommation — jamais source de vérité, jamais commité.
* **INV-2:** générable sans dépendance runtime externe (zéro dépendance npm).
* **INV-3:** `sdd render --site` n'écrit que dans `.sdd/site/` — jamais le `.gitignore` racine ni quoi que ce soit hors `.sdd/`.
* **INV-4:** `sdd render --check` ne vérifie que `generated/` ; le site est exclusivement régénéré à la demande.

## 5. Out of Scope

* Hébergement et déploiement automatisés (GitHub Pages, CI).
* Serveur local de prévisualisation.
* Édition ou commentaire via le site (lecture seule).
* L'écriture du `.gitignore` racine (posée par le script de setup).

---

## 6. Sortie du Scope (2026-09-13)

**Cette feature est sortie du scope de l'initiative `layout-v3` sans livraison.** Le rendu de consommation HTML est reporté vers une future initiative dédiée (« consommation », à cadrer quand le besoin se présentera). Le périmètre layout v3 est soldé à 3/3 features livrées (specs 001-003, clean-room APPROVED). Un premier delivery de cette feature avait été livré puis intégralement reverté (commits `bafcefc` → `e2d29a7`) pour préserver la traçabilité code ↔ spec.
