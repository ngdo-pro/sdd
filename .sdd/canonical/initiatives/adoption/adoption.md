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
