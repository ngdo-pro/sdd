# sdd — Spec-Driven Development

A structured, universal framework to drive AI agentic software development through a rigorous, scannable, and highly executable documentation pipeline.

Built for humans and AI agents, natively compatible with agent conventions like **`.agents`** and **`.claude`**.

---

## Installation

The guided adoption path is the **`/sdd-setup`** skill — the single conversational entry point, whatever the repo's situation (blank, legacy `.specs/` workspace, or already wired). There is no separate "install" conversation: one protocol, with conditional and confirmed phases:

1. **État des lieux (read-only):** `sdd status` / `sdd list --json`, `.specs/` presence, agent-host markers (`opencode.json`, `.claude/`, `.agents/`) — a to-do matrix is presented before anything runs.
2. **Legacy migration (if `.specs/` exists):** the `sdd migrate --dry-run` plan is shown, the migration only runs after explicit confirmation — with an explicit arbitrage if a valid `.sdd/` coexists (migrate rebuilds `.sdd/` from the legacy source).
3. **Wiring + init (if no `.sdd/`):** `sdd install --dry-run` first, then the wiring of the detected hosts.
4. **Optional connector:** the Linear mirror, resolved from the host MCP configs, validated through MCP, enabled via `sdd connectors enable … --dry-run` → confirmation.
5. **Recap:** what was done, what remains, and the pointer to the next step (`/sdd-vision`).

Re-running `/sdd-setup` is idempotent: the état des lieux detects the existing state and only the missing phases run.

### The CLI primitive underneath

```bash
npm i -g @ngdo-pro/sdd       # then, inside any repo:
sdd install          # or one-shot without a global install: npx @ngdo-pro/sdd install
```

`sdd install` turns a repo into an SDD workspace in one command:

1. **Detects the agent hosts** present in the repo: `opencode.json` → `.claude/` → `.agents/`.
2. **Wires the framework** for each host — structurally merges `"skills": { "paths": ["node_modules/@ngdo-pro/sdd/skills"] }` into `opencode.json` (existing keys, order and content preserved), and symlinks `.claude/skills/sdd` + `.claude/agents/sdd` (resp. `.agents/…`) to the **installed package** (npx cache, `npm -g` or clone) — resolved from the executing module, never from the working directory.
3. **Bootstraps the model** with `sdd init` (skip with `--no-init`).

Flags:

```bash
sdd install --host claude   # force one host: auto | opencode | claude | agents
sdd install --dry-run       # print the plan, write nothing
sdd install --undo          # revert exactly what install wrote (journal-based)
```

* **Idempotent:** re-running is a no-op; a pre-existing symlink or `opencode.json` the package does not own is warned and skipped — nothing is ever overwritten.
* **Several hosts detected without `--host`?** A TTY asks which ones to wire; in CI (non-TTY) it fails with a `UsageError` listing them, so pass `--host <id>`.
* **No host detected?** `sdd init` still runs and manual wiring instructions are printed.
* **`templates/` are not wired:** agents read them from the package at runtime.
* **Windows:** when symlink creation is refused (EPERM), the wiring falls back to a copy with a warning — re-run `sdd install` after updating the package to refresh it.
* **Clone path:** `git clone <this repo> && cd sdd && npm i -g .`, or run `node bin/sdd.js install` straight from the clone. Everything is offline — no API keys, no network.

### Update notice

After every `sdd` command, the CLI checks the npm registry (best-effort: 1.5 s timeout, result cached for 24 h in the `.sdd/.update-check.json` dotfile) and prints a one-line notice on **stderr** when a newer version is published — after the command output, never on stdout (`--json` and pipes stay clean), and never affecting exit codes. Offline, timeout or registry failures are completely silent.

Opt out at any time:

```bash
sdd status --no-update-check        # per invocation
SDD_NO_UPDATE_CHECK=1 sdd status    # per environment (any non-empty value)
```

---

## Model-First Architecture

Artifacts are stored once, in a canonical model, and **everything else is generated**:

