## 1. Problem & Trigger

L'adoptant qui amorce un workspace doit connaître la forme exacte de `.sdd/config.json` pour brancher un miroir — l'information n'existe que dans la doc et le schema. Déclencheur : `sdd init` (première installation ou re-déclaration), et en aval `sdd connectors enable <id>` qui doit offrir la même mécanique de settings.

---

## 2. Wireframe / Visual Behavior

```text
$ sdd init --connector linear --linear.teamKey=ENG --linear.labels.spec=SPEC

  Initializing .sdd/ …
  · connector linear   enabled (settings: teamKey=ENG, labels.spec=SPEC, stateMap=<manifest defaults>)
  ✔ .sdd/config.json written — 1 connector, local intrinsic

$ sdd init --interactive        # TTY
  ? Connecteurs à activer › ◉ linear  ◯ github  ◯ aucun (local only)
  ? linear.teamKey › ENG
  ? linear.labels.spec › (default: spec)
  ✔ .sdd/config.json written
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd init` avec zéro, un ou plusieurs `--connector <id>`, des flags settings namespacés `--<id>.<key>[.<subkey>]=<value>`, et/ou `--interactive`.
2. **Interaction & Display:** le CLI résout chaque id dans le catalogue (builtin `linear` + `extensions/<id>/extension.json`), seed les settings depuis le manifest, applique les overrides (merge profond), affiche le plan ; `--dry-run` s'arrête à la prévisualisation.
3. **Validation & Persistence:** `.sdd/config.json` est écrit (connectors[] triés par id), l'arbre canonique est créé ; re-init sur workspace existant = fusion idempotente.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** un `--connector <id>` inconnu du catalogue → `UsageError`, rien d'écrit ; le CLI ne contient aucune connaissance spécifique à un connecteur (tout vient des manifests).
* **INV-2:** les flags settings namespacés ciblent explicitement un connecteur (`--linear.teamKey=ENG`, `--linear.labels.spec=SPEC` → merge profond dans `settings.labels`) ; un flag namespacé sans connecteur correspondant, ou malformé → `UsageError`, rien d'écrit.
* **INV-3:** le re-init est idempotent : les connecteurs existants et leurs settings sont fusionnés (les valeurs explicites gagnent, les défauts du manifest ne ré-écrasent jamais une valeur utilisateur) ; `local` reste intrinsèque et n'apparaît jamais dans `connectors[]`.
* **INV-4:** `--interactive` sans TTY (CI) → `UsageError` explicite invitant aux flags ; sans `--interactive`, aucun prompt, défaut = local only.
* **INV-5:** `sdd validate` vérifie la cohérence structurelle : tout connecteur activé a un id connu et des settings complets au sens du manifest (clés requises présentes) ; `connectors enable/disable <id>` supporte les mêmes flags settings namespacés.

---

## 5. Out of Scope

* Le connecteur GitHub (mirroring issues/projects) — future feature, seule la mécanique générique est livrée.
* Toute validation réseau ou MCP dans le CLI (teamKey, repo…) — déléguée au skill `/sdd-setup` (feature `02-setup-skill`).
* Migration de configs legacy v2 (`backends` → `connectors`), déjà couverte par le code de normalisation existant.
