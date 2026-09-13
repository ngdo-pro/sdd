# PDR-001: Slug immuable après création

* **Status:** Accepted
* **Date:** 2026-09-13
* **Domain:** `spec-model`

---

## 1. Context & User Problem

Dans le layout v3, le slug d'un artefact est son répertoire dans `canonical/`. Renommer une initiative déplacerait son répertoire, tous ses contenus (features, specs nichées), les relations pointant vers lui, l'index et les projections. Aucune commande `spec rename` n'existe ; le seul chemin actuel est l'édition manuelle du JSON + `mv` — en zone canonique, ce qui viole le tenet « Souveraineté du modèle : toute écriture passe par l'outil dédié ».

## 2. Considered UX Options

* **Option A — Slug immuable:** le titre est modifiable à tout moment, le slug (donc le chemin) ne l'est jamais. Zéro code, prévisibilité totale des chemins, les refs distantes (Linear) restent alignées.
* **Option B — `spec rename <ref> --slug`:** relocation du répertoire + réécriture des relations + régénération de l'index et des projections + resync des mirrors distants. Confort réel mais surface de mutation supplémentaire et nouvelle classe d'erreurs de resynchronisation.

## 3. Product Decision

Option A : le slug est **immuable** après création. Un changement d'orientation majeur passe par une nouvelle initiative (et l'archivage de l'ancienne), pas par un renommage. La règle s'applique à tous les kinds (initiative, feature, spec).

## 4. Rationale & Impact

* Le slug est l'identité stable du graphe : chemins, relations, refs distantes. Le rendre immuable élimine une classe entière de mutations destructrices et de resyncs de mirrors.
* Impact workflow : le nommage est un acte de cadrage au moment de la création (`/initiative`, `/feature`) — renommer devient une décision stratégique, pas un réflexe. Courbe d'apprentissage : une seule règle, zéro exception.
* Non-goals : pas de rename dans ce milestone, pas d'alias de slug, pas d'exception pour les specs.