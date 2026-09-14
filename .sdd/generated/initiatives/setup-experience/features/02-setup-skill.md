# Feature: Skill /setup — interview et validation MCP

> **Parent Initiative:** `setup-experience`  
> **Status:** Archived  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-14  

---

## 1. Problem & Trigger

Le CLI valide la structure mais pas la sémantique : un `teamKey` erroné ou un label inexistant ne sautent qu'au premier `sdd sync`, après coup. Déclencheur : l'adoptant lance le skill `/sdd-setup` (conversationnel) pour être guidé, interviewé, et recevoir une configuration **validée en amont** contre les vraies sources (MCP Linear/GitHub).

---

## 2. Wireframe / Visual Behavior

```text
> /setup

  Agent: Quel connecteur veux-tu activer ? (linear / github / aucun)
  User:  linear
  Agent: [MCP linear] list_teams → team "ENG" trouvé ✔
  Agent: Labels d'issues à utiliser ? (défaut: initiative, feature, spec)
  User:  spec=SPEC
  Agent: [MCP linear] labels valides ✔
  Agent: J'applique :
         sdd init --connector linear --linear.teamKey=ENG --linear.labels.spec=SPEC
         (dry-run affiché, puis application après confirmation)
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** l'adoptant invoque `/sdd-setup` dans un repo sans `.sdd/` (ou avec un workspace à étendre).
2. **Interaction & Display:** l'agent interviewe (connecteurs, settings), interroge le MCP du connecteur pour vérifier chaque valeur déclarée (Linear : teams, labels ; GitHub : repo), montre le dry-run de la commande CLI qu'il s'apprête à exécuter.
3. **Validation & Persistence:** après confirmation, l'agent exécute la commande `sdd init` / `sdd connectors enable` avec les flags validés ; le CLI persiste (la responsabilité d'écriture reste au CLI — l'agent n'édite jamais config.json).

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** l'agent ne passe au CLI que des valeurs vérifiées via MCP ; toute valeur non vérifiable est marquée comme telle dans la synthèse présentée à l'humain avant application.
* **INV-2:** MCP indisponible ou en erreur → l'agent le dit explicitement et propose le repli (activer le connecteur sans validation sémantique, ou rester local) ; il n'échoue jamais silencieusement.
* **INV-3:** l'agent n'écrit jamais `.sdd/config.json` ni aucun fichier modèle directement — toute persistence passe par les commandes `sdd` (rule 7), dry-run affiché avant application.
* **INV-4:** le skill est idempotent : relancé sur un workspace déjà configuré, il détecte l'existant, propose des ajustements (fusion via re-init) et ne duplique rien.

---

## 5. Out of Scope

* L'implémentation des serveurs MCP eux-mêmes (Linear MCP / GitHub MCP sont des dépendances de l'environnement hôte).
* La mécanique CLI (flags, seeding manifest, validate) — feature `01-declarative-init`.
* Le connecteur GitHub et sa validation MCP — future feature.

---

## 6. Implementation Spec(s)

- [x] **`006-setup-skill`** : Skill /setup — interview et validation MCP  
  ↳ *Spec:* [`generated/initiatives/setup-experience/specs/006.md`](../specs/006.md)