```text
                    ┌────────────────────────────────────┐
   agents  ────────▶│  MODEL  (.sdd/canonical/)        │
   sdd CLI         │  <artifact>.json  metadata         │
                     │  <artifact>.md    prose body       │
                     └─────────────┬──────────────────────┘
                                   │  projections (generated)
           ┌───────────────────────┼──────────────────────┐
           ▼                       ▼                      ▼
    .sdd/generated/**        Linear issues          GitHub Issues
    (markdown docs)          (mirror)               (planned)
```

* **Canonical:** `.sdd/canonical/` — one JSON metadata file + one markdown body file per artifact. The layout is **stateless**: lifecycle lives in the `state` metadata field and the index, never in a path (`sdd move` relocates no file).
* **Knowledge:** `.sdd/knowledge/` — authored content outside the graph: `decisions/{architecture,product}/` (ADR/PDR) and `domains/`.
* **Generated:** the markdown documents under `.sdd/generated/` (roadmaps, checkboxes, `Status:` headers) and remote issues.
* **Single writer:** the `sdd` CLI. Never hand-edit a projection or a model file.

### Pipeline

```text
1. VISION         → "Why the product exists"
2. INITIATIVE     → "The macro strategic milestone"
3. FEATURE        → "What the user or system achieves"
4. SPEC           → "The executable, tested engineering plan"
5. BUILD & QA     → Code implementation & quality gates validation
6. SYNC KNOWLEDGE → Living documentation & capitalization
```

### Canonical layout

```text
.sdd/
├── config.json
├── canonical/                                   # source of truth (stateless, authored)
│   ├── index.json                               # generated manifest (id → files, graph, progress)
│   ├── vision.json  vision.md
│   └── initiatives/<slug>/
│       ├── <slug>.{json,md}                     # the initiative
│       └── features/<feature-slug>/
│           ├── <feature-slug>.{json,md}         # its features
│           └── specs/<id>.{json,md}             # spec files are named by bare id (042.json)
├── generated/                                   # 100% generated by the CLI — never edited
│   ├── vision.md                                # one vision (the root double is gone)
│   └── initiatives/<slug>/
│       ├── README.md                            # generated feature roadmap
│       ├── features/<feature-slug>.md           # flattened at the initiative level
│       └── specs/<id>.md                        # flattened, sorted by id (002.md)
└── knowledge/                                   # authored, outside the graph
    ├── decisions/{architecture,product}/
    └── domains/
```

Every directory is created on demand (`sdd init` pre-allocates nothing).

An artifact's metadata:

```json
{
  "version": 3,
  "kind": "spec",
  "id": "042",
  "slug": "042-login",
  "title": "Magic link login",
  "state": "active",
  "relations": { "feature": "01-login", "initiative": "demo" },
  "fields": { "Domain": "`.sdd/knowledge/domains/auth/`", "Complexity": "`Medium`" },
  "remote": { "linear": "ENG-142" },
  "progress": { "done": false },
  "createdAt": "2026-09-13",
  "updatedAt": "2026-09-13"
}
```

> **Generated namespace:** every markdown projection lives under `.sdd/generated/` — authored (`canonical/`, `knowledge/`) and generated trees are visually disjoint, and the two-`vision.md` ambiguity is gone (`generated/sdd-vision.md` is the only root-level vision). The rendering is optimized for reading: features and specs are flattened at the initiative level and sorted by id, with cross links regenerated from the projection paths. `sdd render` prunes any non-projected markdown and `sdd render --check` covers `generated/` only. Do not "fix" these paths by hand; they are regenerated by the CLI.

---

## Plugin Contents

