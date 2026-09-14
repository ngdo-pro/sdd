## 1. Intent & The Gap

* **Today:** Installer le framework dans un repo cible se fait en deux temps non guidés : `sdd init` crée un squelette minimal, puis l'adoptant doit activer un connecteur (`sdd connectors enable linear`) **et** éditer `.sdd/config.json` à la main pour renseigner `teamKey`, `labels`, `stateMap`. Aucune expérience déclarative, aucune validation de cohérence, et le config.json reste un fichier qu'on « devine ».
* **Tomorrow:** `sdd init` devient le point d'entrée déclaratif du workspace : l'adoptant déclare ses connecteurs (`local` intrinsèque + `linear`, `github`, …) et leurs settings en une commande — par flags scriptables ou par une interview interactive TTY. La configuration est seedée depuis les manifests d'extensions, l'idempotence rend le re-init sûr, et `sdd validate` garantit la cohérence structurelle du résultat.

---

## 2. Target System Architecture & Interface Diagram

```text
sdd init [--connector <id>]… [--<id>.<key>[.<subkey>]=<value>]… [--interactive] [--dry-run]
     │
     ├─ résout chaque --connector <id> via le catalogue (builtin + extensions/<id>/extension.json)
     ├─ seed les settings depuis le manifest, écrase par les flags namespacés
     ├─ --interactive (TTY uniquement) : multi-select connecteurs + prompts settings (défauts du manifest)
     └─ écrit .sdd/config.json (connectors[]) + arbre canonique — local reste intrinsèque, jamais listé
```

---

## 3. Strategic Invariants & Guardrails

* **Manifest-driven:** le CLI ne connaît aucun connecteur spécifique — tout seed de settings vient de l'`extension.json` ; un id inconnu est rejeté avant toute écriture.
* **Offline & déterministe:** aucune validation réseau dans le CLI (la validation sémantique — teamKey, repo — est déléguée au skill `/sdd-setup` via MCP) ; `--dry-run` prévisualise, re-init idempotent fusionne sans jamais effacer.
* **Interactif explicite:** les prompts ne surviennent que si `--interactive` ET un TTY ; sinon erreur claire — un `sdd init` sans flag reste silencieux et CI-safe (local only).
