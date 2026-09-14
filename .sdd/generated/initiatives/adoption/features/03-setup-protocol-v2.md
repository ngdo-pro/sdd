# Feature: Protocole /setup unifié

> **Parent Initiative:** `adoption`  
> **Status:** Archived  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-14  

---

## 1. Problem & Trigger

Deux portes d'entrée concurrentes existent : `sdd install` (câblage hôtes + init, aveugle aux workspaces existants et aux connecteurs) et le skill `/setup` (validation MCP only, présume un workspace existant). L'ancien skill `spec-driven-setup` (.specs/ Evaneos) ajoute une troisième voie obsolète. L'adoptant ne sait pas laquelle invoquer, et aucune ne couvre le parcours complet. Déclencheur : `/setup` sur n'importe quel repo (vierge, legacy `.specs/`, ou workspace existant).

---

## 2. Wireframe / Visual Behavior

```text
> /setup                                    ← unique point d'entrée, idempotent

  Agent: Je regarde le repo…
  · .specs/ détecté (legacy v2)   → je propose la migration :
      sdd migrate --dry-run            (plan affiché)
      On applique ? (oui/non)          ← jamais sans confirmation
  · .sdd/ absent                  → sdd install (câblage hôtes détectés + init)
  · .sdd/ existant                → sdd status, ajustements proposés en merge
  Agent: Un connecteur miroir ? (linear / aucun)
  User: linear
  Agent: [MCP discovery + validation team/labels — cf. phases 006]
         sdd connectors enable linear --teamKey=ENG --mcp.command=… --dry-run
         On applique ?
  ✔ workspace prêt — /vision pour démarrer le pipeline
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `/setup` dans n'importe quel repo — le skill démarre par un état des lieux (détection `.sdd/`, `.specs/`, hôtes agentiques) et n'exécute que les phases nécessaires.
2. **Interaction & Display:** chaque phase est conditionnelle et confirmée : migration legacy (dry-run → confirmation → `sdd migrate`), câblage hôtes + init (`sdd install`), connecteur (interview + validation MCP + dry-run `sdd connectors enable`).
3. **Validation & Persistence:** toute écriture passe par la CLI (`migrate`/`install`/`connectors enable`) après confirmation explicite ; l'agent n'édite jamais `.sdd/` ni les configs d'hôte.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** `/setup` démarre toujours par l'état des lieux (détection `.sdd/`, `.specs/`, hôtes) et n'exécute que les phases manquantes — idempotent de bout en bout.
* **INV-2:** `.specs/` détecté ⇒ migration proposée avec `sdd migrate --dry-run` affiché et confirmation explicite ; jamais de migration sans accord, jamais de migration avec workspace `.sdd/` valide déjà en place sans arbitrage présenté.
* **INV-3:** l'agent n'écrit jamais directement — toute mutation passe par `sdd migrate` / `sdd install` / `sdd connectors enable` avec dry-run préalable ; configs d'hôte et `.sdd/` jamais éditées à la main (rule 7).
* **INV-4:** la phase connecteur est optionnelle et repliable : sans MCP découvrable, deux options explicites (activer sans validation sémantique / rester local) — jamais d'échec silencieux, jamais de secret manipulé.
* **INV-5:** relancer `/setup` sur un workspace complet re-état des lieux, ne duplique rien, propose des ajustements en merge (sémantique idempotente des commandes sous-jacentes).

---

## 5. Out of Scope

* La mécanique CLI elle-même (migrate/install/connectors enable sont livrés) — la spec met à jour le protocole du skill.
* L'ancien skill `spec-driven-setup` (assets .specs/ Evaneos) — obsolète, retiré de l'hôte utilisateur, hors repo.
* La validation MCP de Linear (phase 3 de l'ex-006) — inchangée, réutilisée telle quelle.

---

## 6. Implementation Spec(s)

- [x] **`010-setup-protocol-v2`** : Protocole /setup unifié  
  ↳ *Spec:* [`generated/initiatives/adoption/specs/010.md`](../specs/010.md)
