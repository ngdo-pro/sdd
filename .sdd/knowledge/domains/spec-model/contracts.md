# Domaine : Workspace Management (spec-model) — Contrats d'API & Schémas

> **Spécification Formelle :** pas d'API réseau — le contrat de ce domaine est la **surface CLI `spec`** (`bin/sdd.js`) et les **formats générés** (`index.json`, `config.json`, métadonnées schema v3).
> **Format d'échange :** JSON (métadonnées / index / config) + Markdown (corps / projections) ; sortie machine via `--json`.

---

## 1. Périmètre & Frontières des Contrats

* **Contrats gérés dans ce domaine :**
  * Commandes de cycle de vie : `init`, `upsert`, `move`, `done`, `link`.
  * Contrat d'amorçage déclaratif des connecteurs : `sdd init --connector <id>… --<id>.<key>[.<subkey>]=<value>… [--interactive] [--dry-run]` — settings seedés depuis les manifests, merge profond idempotent (ré-init inclus) sur une config existante ; adoption tardive via `sdd connectors enable|disable <id> <settings…> [--dry-run]` avec la **même grammaire unifiée** que `init` (clés top-level non-namespacées et chemins dotted top-level d'un setting déclaré rattachées au `<id>` positionnel, namespacé accepté si == `<id>`, `--dry-run` réel).
  * Contrat de manifest connecteur : `extensions/<id>/extension.json` — `settings` (défauts), `settingTypes` (`string | boolean | number | object`), `requiredSettings` (présence non vide — l'objet vide compte comme absent — et absence de clé secrète, auditées par `validate` pour les connecteurs activés ; cf. §3 et §4), `hint` (string optionnel — message d'aide affiché par `connectors enable` quand les `requiredSettings` restent incomplètes ; absent ⇒ message générique ; jamais affiché sur `list`).
  * Contrats de lecture / audit : `status`, `list`, `model`, `validate`, `render` (`--check`, `--dry-run`).
  * Contrat de rendu : `sdd render` — projections markdown écrites exclusivement sous `.sdd/generated/`, purge des orphelins de `generated/` listée et prévisualisable via `--dry-run` (l'horizon de purge est limité à `generated/` — l'ancien sweep de l'arbre hérité est tombé avec la feature `03`).
  * Contrat de migration : `sdd migrate` — détection déterministe de layout, plan `--dry-run`, reconstruction intégrale depuis les métadonnées, gate strict, suppression de la source au succès, marker d'échec sinon (livrée : feature `03`).
  * Format généré consommable : `.sdd/canonical/index.json` (version 3 — champ `projection` reciblé vers `.sdd/generated/…`).
* **Contrats délégués à d'autres domaines :**
  * *Conversion de markdown legacy :* `sdd import` — re-ownée (patch de compat levé) : conversion complète via le finish partagé de la migration ; refuse (exit 2) si un modèle JSON existe → orienter `sdd migrate`.
  * *Mirroring distant :* `sync`, `connector` — le modèle canonique reste la seule vérité ; la migration ne déclenche aucune resynchronisation (refs `remote` copiées telles quelles) ; depuis la spec 005, tout miroir Linear exige un transport MCP résolu (`settings.mcp` — écrit par le skill `/setup`, cf. [ADR-002](../../decisions/architecture/ADR-002-transport-connecteurs-environnement.md)), faute de quoi les opérations de miroir échouent par artefact (cf. §4).

---

## 2. Cartographie des Endpoints (commandes CLI)

| Commande | Contrat d'entrée | Effet garanti | Erreur (exit ≠ 0, rien d'écrit) |
|---|---|---|---|
| `sdd init` | `--force`, `--connector <id>…`, `--<id>.<key>[.<subkey>]=<value>…`, `--interactive`, `--dry-run` | Sans connecteur : crée exactement `.sdd/`, `canonical/`, `config.json` — `generated/` n'est pas pré-alloué (comportement historique préservé, silencieux, CI-safe). Déclaratif : résout les manifests (catalogue builtin + `extensions/`), seed les défauts ⊕ merge les overrides coercés, `connectors[]` triée par id — re-init idempotent (les valeurs explicites gagnent, les défauts du manifest ne ré-écrasent jamais une valeur utilisateur) ; affiche le plan (`settings: teamKey=ENG, labels=<défauts>…`) ; `--interactive` (TTY) : multi-select des connecteurs (le `local` intrinsèque exclu) puis prompts type-aware par feuille, défauts pré-remplis ; `--dry-run` : prévisualisation JSON de la config résolue, rien d'écrit (pas même le squelette `.sdd/`) | `UsageError` exit 2 — id inconnu, flag dotted sans valeur, namespace inconnu, type non coercible (booléen ≠ `true\|false`, number non numérique), `--interactive` hors TTY : rien d'écrit |
| `sdd connectors` | `list [--json]` ; `enable\|disable <id> [--<key>[.<subkey>]=<v> \| --<id>.<key>[.<subkey>]=<v>]… [--dry-run]` | `list` : table `id`/`type`/`status` (ou JSON via `--json`) ; `enable`/`disable` : mute `.sdd/config.json` via les mêmes helpers du registre que `init` — grammaire unifiée : clés non-namespacées (`--teamKey=ENG`) **et** chemins dotted top-level d'un setting déclaré (`--mcp.command=npx`) rattachés au `<id>` positionnel (disambiguïsation lue dans le `settingTypes` du manifest — zéro id de connecteur dans le code), namespacé accepté si == `<id>` ; merge idempotent (seed manifest ⊕ overrides coercés, tri par id) ; `--dry-run` : config projetée affichée (`(dry-run: nothing was written)`), rien d'écrit ; après un `enable` dont les `requiredSettings` restent incomplètes, le `hint` du manifest est affiché (absent ⇒ liste générique des settings manquantes ; jamais sur `list`, jamais sur un enable complet) | `UsageError` exit 2 — action inconnue, id manquant ou inconnu, namespace étranger (premier segment ≠ `<id>` et ≠ setting top-level déclaré), flag dotted sans valeur, valeur non coercible : rien d'écrit |
| `sdd upsert <kind>` | `--slug`, `--title`, `--from`, `--field` ; **spec exige `--feature`** | Écrit métadonnée + corps à l'emplacement canonique définitif ; dirs à la volée ; projections régénérées sous `generated/` | `UsageError` sans `--feature` |
| `sdd move <ref>` | `--to planned\|active\|archived`, `--dry-run` | Mute `state` in situ ; régénère index + projections **au même chemin** (zéro mv, zéro rename) ; miroirs appliqués d'abord (« mirrors first ») : transition distante de l'artefact lié (ou création si `createOnMove`), `remoteRef` persisté dans `remote` ; exit honnête (spec 007) : tous les miroirs activés en échec avec ≥ 1 opération tentée (hors `--dry-run`) ⇒ exit 1 + synthèse `all enabled mirrors failed (n/n)` via `process.exitCode` — jamais une exception ; succès partiel ou aucun miroir ⇒ exit 0 | `TransitionError` si illégale ; erreur de miroir (transport MCP absent/injoignable, tool error) : `ConnectorError` isolée par connecteur (warning) — la transition modèle s'applique, aucun `remoteRef` écrit pour le connecteur en échec ; échec total ⇒ exit 1, le rapport par miroir reste affiché |
| `sdd done <ref>` | `--cascade`, `--undo`, `--dry-run` | `progress.done` + archivage ; cascade sur parents dont tous les enfants sont complets | `ResolutionError` |
| `sdd link <ref>` | `--feature <ref>` / `--initiative <slug>` | Écrit `relations` ; relocation des fichiers si le parent change (descendants inclus pour une feature) | `ResolutionError` |
| `sdd sync` | `[<ref>]`, `--connector <id>…` (filtre), `--create`, `--dry-run` | Réconcilie les miroirs distants activés avec le modèle : crée les artefacts distants manquants (`--create`), aligne les états des artefacts liés ; `remoteRef` persistés dans la métadonnée `remote` ; rapport par artefact/connecteur ; erreurs de transport isolées par artefact (warning — l'artefact reste sans `remoteRef`) ; `--dry-run` : plan sans écriture, sortie terminée par `(dry-run: nothing was written)` ; exit honnête (spec 007) : tous les miroirs activés en échec avec ≥ 1 opération tentée (hors `--dry-run`) ⇒ exit 1 + synthèse `all enabled mirrors failed (n/n)` via `process.exitCode` — jamais une exception ; succès partiel, aucune opération tentée (modèle sans artefact) ou aucun miroir activé ⇒ exit 0 | Pas d'erreur fatale : les échecs de miroir (`ConnectorError` — « no MCP transport configured — run /setup », serveur muet/injoignable, `UsageError` transport malformé) sont rapportés par artefact en warning — le signal bloquant reste `sdd validate` (cf. §4) ; échec total ⇒ exit 1 via `process.exitCode`, le rapport par artefact reste affiché (warnings d'abord, synthèse ensuite) |
| `sdd migrate` | `--dry-run`, `--json` | Détection **déterministe** du layout (seuls marqueurs lus : `config.json` + `index.json` — jamais d'heuristique de disque) ; `--dry-run` : plan complet (artefacts par kind, divergences `position-mismatch` / `state-mismatch` / `unresolved-relations` (bloquante) / `legacy-residue`, réécritures de tokens fichier par fichier, mentions non réécrites listées, warnings de conversion config, suppressions planifiées) terminé par `(dry-run: nothing was written)` — exit 0 même si des divergences bloquantes existent (abort planifié) ; exécution : reconstruction intégrale depuis les métadonnées (un `.sdd/` partiel est effacé, jamais fusionné), gate strict (0 finding `validate` ET 0 drift `render --check`), suppression de `.sdd/` au succès ; second appel = no-op (« already migrated », exit 0) | `MigrationError` exit 1 : layout non identifiable (message orienté récupération git / `sdd import` / `sdd init`), relation non résolue (abort avant toute écriture), gate en échec (marker `.sdd/.migration-failed.json` écrit, source conservée) |
| `sdd render` | `--check` (lecture seule), `--dry-run` | Écrit les projections attendues sous `.sdd/generated/` (dirs à la volée) ; purge les orphelins de `generated/` ; table des changements `created` / `updated` / `removed` ; `--dry-run` : mêmes calculs sans aucune écriture, sortie terminée par `(dry-run: nothing was written)` ; `projections.markdown: false` : aucune projection markdown écrite (index régénéré) | `--check` : exit 1 sur tout drift (`stale`, `missing`, `unexpected`) — couverture limitée à `generated/` |
| `sdd validate` | `--json` | Applique `portable-paths` (forme absolue — slash initial suivi de `.sdd/…` — = violation ; mention nue `.sdd/…` = workspace-relatif tolérée, verrouillée par test), `invariant-traceability`, `canonical-layout`, `spec-id-uniqueness`, `graph-integrity`, `root-layout` (racine `.sdd/` exhaustive : `config.json`, `canonical/`, `generated/`, `knowledge/` — fichiers cachés tolérés dont le marker de migration, `generated/` permise sans être exigée), `connector-settings` (un connecteur activé doit porter chaque `requiredSettings` de son manifest — présente et non vide, l'objet vide comptant comme absent : linear exige `teamKey` **et** le transport `mcp` — et chaque `settingTypes` déclaré structurellement valide, et ne doit porter aucune clé de forme secrète `apiKey|token|secret` ; les connecteurs sans manifest ne sont pas audités) | exit 1 si finding(s) |
| `sdd graph` | `--write` | Inspecte le graphe / régénère `index.json` | — |
| `sdd import` | `--dry-run`, `--force`, `--json` | Conversion complète des markdown legacy v2 sous `.sdd/` : relations dérivées du **contenu** (section `## 6.` → spec parente ; bloc Parent Initiative → initiative), tokens de racine des corps réécrits, finish partagé avec la migration (index + projections + gate strict + suppression de `.sdd/` au succès) | `UsageError` exit 2 si un modèle JSON existe (`.sdd/canonical/index.json` ou `.sdd/model/index.json`) → orienter `sdd migrate` |

> **Garde de coexistence (INV-5 de la feature `03`) :** tant que `.sdd/` et `.specs/` coexistent, toute commande mutatrice est refusée (`MigrationError`, exit 1 — « relancez `sdd migrate` ») : `upsert`, `move`, `done`, `link`, `render` (mode écriture), `import` (y compris `--dry-run`), `init --force`, `model --write`, `sync`, `connector enable/disable`. Les lectures (`status`, `list`, `validate`, `render --check` / `--dry-run`, `model` en lecture) opèrent sur `.sdd/` uniquement. `sdd migrate` s'affranchit explicitement du garde — c'est l'outil de reprise.

---

## 3. Schémas de Validation Client / Consommateurs

*Entrée typique d'`index.json` v3 (consommé par agents, mirrors et scripts — généré par le CLI, ne jamais éditer à la main) :*

```json
{
  "kind": "spec",
  "id": "002",
  "slug": "002-generated-projections",
  "title": "Projections sous generated/",
  "state": "active",
  "meta": ".sdd/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.json",
  "body": ".sdd/canonical/initiatives/layout-v3/features/02-generated-namespace/specs/002.md",
  "projection": ".sdd/generated/initiatives/layout-v3/specs/002.md",
  "relations": { "feature": "02-generated-namespace", "initiative": "layout-v3" },
  "progress": { "done": false, "children": 0, "completedChildren": 0, "complete": false },
  "remote": {}
}
```

* **Format :** version 3 **inchangée** — seul le champ `projection` est reciblé vers `.sdd/generated/…` (basculé par la feature `02` ; pas de version 4). Préfixes `meta`/`body` inchangés (`.sdd/canonical/…`). La migration préserve ce format tel quel : les préfixes dérivent de la racine, aucune conversion de format (pas de version 4).
* **Grammaire des chemins de projection (namespace `generated/`) :** vision → `generated/vision.md` (une seule vision) ; initiative → `generated/initiatives/<slug>/README.md` ; feature → `generated/initiatives/<initiative>/features/<slug>.md` (aplatie au niveau initiative) ; spec → `generated/initiatives/<initiative>/specs/<id>.md` (nom de fichier = id seul, listes triées par id). Aucun segment d'état : un `sdd move` régénère la projection au même chemin.
* **Conventions de nommage :** fichiers de spec = **`<id>.{json,md}`** (id seul, sans suffixe) ; grammaire de résolution `<ref>` : id nu (`042`), slug (`042-login`), chemin — inchangée.
* **Grammaire des chemins portables (règle `portable-paths` — arbitrage 10 de la feature `03`) :** tout chemin référencé dans un corps est **workspace-relatif** : `.sdd/canonical/…`, `.sdd/generated/…`, `.sdd/knowledge/…` (mention nue, sans slash initial — tolérée et verrouillée par test). La **forme absolue** — slash initial suivi de `.sdd/…` (chemin ancré hors workspace) — est une violation `portable-paths`.
* **Convention de chemins du modèle (post-bascule `03`) :** chemins de modèle = `.sdd/canonical/initiatives/<initiative>/features/<feature>/specs/<id>.{json,md}` (jamais la forme héritée `model/…`) ; projections = `.sdd/generated/…` ; config = `.sdd/config.json` ; knowledge = `.sdd/knowledge/…` ; index = `.sdd/canonical/index.json` ; marker de migration = `.sdd/.migration-failed.json`.

*Schéma de `config.json` v3 (consommé par le CLI — la conversion `convertConfig` force `version: 3`, retire toute clé top-level inconnue et tout connector `filesystem` avec warning listé) :*

```json
{
  "version": 3,
  "sourceOfTruth": "model",
  "projections": { "markdown": true },
  "connectors": []
}
```

* Clés conservées : `version` (const 3), `sourceOfTruth`, `projections`, `connectors` ; le connector `filesystem` est intrinsèque en v3 et n'y figure plus.

*Contrat de manifest connecteur (`extensions/<id>/extension.json` — additif, rétrocompatible ; exemple = manifest linear v2.0.0, sans bloc `authentication` depuis la spec 005) :*

```json
{
  "settings": { "teamKey": "", "createOnMove": false, "labels": { "spec": "spec" }, "mcp": {} },
  "settingTypes": { "teamKey": "string", "createOnMove": "boolean", "labels": "object", "mcp": "object" },
  "requiredSettings": ["teamKey", "mcp"],
  "hint": "Run /setup — it discovers the MCP transport in your host config"
}
```

* **Grammaire des flags de settings (unifiée `init`/`connectors enable\|disable` — spec 007) :** sur `init` : `--<id>.<key>[.<subkey>]=<value>` (profondeur ≤ 2) ; sur `connectors enable|disable <id>` : les clés non-namespacées (`--teamKey=ENG`) **et** les chemins dotted top-level d'un setting déclaré (`--mcp.command=npx`) sont rattachés au `<id>` positionnel — un namespace == `<id>` est accepté tel quel (`--linear.mcp.command=…`) ; un namespace étranger (premier segment ≠ `<id>` et ≠ setting top-level déclaré, la liste venant du `settingTypes` du manifest) est un `UsageError` exit 2. Une occurrence unique d'un flag répété reste scalaire — un tableau ne naît que de la répétition (`--linear.mcp.args=-y` ⇒ `"args": "-y"` scalaire ; `--linear.mcp.args=-y --linear.mcp.args=npx` ⇒ tableau).
* **Garanties de typage de `connectors[].settings` :** les valeurs saisies (flags ou interview) sont coercées vers le type déclaré avant écriture — `boolean` strict (`true|false` uniquement, `1/0/yes/no` refusés), `number` numérique, `object` par feuilles via subkeys ; toute valeur non coercible est rejetée en citant `<id>.<key>`, rien d'écrit. `settingTypes`/`requiredSettings` absents ⇒ tout est `string` optionnel (les manifests tiers continuent de fonctionner). Les intrinsèques (`local`, `filesystem`) ne figurent jamais dans `connectors[]` ; la liste est triée par id après chaque merge (diff stable).
* **Contrat du champ `hint` (spec 007) :** string optionnel du manifest, lu par `manifestHint` (string non vide après trim ⇒ retourné tel quel, absent/vide/non-string ⇒ `null`) ; affiché par `connectors enable <id>` uniquement quand les `requiredSettings` du connecteur activé restent incomplets ou vides (l'objet vide comptant comme absent) — absent ⇒ message générique citant les settings manquantes ; jamais affiché sur `connectors list` ni sur un enable complet ; zéro id de connecteur codé en dur dans `src/`.
* **Contrat du transport MCP (`settings.mcp` — spec 005, matérialisation d'[ADR-002](../../decisions/architecture/ADR-002-transport-connecteurs-environnement.md)) :** exactement l'une des deux formes — `{ "command": "<cmd>", "args": ["…"] }` (stdio) ou `{ "url": "https://…" }` (HTTP streamable) — jamais les deux ; `args` est un tableau de strings, les flags répétés formant le tableau (`--linear.mcp.args=-y --linear.mcp.args=npx`) ; les deux formes à la fois, ou aucune, sont un `UsageError` (exit 2). Le transport est résolu une fois par le skill **`/setup`** (`skills/setup/SKILL.md` — la voie sanctionnée : interview, découverte read-only des configs MCP de l'hôte `.mcp.json` / `opencode.json` / `.agents/**`, validation sémantique via MCP, application CLI-only), jamais saisi à la main ni deviné par le CLI.
* **Garantie zéro secret (spec 005 INV-1) :** `validate` (règle `connector-settings`) rejette toute clé de settings de forme secrète — `apiKey`, `token`, `secret` en clé ou en **suffixe**, case-insensitive, séparateurs `_`/`-`/espaces tolérés, scan imbriqué (`settings.mcp` inclus) ; un mot au milieu d'une clé légitime ne matche jamais (`tokenBucketRate` passe). Finding citant le chemin pointé (`settings must not contain secrets (<path>)`), exit 1, lecture seule.

---

## 4. Modèle Standard d'Erreur

| Condition | Erreur CLI | Garantie |
|---|---|---|
| Mauvais usage / option manquante (ex. `upsert spec` sans `--feature`) | `UsageError` | Aucun fichier écrit |
| Ref inconnue ou ambiguë | `ResolutionError` | Aucun fichier écrit |
| Transition d'état illégale ou état cible inconnu | `TransitionError` (liste les transitions permises) | Aucun fichier écrit |
| Layout non identifiable (`sdd migrate`) : markdown seul sans `index.json`, index corrompu ou version inattendue | `MigrationError` (code `MIGRATION_ERROR`), exit 1, message orienté : récupération git / `sdd import` / `sdd init` | Jamais d'heuristique de layout — rien d'écrit |
| Relation non résolue (`sdd migrate` en écriture) : artefact référencé par aucune feature/initiative | `MigrationError`, exit 1 (abort avant toute écriture ; prévisualisable en `--dry-run` comme divergence bloquante `unresolved-relations`) | Rien d'écrit |
| Gate strict en échec (`sdd migrate` / `sdd import`) : findings `validate` ≠ 0 ou drift `render --check` ≠ 0 | `MigrationError`, exit 1 ; marker `.sdd/.migration-failed.json` écrit : `{ "failedAt", "stage": "validate\|render-check", "message" }` | Source `.sdd/` conservée intégralement — reprise : corriger la cause puis relancer `sdd migrate` (reprise de zéro) |
| Coexistence `.specs/` + `.sdd/` sur une commande mutatrice | `MigrationError`, exit 1 — « relancez `sdd migrate` » | Rien d'écrit par la commande refusée ; les lectures opèrent sur `.sdd/` uniquement |
| Modèle JSON existant lors d'un `sdd import` | `UsageError`, exit 2 — oriente `sdd migrate` | Rien d'écrit |
| Déclaration de connecteur invalide : id absent du catalogue (le catalogue connu est cité), namespace de settings inconnu ou ≠ `<id>`, flag dotted sans valeur, valeur non coercible au `settingTypes` du manifest (citant `<id>.<key>`) | `UsageError`, exit 2 | Rien d'écrit — rejet avant toute écriture, workspace inchangé |
| Namespace étranger sur `connectors enable\|disable` (spec 007) : premier segment du flag dotted ≠ `<id>` et ≠ setting top-level déclaré du manifest (ex. `--ghost.teamKey=X` sur `connectors enable linear`) | `UsageError`, exit 2 — « Settings namespace "ghost" does not match connector "linear" » | Rien d'écrit — rejet avant toute écriture ; en `--dry-run` comme en écriture réelle |
| Tous les miroirs activés en échec (`sync`/`move`, ≥ 1 opération tentée, hors `--dry-run` — spec 007) | exit 1 posé sur `process.exitCode` + synthèse `all enabled mirrors failed (n/n)` — jamais une exception levée | Le rapport par artefact/connecteur reste affiché (warnings d'abord, synthèse ensuite) ; succès partiel (≥ 1 miroir succeeded), aucune opération tentée (modèle vide) ou `--dry-run` ⇒ exit 0 |
| Transport MCP absent (`sync`/`move` sur un connecteur miroir activé sans `settings.mcp`) | `ConnectorError` (code `CONNECTOR_ERROR`, exitCode 1 si non interceptée) « no MCP transport configured — run /setup » ; dans `sync`/`move`, isolée par artefact/connecteur (warning, exit de commande inchangé) | Aucun `remoteRef` écrit pour l'artefact en échec, artefacts locaux inchangés ; signal bloquant : `sdd validate` → finding `connector-settings` (`requiredSettings` inclut `mcp`), exit 1 — résolution : skill `/setup` ou `sdd connectors enable linear --linear.mcp.…` |
| Serveur MCP muet (timeout — défaut 15 s, sur le handshake et chaque call), injoignable (spawn/HTTP en échec) ou tool error | `ConnectorError` citant le transport (commande stdio ou URL HTTP) et invitant `/setup` | Même isolation par artefact — artefacts distants restés inchangés |
| Transport `settings.mcp` malformé (les deux formes `{command,args}` **et** `{url}` à la fois, ou aucune ; `args` non tableau de strings) | `UsageError` (exit 2) citant `settings.mcp` | Même isolation par artefact dans `sync`/`move` — aucun `remoteRef` écrit |
| Settings portant une clé de forme secrète (`apiKey\|token\|secret` — clé ou suffixe, case-insensitive, imbriqué) ou connecteur activé incomplet (`requiredSettings` absente/vide — l'objet vide compte comme absent) | findings `connector-settings` (`sdd validate`), exit 1 | Lecture seule — la config n'est ni corrigée ni filtrée ; correction via flags (`sdd connectors enable …`) ou `/setup` |
| `sdd init --interactive` sans TTY (stdout non terminal) | `UsageError`, exit 2 — invite aux flags explicites (`sdd init --connector linear --linear.teamKey=ENG`) | Aucun prompt, rien d'écrit |
| Drift de projections (`render --check`) : `stale`, `missing` ou `unexpected` sous `generated/` | findings listés, exit 1 | Lecture seule — `knowledge/` et les chemins hors `generated/` ne sont jamais inspectés |
| Violation de règles (`validate`) | findings + exit 1 (dont `root-layout` pour toute entrée parasite de la racine `.sdd/`, et `connector-settings` pour un connecteur activé incomplet, mal typé ou porteur d'une clé secrète) | Lecture seule, aucun effet de bord |
