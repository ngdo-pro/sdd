# Spec Framework (Spec-Driven Development)

A structured, universal framework to drive AI agentic software development through a rigorous, scannable, and highly executable documentation pipeline.

Natively compatible with **Google Antigravity (`.agents`)** and **Claude Code (`.claude`)**.

---

## Model-First Architecture

Artifacts are stored once, in a canonical model, and **everything else is generated**:

```text
                    ┌────────────────────────────────────┐
   agents  ────────▶│  MODEL  (.specs/model/)            │
   spec CLI         │  <artifact>.json  metadata         │
                    │  <artifact>.md    prose body       │
                    └─────────────┬──────────────────────┘
                                  │  projections (generated)
          ┌───────────────────────┼──────────────────────┐
          ▼                       ▼                      ▼
   .specs/specs/**          Linear issues          GitHub Issues
   .specs/initiatives/**    (mirror)               (planned)
   .specs/vision.md
```

* **Canonical:** `.specs/model/` — one JSON metadata file + one markdown body file per artifact.
* **Generated:** the markdown documents under `.specs/` (roadmaps, checkboxes, `Status:` headers) and remote issues.
* **Single writer:** the `spec` CLI. Never hand-edit a projection or a model file.

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
.specs/model/
├── index.json                                     # generated manifest (id → files, graph, progress)
├── vision.json  vision.md
├── specs/<planned|active|archive>/042-login.{json,md}
└── initiatives/<planned|active|archive>/<slug>/
    ├── <slug>.{json,md}                           # the initiative
    └── <planned|active|archive>/01-login.{json,md} # its features
```

An artifact's metadata:

```json
{
  "version": 2,
  "kind": "spec",
  "id": "042",
  "slug": "042-login",
  "title": "Magic link login",
  "state": "active",
  "relations": { "feature": "01-login", "initiative": "demo" },
  "fields": { "Domain": "`.specs/knowledge/domains/auth/`", "Complexity": "`Medium`" },
  "remote": { "linear": "ENG-142" },
  "progress": { "done": false },
  "createdAt": "2026-09-13",
  "updatedAt": "2026-09-13"
}
```

---

## Plugin Contents

* **`agents/`**: Specialized agent definitions (Product Orchestrator, Delivery Orchestrator, Knowledge Orchestrator, Product Designer, Product Challenger, Spec Writer, Implementer, QA Tester, Clean-Room Reviewer).
* **`templates/`**: Section templates used to author artifact **bodies** (Vision, Initiative, Feature, Spec, ADR, PDR, Domain Behavior, Contracts, Models, Tech).
* **`skills/`**: Agentic skills and slash commands (`/vision`, `/initiative`, `/feature`, `/spec`, `/build-spec`, `/test-spec`, `/sync-knowledge`, `/sync-behavior`, `/sync-contracts`, `/sync-models`, `/sync-tech`, …).
* **`rules/`**: Specification integrity rules (`spec-rules.md`).
* **`bin/` + `src/`**: The `spec` CLI (zero-dependency Node.js) — the only writer of the model.
* **`extensions/`**: Pluggable mirror-backend catalogue (contract + template + Linear).
* **`schemas/`**: JSON schemas (`config.schema.json`).

---

## CLI (`spec`)

```bash
spec init                        # bootstrap .specs/model/ + projections + config
spec import                      # migrate existing .specs/**/*.md into the model
spec upsert <kind> --slug S --title T --from draft.md   # create/update an artifact
spec link <ref> --feature <ref>  # set a parent relation
spec move <ref> --to <state>     # lifecycle transition (model + mirrors)
spec done <ref> --cascade        # mark delivered, archive, propagate upwards
spec render [--check]            # regenerate projections (--check = CI drift guard)
spec model [--write]             # inspect the graph / regenerate index.json
spec status [<ref>]              # model state, derived progress, mirror refs
spec list [--kind k] [--state s]
spec sync [<ref>] [--create]     # reconcile remote mirrors
spec backend list|enable|disable <id>
spec validate                    # enforce spec-rules.md (paths, invariants, graph)
```

`<ref>` accepts an id (`042`), a slug (`042-login` / `login`) or a path. Mutating commands support `--dry-run`; `--json` emits machine-readable output.

### Everything happens in one command

```bash
# Author the body, attach it to its parents
spec upsert spec --slug 042-login --title "Magic link login" \
     --feature 01-login --from draft.md
spec link 042-login --feature 01-login

# Ship it: archives the spec AND cascades up the whole chain
spec done 042-login --cascade
#   ✔ spec 042-login: planned → archived
#   ✔ feature 01-login archived (all children complete)
#   ✔ initiative demo archived (all children complete)
```

No markdown surgery: the feature's `## 6.` list, the initiative's `## 4.` roadmap and the vision's `## 5.` roadmap are **regenerated from the graph**, complete with checkboxes and relative links.

### CI drift guard

```bash
spec render --check   # exits 1 when a projection is out of date with the model
spec validate         # exits 1 on spec-rules violations
```

---

## Migration from markdown-only specs

Existing `.specs/**/*.md` documents are imported in one shot:

```bash
spec import          # idempotent; --force re-imports and overwrites the model
spec render --check  # verify the regenerated projections match
```

The importer parses titles, metadata blocks (`## Metadata`, `> **Status:**`), strips graph-generated sections, and rebuilds the spec → feature → initiative relations from the roadmaps.

---

## Configuration (`.specs/config.json`)

```json
{
  "version": 2,
  "sourceOfTruth": "model",
  "projections": { "markdown": true },
  "backends": [
    {
      "id": "linear", "type": "linear", "enabled": false,
      "settings": {
        "teamKey": "ENG",
        "stateMap": { "planned": "Backlog", "active": "In Progress", "archived": "Done" },
        "labels": { "spec": "spec", "feature": "feature", "initiative": "initiative" },
        "createOnMove": false
      }
    }
  ]
}
```

The model is intrinsic and never listed in `backends`; that list contains **remote mirrors only**.

---

## Mirroring onto Linear

```bash
export LINEAR_API_KEY="lin_api_..."
spec backend enable linear        # then set settings.teamKey
spec sync --create                # create the missing issues, align their states
spec move 042-login --to active   # model transition + Linear state update
```

Remote identifiers are stored in the model (`artifact.remote.linear`), so syncs stay idempotent and reviewable in git.

---

## Extending: pluggable mirror backends

Any folder `extensions/<id>/backend.js` exposing a default-export factory is auto-discovered. A backend implements a small port (`resolve`, `list`, `transition`, `create`, `link`) over the canonical artifact model, respects `--dry-run`, and returns remote references for the CLI to persist in the model.

See **[`extensions/README.md`](./extensions/README.md)** for the full contract, the authoring template (`extensions/_TEMPLATE/`) and the Linear reference documentation.

---

## Development

```bash
npm test        # node:test — zero dependencies
```