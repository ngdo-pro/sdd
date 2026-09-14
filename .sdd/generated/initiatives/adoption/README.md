# Initiative: Distribution et adoption

> **Type:** Product / UX  
> **Initiative Slug:** `adoption`  
> **Owner:** TBD  
> **Status:** Archived  
> **Started:** 2026-09-14  

---

## 1. Intent & The Gap

* **Today:** Installer le framework dans un repo cible demande une opération manuelle par hôte agentique : symlink ou paths vers `skills/`/`agents/` (`.claude/`, `.agents/`, `opencode.json`), puis `sdd init`. Chaque adoptant réinvente le câblage — et la distribution npm/npx livre le binaire mais pas le pipeline (80 % de la valeur).
* **Tomorrow:** Une commande unique : `sdd install` détecte l'hôte agentique du repo cible, câble skills/agents/templates pour cet hôte (fichiers de liaison, jamais de copie divergente), puis enchaîne `sdd init`. Le collègue n'a qu'une commande : `npx shodo install` (ou `sdd install` après install global).

---

## 2. Target System Architecture & Interface Diagram

```text
sdd install [--host auto|opencode|claude|agents] [--dry-run] [--init/--no-init]
     │
     ├─ détecte l'hôte : opencode.json → .agents/ → .claude/ → auto
     ├─ câble skills/agents/templates : opencode.json (skills.paths) / symlinks .claude/ & .agents/
     ├─ jamais de divergence : pointe vers les fichiers du package installé (node_modules/shodo)
     └─ enchaîne sdd init (skippable, idempotent)
```

---

## 3. Strategic Invariants & Guardrails

* **Idempotent & réversible :** re-install = merge/no-op ; les câblages sont identifiables et retirables (`sdd install --undo`).
* **Source de vérité du package :** les paths pointent vers le module installé — jamais de copie de skills/agents (zéro drift de version).
* **Dry-run d'abord :** prévisualisation du câblage avant application, héritée des tenets du framework.

---

## 4. Feature Roadmap

*Ordered sequence of discrete features planned for this initiative:*

- [x] **`01-install-command`**: Commande sdd install  
  ↳ *Feature:* [`generated/initiatives/adoption/features/01-install-command.md`](./features/01-install-command.md)  *(Archived ✅)*
- [x] **`02-update-notice`**: Notice de mise à jour  
  ↳ *Feature:* [`generated/initiatives/adoption/features/02-update-notice.md`](./features/02-update-notice.md)  *(Archived ✅)*
- [x] **`03-setup-protocol-v2`**: Protocole /setup unifié  
  ↳ *Feature:* [`generated/initiatives/adoption/features/03-setup-protocol-v2.md`](./features/03-setup-protocol-v2.md)  *(Archived ✅)*
- [x] **`04-update-cache-invalidation`**: Invalidation du cache update-check au changement de version  
  ↳ *Feature:* [`generated/initiatives/adoption/features/04-update-cache-invalidation.md`](./features/04-update-cache-invalidation.md)  *(Archived ✅)*
