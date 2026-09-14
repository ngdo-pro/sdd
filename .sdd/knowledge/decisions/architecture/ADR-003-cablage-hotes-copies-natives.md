# ADR-003: Câblage d'hôtes par copies natives + refresh versionné au journal

* **Status:** Accepted — **implémentée par la spec `012-installed-copies`** (feature `05-installed-copies` ; révoque le mécanisme symlink de la spec `008-install-command`)
* **Date:** 2026-09-14
* **Impact:** `Architecture`
* **Domain:** `spec-model` (initiative `adoption`, feature `05-installed-copies`, spec 012)

---

## 1. Context & Problem Statement

Le câblage d'hôtes livré par la spec 008 posait des **symlinks** (`.claude/{skills,agents}/` → pkgRoot du package exécuté) et mergeait `skills.paths` dans `opencode.json` — son INV-1 (« câblage vers le module installé, jamais de copie ») visait la prévention du drift : une cible qui pointe le package exécuté ne peut jamais diverger de lui. Ce mécanisme a trois défauts en adoption réelle : les symlinks posent des **paths machine absolus** dans les repos cibles (non portables pour les collègues qui clonent le repo, bruités dans git status/diff, cassés en CI et sur les mounts sans support symlink), le merge `skills.paths` lie la config de l'hôte au layout interne du package (`node_modules/@ngdo-pro/sdd/skills`), et Windows exige un fallback copie + un avertissement manuel de re-install après chaque mise à jour. La question : comment câbler les hôtes en gardant la garantie anti-drift sans path machine ni écriture de config hôte ?

## 2. Considered Options

* **Option A — Statu quo (symlinks + merge `opencode.json`) :** anti-drift natif (la cible pointe le package exécuté), mais paths machine dans les repos cibles, non portabilité git/CI/collègues, fallback Windows EPERM permanent, et une écriture de config hôte (`opencode.json`) qui viole la frontière « le CLI n'écrit jamais la config de l'hôte ».
* **Option B — Copie sans garde-fou :** copies natives aux chemins natifs, zéro path machine, mais drift possible (le package évolue, les copies vieillissent silencieusement) — exactement le risque que l'INV-1 de la 008 cherchait à éliminer.
* **Option C — Copie native + refresh versionné au journal :** copies aux chemins natifs (`.opencode/skills/sdd-*`, `.claude/{skills,agents}/`, `.agents/{skills,agents}/`), zéro path machine, `opencode.json` jamais touché ; chaque copie est journalisée avec la **version du package copieur**, et le re-install compare : absent ⇒ copie, owned + version ≠ ⇒ clean replace, owned + version = ⇒ no-op, étranger ⇒ warn + skip. Le drift-prevention de l'option A est rétabli par la comparaison de version au lieu du pointage.

## 3. Decision Outcome

Option C, avec trois garde-fous :

1. **Copie = unique mécanisme** : plus aucun symlink, plus de merge `skills.paths`, plus de fallback EPERM (la copie `fs.cp` récursive n'a aucun problème de symlink) — les cibles sont des chemins repo-relatifs, le repo cible ne porte zéro path machine. Les hôtes découvrent les skills nativement (dossiers individuels `sdd-<name>`, plus de `skills.paths`).
2. **Refresh piloté par le journal versionné** : chaque entrée du journal `.sdd/.install-journal.json` porte `version` (motif du stamp 011) ; au re-install, une cible owned dont la version journalisée ≠ version courante est **remplacée proprement** (rm préalable du dossier owned — jamais de merge résiduel qui ferait survivre des fichiers supprimés du package). Une cible étrangère (présente hors journal) est warn + skip, jamais écrasée.
3. **Réversibilité inchangée, legacy honoré** : `--undo` retire exactement les entrées journalisées (jamais de `rm` au-delà des cibles) — et continue d'honorer les entrées legacy 008 (`kind: 'symlink'`/`'opencode-path'`, symlink journalisé retiré), pour une transition sans période mixte côté repos câblés sous l'ancien régime.

L'INV-1 de la spec 008 (« jamais de copie ») est **révoqué** : la copie devient l'unique mécanisme, et sa rationale (drift-prevention) est réimplémentée par le refresh versionné. Les dérogations nées de l'ancien mécanisme (repointage des symlinks périmés, merge structurel `opencode.json`, fallback EPERM Windows) tombent avec lui.

## 4. Rationale & Consequences

* **Portabilité :** un repo câblé clone/diff/CI-proof — aucune entrée machine dans git, aucune config hôte modifiée ; les collègues obtiennent un workspace fonctionnel sans re-câblage.
* **Frontière rétablie :** `sdd install` n'écrit plus jamais `opencode.json` — la config de l'hôte appartient à l'adoptant ; la découverte opencode se fait par les chemins natifs (`skills/sdd-*`).
* **Coût assumé — fraîcheur explicite :** les copies peuvent diverger du package si l'on ne re-run pas `sdd install` après une mise à jour ; le risque est maîtrisé par la comparaison de version au journal (idempotent : no-op à version égale, refresh automatique sinon) et l'affichage du plan (`copied/refreshed/skipped`). La notice de mise à jour post-run (spec 009) fournit le signal qui déclenche le re-install.
* **Coût — empreinte disque :** chaque repo cible porte une copie des skills/agents (au lieu d'un pointeur) ; accepté au regard de la taille du framework (15 skills + agents, fichiers markdown).
* **Journal :** le contrat du journal gagne `version` par entrée et `kind: 'copy'` ; les entrées legacy restent undoables — la transition 008 → 012 est progressive, sans migration imposée.