* **`agents/`**: Specialized agent definitions (Product Orchestrator, Delivery Orchestrator, Knowledge Orchestrator, Product Designer, Product Challenger, Spec Writer, Implementer, QA Tester, Clean-Room Reviewer).
* **`templates/`**: Section templates used to author artifact **bodies** (Vision, Initiative, Feature, Spec, ADR, PDR, Domain Behavior, Contracts, Models, Tech).
* **`skills/`**: Agentic skills and slash commands (`/sdd-setup`, `/sdd-vision`, `/sdd-initiative`, `/sdd-feature`, `/spec`, `/sdd-build-spec`, `/sdd-test-spec`, `/sdd-sync-knowledge`, `/sdd-sync-behavior`, `/sdd-sync-contracts`, `/sdd-sync-models`, `/sdd-sync-tech`, …).
* **`rules/`**: Specification integrity rules (`spec-rules.md`).
* **`bin/` + `src/`**: The `sdd` CLI (Node.js ≥ 18.17; the single runtime dependency `@clack/prompts` powers `--interactive` and is loaded on demand) — the only writer of the model.
* **`extensions/`**: Pluggable mirror-connector catalogue (contract + template + Linear).
* **`schemas/`**: JSON schemas (`config.schema.json`).

---

## CLI (`sdd`)

```bash
sdd install [--host h] [--dry-run] [--undo]   # wire agent hosts + sdd init
sdd init                        # bootstrap .sdd/canonical/ + config
sdd init --connector linear --linear.teamKey=ENG   # declarative init: declare mirrors + seed settings
sdd migrate --dry-run && sdd migrate         # convert a legacy .specs/ workspace
sdd upsert <kind> --slug S --title T --from draft.md   # create/update an artifact
sdd link <ref> --feature <ref>  # set a parent relation
sdd move <ref> --to <state>     # lifecycle transition (model + mirrors)
sdd done <ref> --cascade        # mark delivered, archive, propagate upwards
sdd render [--check] [--dry-run] # regenerate .sdd/generated/ (--check = CI drift guard)
sdd graph [--write]             # inspect the graph / regenerate index.json
sdd status [<ref>]              # model state, derived progress, mirror refs
sdd list [--kind k] [--state s]
sdd sync [<ref>] [--create]     # reconcile remote mirrors
sdd connectors list|enable|disable <id> [--teamKey=ENG …]
sdd validate                    # enforce spec-rules.md (paths, invariants, graph,
                                # connector-settings for enabled mirrors)
```

`<ref>` accepts an id (`042`), a slug (`042-login` / `login`) or a path. Mutating commands support `--dry-run`; `--json` emits machine-readable output.

### Declarative init & connector settings

`sdd init` is the single declarative entry point: connectors are declared by id, their settings seeded from the connector manifest (`extensions/<id>/extension.json`), and overrides are passed as namespaced flags, deep-merged and coerced through the manifest `settingTypes`:

```bash
sdd init --connector linear --linear.teamKey=ENG --linear.labels.spec=SPEC
sdd init --connector linear --dry-run          # preview the resolved config, write nothing
sdd init --interactive                         # TTY interview (multi-select + type-aware prompts)
```

