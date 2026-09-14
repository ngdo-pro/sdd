## 1. Problem & Trigger

La distribution npm/npx livre le binaire `sdd` mais laisse le pipeline agentique (skills, agents, templates) non câblé — chaque adoptant doit symlink `node_modules/shodo/skills` vers son hôte à la main. Déclencheur : `sdd install` lancé dans un repo cible existant, après installation du package (`npm i -g shodo`, `npx shodo …`, ou clone).

---

## 2. Wireframe / Visual Behavior

```text
$ npx shodo install

  Scanning host… detected opencode (opencode.json) + .claude/
  · skills    → opencode.json: skills.paths += "node_modules/shodo/skills"
  · skills    → .claude/skills/shodo → node_modules/shodo/skills (symlink)
  · agents    → .claude/agents/shodo → node_modules/shodo/agents (symlink)
  · workspace → sdd init
  ✔ Shodo installed — run /setup to configure connectors (or stay local)

$ sdd install --host claude --no-init --dry-run   # prévisualise, n'écrit rien
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd install` dans un repo cible (workspace `.sdd/` absent ou existant), flags `--host`, `--init/--no-init`, `--dry-run`, `--undo`.
2. **Interaction & Display:** détection de l'hôte (`opencode.json` → `.agents/` → `.claude/`), plan du câblage affiché ; en non-interactif le plan s'applique, en interactif une confirmation est demandée si plusieurs hôtes détectés.
3. **Validation & Persistence:** câblage idempotent (paths ajoutés une seule fois, symlinks pointant vers le module installé), puis `sdd init` (sauf `--no-init`) ; `--undo` retire exactement ce qui a été posé.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** les câblages pointent vers le **module installé** (`node_modules/shodo/skills|agents|templates`) — jamais de copie ; re-install idempotent (pas de doublon dans `opencode.json`/settings), `--undo` retire exactement les entrées posées (journalisées) et rien d'autre.
* **INV-2:** jamais d'écrasement d'existant — un symlink/une entrée préexistante avec un autre contenu est signalé et laissé intact (warn + skip) ; les fichiers hôtes (`opencode.json`, `.claude/**`) sont modifiés par merge de structure, jamais réécrits brutalement.
* **INV-3:** aucune clé API ni network — `install` est offline ; `sdd init` conserve sa sémantique (local par défaut, connecteurs via `--connector`/`/setup`).
* **INV-4:** `--dry-run` prévisualise le plan complet (hôte détecté, entrées à poser, init à exécuter) sans écrire ; l'ordre des phases : détection → câblage → init.
* **INV-5:** si aucun hôte détecté et pas de `--host`, l'install câble quand même le workspace (`sdd init` seul) et explique comment câbler à la main (pointer vers la doc).

---

## 5. Out of Scope

* Détection/câblage d'hôtes non listés (Antigravity `.agents/` couvert ; futurs hôtes via le registre d'hôtes extensible).
* Publication npm elle-même (hors CLI) ; les connecteurs et leur config (`/setup`, spec 006).
* Gestion des mises à jour de version (re-install sur nouvelle version = re-pointage de symlinks, pas de changelog).
