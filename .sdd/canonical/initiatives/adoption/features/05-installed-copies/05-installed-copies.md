## 1. Problem & Trigger

`sdd install` câble les agents/skills par **symlinks** pointant vers le module installé (chemin absolu machine, ex. home utilisateur + `node_modules/@ngdo-pro/sdd/skills`) et merge un `skills.paths` vers `node_modules/` dans `opencode.json`. Ces paths locaux polluent les repos partagés : non portables (chaque collègue a un chemin différent), bruités dans git, cassés en CI. Déclencheur : `sdd install` doit poser des fichiers **physiques** aux chemins natifs des hôtes — zéro path machine, zéro modification de config hôte.

---

## 2. Wireframe / Visual Behavior

```text
$ sdd install                       # repo cible
  · skills   → .opencode/skills/sdd-{setup,spec,…}        (copiés, 15 dossiers)
  · skills   → .claude/skills/sdd-*                        (copiés)
  · agents   → .claude/agents/sdd-*                        (copiés)
  ✔ wired 2 host(s) — files copied, no local paths, no host config touched

$ npm i -g @ngdo-pro/sdd@next && sdd install
  · version changed 2.0.2 → 2.0.3 — refreshing owned copies…
  ✔ refreshed 2 host(s)
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd install` (phases inchangées : détection → câblage → init), flags inchangés (`--host`, `--dry-run`, `--undo`, `--init/--no-init`).
2. **Interaction & Display:** les skills (`skills/sdd-*/`) et agents (`agents/*.md`) sont **copiés** aux emplacements natifs des hôtes détectés (`.opencode/skills/`, `.claude/{skills,agents}/`, `.agents/{skills,agents}/`) ; plus aucune écriture d'`opencode.json` ni de symlink.
3. **Validation & Persistence:** le journal `.sdd/.install-journal.json` enregistre cibles + version source du package ; re-install avec version différente → re-copie (refresh) des cibles owned ; `--undo` retire exactement les copies journalisées.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** le câblage pose des **copies** aux chemins natifs des hôtes — aucun symlink, aucun path machine dans le repo cible ; `opencode.json` n'est jamais modifié.
* **INV-2:** jamais d'écrasement de ce que le package ne détient pas — cibles étrangères (présentes sans journal) : warn + skip ; cibles owned (journal) : refresh si la version du package a changé.
* **INV-3:** le journal `.sdd/.install-journal.json` porte la version du package qui a copié ; `--undo` retire exactement les copies journalisées.
* **INV-4:** offline, dry-run inchangé ; `sdd init` garde sa sémantique.

---

## 5. Out of Scope

* La mécanique d'hôtes extensible et la détection (livrées) ; les connecteurs ; la gestion des copies éditées localement par l'utilisateur (un refresh owned écrase — le warn reste pour les étrangères).
