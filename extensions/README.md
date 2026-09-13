# Extensions — Pluggable Mirror Connectors

The SDD Framework is **model-first**: `.sdd/canonical/` is the canonical source of
truth, and every other surface is a projection. Mirror connectors project the model
onto remote systems (Linear, GitHub Issues, Jira, Notion…) and receive the same
deterministic *movements* through the `sdd` CLI.

```text
  skills / agents ──(decide)──▶  sdd CLI  ──(movement)──▶  MODEL (.sdd/canonical/)  ← canonical
                                  (execute)                        │
                                                                   ├─▶ markdown projections (.sdd/generated/)
                                                                   └─▶ mirror connectors
                                                                        ├─ linear   (built-in)
                                                                        └─ <your id> (extension)
```

---

## 1. What a connector is

A connector is a **mirror** of the canonical model. It implements a small port over
the framework artifact lifecycle:

| Operation | Purpose |
|---|---|
| `resolve(ref, { kind })` | Locate one remote item by reference |
| `list({ kind, state })` | Enumerate remote items |
| `transition(artifact, toState, ctx)` | Apply a lifecycle movement remotely |
| `create(artifact, ctx)` | Materialize an artifact remotely |
| `link({ child, parent, relation }, ctx)` | Wire a parent↔child relationship |

The `ctx` object carries `{ dryRun }`.

### Remote references live in the model

Connectors must **not** keep their own identifier map. The CLI stores whatever
reference you return in `artifact.remote[connectorId]`, inside the artifact's
canonical metadata:

```json
{ "kind": "spec", "slug": "042-login", "remote": { "linear": "ENG-142" } }
```

* Read the existing reference from `artifact.remote?.[connectorId]`.
* Return `{ remoteRef }` from `transition`/`create` and the CLI persists it.
* Never mutate the artifact object yourself.

---

## 2. Canonical artifact descriptor

Every connector speaks the same artifact shape (hydrated from the model):

```js
{
  kind: 'spec' | 'initiative' | 'feature' | 'vision',
  id: '042',                    // spec ID, or the slug for other kinds
  slug: '042-login',
  title: 'Magic link login',
  state: 'planned' | 'active' | 'archived' | null,
  relations: { initiative: 'demo', feature: '01-login' },
  fields: { Domain: '`auth`' },
  progress: { done: false },
  remote: { linear: 'ENG-142' },
  body: '## 1. Intent\n\n…',    // the prose body (markdown)
  model: { directory: 'specs/active', meta: 'specs/active/042-login.json', body: 'specs/active/042-login.md' },
  projection: 'specs/active/042-login.md'
}
```

---

## 3. Writing a connector

1. Copy `extensions/_TEMPLATE/` to `extensions/<your-id>/`.
2. Implement `connector.js` (default export = factory).
3. Describe the mapping in `README.md` and fill `extension.json`.
4. Enable it in the consuming project:

   ```bash
   sdd connectors enable <your-id>     # or edit .sdd/config.json
   sdd status                       # verify it is picked up
   ```

The registry auto-discovers any `extensions/<id>/connector.js` exposing a default
export. Folders starting with `_` or `.` are ignored (templates/private).

### Factory contract

```js
export default function createBackend({ cwd, config, backendConfig }) {
  const connectorId = backendConfig.id;
  const settings = backendConfig.settings ?? {};

  return {
    id: connectorId,
    type: backendConfig.type,
    remote: true,
    capabilities: { read: true, list: true, transition: true, create: true, link: true },
    async resolve(reference, options) {},
    async list(options) {},
    async transition(artifact, toState, { dryRun } = {}) {},
    async create(artifact, { dryRun } = {}) {},
    async link({ child, parent, relation }, { dryRun } = {}) {},
  };
}
```

### Non-negotiable rules

* **Respect `dryRun`** — never mutate anything when it is `true`.
* **Be idempotent** — re-running a movement must be a no-op, not an error.
* **Mirror, never author** — the model is canonical. Never invent state that does
  not exist locally.
* **Report, don't crash** — throw a `ConnectorError` (from `src/core/errors.js`)
  with an actionable message when a movement cannot be applied.

---

## 4. Built-in connectors

| id | Source | Auth | Notes |
|---|---|---|---|
| `linear` | built-in (`src/connectors/linear.js`) | none (rides the Linear MCP server via `settings.mcp`) | Mirrors artifacts onto Linear issues. |

## 5. Planned / community connectors

`github` (Issues) is the next candidate and will ship as a built-in. Contributions
for Jira, Notion, GitLab and others are welcome as extension folders following the
template above.
