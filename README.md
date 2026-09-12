# Spec Framework (Spec-Driven Development)

A structured, universal framework to drive AI agentic software development through a rigorous, scannable, and highly executable documentation pipeline.

Natively compatible with **Google Antigravity (`.agents`)** and **Claude Code (`.claude`)**.

---

## Pipeline Architecture

```text
1. VISION         → "Why the product exists" (.specs/vision.md)
   ↓
2. INITIATIVE     → "The macro strategic milestone" (.specs/initiatives/(planned|active|archive)/[slug]/README.md)
   ↓
3. FEATURE        → "What the user or system achieves" (.specs/initiatives/.../[slug]/(planned|active|archive)/[feature].md)
   ↓
4. SPEC           → "The executable, tested engineering plan" (.specs/specs/(planned|active|archive)/XXX-[slug].md)
   ↓
5. BUILD & QA     → Code implementation & quality gates validation
   ↓
6. SYNC KNOWLEDGE → Living documentation & capitalization (.specs/knowledge/)
```

---

## Plugin Contents

* **`agents/`**: Specialized agent definitions (Product Orchestrator, Delivery Orchestrator, Knowledge Orchestrator, Product Designer, Product Challenger, Spec Writer, Implementer, QA Tester, Clean-Room Reviewer).
* **`templates/`**: Standardized markdown templates (Vision, Initiative, Feature, Spec, ADR, PDR, Domain Behavior, Contracts, Models, Tech).
* **`skills/`**: Agentic skills and slash commands (`/vision`, `/initiative`, `/feature`, `/spec`, `/build-spec`, `/test-spec`, `/sync-knowledge`, `/sync-behavior`, `/sync-contracts`, `/sync-models`, `/sync-tech`, etc.).
* **`rules/`**: Specification integrity rules (`spec-rules.md`).
* **`bin/` + `src/`**: The `spec` CLI (zero-dependency Node.js) that performs the deterministic lifecycle mechanics.
* **`extensions/`**: Pluggable backend catalogue (contract + authoring template + Linear reference backend).
* **`schemas/`**: JSON schemas (`config.schema.json`).

---

## CLI (`spec`)

The CLI executes the **deterministic mechanics** of the pipeline (movements,
linking, syncing) while skills and agents own the *content* and *decisions*.
By default everything happens on the **local filesystem**; when a remote backend
is enabled, the same movement is **mirrored** onto it.

```bash
spec init                                      # bootstrap .specs/ + config.json
spec move <ref> --to <planned|active|archived> # ★ transition an artifact
spec status [<ref>]                            # local state + remote mirrors
spec list [--kind spec|initiative|feature] [--state active]
spec link <spec-ref> --feature <feature-ref>   # register in the parent document
spec sync [<ref>] [--create] [--backend linear]# reconcile local → remote
spec backend list | enable <id> | disable <id> # manage backends
spec validate                                  # enforce spec-rules.md (paths, INV coverage)
```

`<ref>` accepts a spec ID (`042`), a slug (`042-login` / `login`) or a path.
Every mutating command supports `--dry-run`; `--json` emits machine-readable output.

### Example: local filesystem (default)

```bash
spec move 042 --to active
#   ✔ filesystem: .specs/specs/planned/042-login.md → .specs/specs/active/042-login.md
```

### Example: mirroring onto Linear

```bash
export LINEAR_API_KEY="lin_api_..."
spec backend enable linear        # then set settings.teamKey in .specs/config.json
spec sync --create --backend linear
spec move 042 --to active
#   ✔ filesystem: .specs/specs/planned/042-login.md → .specs/specs/active/042-login.md
#   ✔ linear: ENG-142 → In Progress
```

---

## Configuration (`.specs/config.json`)

`spec init` generates it; `spec backend enable|disable` edits it.
The **filesystem is always the required source of truth**; remote backends are optional.

```json
{
  "version": 1,
  "sourceOfTruth": "filesystem",
  "backends": [
    { "id": "filesystem", "type": "filesystem", "enabled": true, "required": true },
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

---

## Extending: pluggable backends

Any folder `extensions/<id>/backend.js` exposing a default-export factory is
**auto-discovered** by the registry. A backend implements a small port
(`resolve`, `list`, `transition`, `create`, `link`) over the canonical artifact
model, and shares the committable `.specs/.remote-map.json` to stay idempotent.

See **[`extensions/README.md`](./extensions/README.md)** for the full contract,
the authoring template (`extensions/_TEMPLATE/`) and the Linear reference doc.

---

## Development

```bash
npm test        # node:test — zero dependencies
```