* `--<id>.<key>[.<subkey>]=<value>` — deep merge (`labels.spec` lands in `settings.labels.spec`); types are strict: booleans accept only `true|false`, numbers must be numeric.
* Re-init is idempotent: explicit values win, manifest defaults never overwrite a user value, connectors are added but never removed, and `connectors[]` stays sorted by id.
* `local` is the intrinsic model connector — never listed in `connectors[]`.
* `sdd connectors enable|disable <id>` accepts the same settings (un-namespaced keys bind to the positional `<id>`): `sdd connectors enable linear --teamKey=ENG --createOnMove=true`.
* `sdd validate` enforces the `connector-settings` rule: an enabled connector must carry its manifest `requiredSettings` (e.g. Linear's `teamKey` and the resolved `mcp` transport) with valid types, and no settings key may be secret-shaped (`apiKey`/`token`/`secret`) — the framework carries zero secrets (INV-1).
* `--interactive` prompts only when stdout is a TTY; in CI it exits with a UsageError pointing at the explicit flags.
* The **`/sdd-setup`** skill is the single adoption entry point (see [Installation](#installation)): état des lieux, legacy `.specs/` migration, host wiring + init, then optionally the Linear connector — read-only discovery of the MCP transport in the host configs (`.mcp.json`, `opencode.json`, `.agents/**`), semantic validation through MCP, the exact `sdd connectors enable … --dry-run` preview and a CLI-only application — the config is never hand-edited.

### Everything happens in one command

```bash
# Author the body, attach it to its parents
sdd upsert spec --slug 042-login --title "Magic link login" \
     --feature 01-login --from draft.md
sdd link 042-login --feature 01-login

# Ship it: archives the spec AND cascades up the whole chain
sdd done 042-login --cascade
#   ✔ spec 042-login: planned → archived
#   ✔ feature 01-login archived (all children complete)
#   ✔ initiative demo archived (all children complete)
```

No markdown surgery: the feature's `## 6.` list, the initiative's `## 4.` roadmap and the vision's `## 5.` roadmap are **regenerated from the graph**, complete with checkboxes and relative links.

### CI drift guard

```bash
sdd render --check   # exits 1 when a projection is out of date with the model
sdd validate         # exits 1 on spec-rules violations
```

---

## Migration from markdown-only specs

Existing `.specs/**/*.md` documents are imported in one shot:

```bash
sdd import          # idempotent; --force re-imports and overwrites the model
sdd render --check  # verify the regenerated projections match
```

The importer parses titles, metadata blocks (`## Metadata`, `> **Status:**`), strips graph-generated sections, and rebuilds the spec → feature → initiative relations from the roadmaps.

---

## Configuration (`.sdd/config.json`)

```json
{
  "version": 3,
  "sourceOfTruth": "model",
  "projections": { "markdown": true },
  "connectors": [
    {
      "id": "linear", "type": "linear", "enabled": false,
      "settings": {
        "teamKey": "ENG",
        "stateMap": { "planned": "Backlog", "active": "In Progress", "archived": "Done" },
        "labels": { "spec": "spec", "feature": "feature", "initiative": "initiative" },
        "createOnMove": false,
        "mcp": { "url": "https://mcp.linear.app/sse" }
      }
    }
  ]
}
```

The model is intrinsic and never listed in `connectors`; that list contains **remote mirrors only**.

---

## Mirroring onto Linear

The Linear mirror talks to the **Linear MCP server** — the authenticated transport
your environment already provides. No API key ever lives in the framework: the
connector rides `settings.mcp`, resolved once by `/sdd-setup` (stdio `{command,args}`
or HTTP `{url}`, never both).

```bash
sdd connectors enable linear --teamKey=ENG   # declare the mirror with its team
sdd sync --create                # create the missing issues, align their states
sdd move 042-login --to active   # model transition + Linear state update
```

Without `settings.mcp` the connector is inoperative: `sync`/`move` fail with
"no MCP transport configured — run /sdd-setup" and `sdd validate` reports a
`connector-settings` finding. Run the `/sdd-setup` skill to resolve the Linear MCP
transport into `.sdd/config.json` (it never stores credentials, only the
command or URL your MCP client uses).

Remote identifiers are stored in the model (`artifact.remote.linear`), so syncs stay idempotent and reviewable in git.

---

## Extending: pluggable mirror connectors

Any folder `extensions/<id>/connector.js` exposing a default-export factory is auto-discovered. A connector implements a small port (`resolve`, `list`, `transition`, `create`, `link`) over the canonical artifact model, respects `--dry-run`, and returns remote references for the CLI to persist in the model.

See **[`extensions/README.md`](./extensions/README.md)** for the full contract, the authoring template (`extensions/_TEMPLATE/`) and the Linear reference documentation.

---

## Development

```bash
npm test                        # node:test suite
node bin/sdd.js validate        # spec-rules gates (the repo dogfoods its own model)
node bin/sdd.js render --check  # projection drift guard
```

This repository dogfoods the framework: its own product decisions live in `.sdd/canonical/initiatives/` (see `setup-experience`, `connector-ecosystem`, `adoption`), decisions in `.sdd/knowledge/decisions/` (ADR-001, ADR-002) and the `spec-model` domain knowledge in `.sdd/knowledge/domains/spec-model/`.