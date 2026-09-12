# Extensions — Pluggable Backends

The Spec Framework treats the **local filesystem as the default backend** and lets
you plug additional backends (Linear, GitHub Issues, Jira, Notion…) that receive
the same deterministic *movements* through the `spec` CLI.

```text
  skills / agents  ──(decide)──▶  spec CLI  ──(movement)──▶  backends
                                  (execute)                  ├─ filesystem  (built-in, required)
                                                             ├─ linear      (built-in, opt-in)
                                                             └─ <your id>   (extension)
```

---

## 1. What a backend is

A backend implements a small **port** over the framework artifact lifecycle:

| Operation | Purpose |
|---|---|
| `resolve(ref, { kind })` | Locate one artifact by reference |
| `list({ kind, state })` | Enumerate artifacts |
| `transition(artifact, toState, ctx)` | Apply a lifecycle movement (`planned → active → archived`) |
| `create(artifact, ctx)` | Materialize an artifact remotely |
| `link({ child, parent, relation }, ctx)` | Wire a parent↔child relationship |

The `ctx` object carries `{ remoteMap, dryRun }`. `remoteMap` is the shared,
committable pointer table (`.specs/.remote-map.json`) linking a local artifact
path to the identifiers it owns remotely — **use it, never invent a second map**.

---

## 2. Canonical artifact descriptor

Every backend speaks the same artifact shape:

```js
{
  kind: 'spec' | 'initiative' | 'feature' | 'vision',
  id: '042',                 // spec ID, or the slug for other kinds
  slug: '042-login',
  title: 'Login with magic link',
  state: 'planned' | 'active' | 'archived' | null,
  path: '.specs/specs/planned/042-login.md',   // workspace-relative (POSIX)
  meta: { initiative: 'auth-onboarding' }      // optional
}
```

---

## 3. Writing a backend

1. Copy `extensions/_TEMPLATE/` to `extensions/<your-id>/`.
2. Implement `backend.js` (default export = factory).
3. Describe the mapping in `README.md` and fill `extension.json`.
4. Enable it in the consuming project:

   ```bash
   spec backend enable <your-id>     # or edit .specs/config.json
   spec status                       # verify it is picked up
   ```

The registry auto-discovers any `extensions/<id>/backend.js` exposing a default
export. Folders starting with `_` or `.` are ignored (they are templates/private).

### Factory contract

```js
export default function createBackend({ cwd, config, backendConfig }) {
  return {
    id: backendConfig.id,
    type: backendConfig.type,
    remote: true,                       // false for the local filesystem
    capabilities: { read: true, list: true, transition: true, create: true, link: true },
    async resolve(reference, options) {},
    async list(options) {},
    async transition(artifact, toState, { remoteMap, dryRun } = {}) {},
    async create(artifact, { remoteMap, dryRun } = {}) {},
    async link({ child, parent, relation }, { dryRun } = {}) {},
  };
}
```

### Non-negotiable rules

* **Respect `dryRun`** — never mutate anything when it is `true`.
* **Be idempotent** — re-running a movement must be a no-op, not an error.
* **Local-first** — the filesystem stays the source of truth; remote backends
  mirror it. Never invent state that does not exist locally.
* **Report, don't crash** — throw a `BackendError` (from `src/core/errors.js`)
  with an actionable message when a movement cannot be applied.

---

## 4. Built-in backends

| id | Source | Auth | Notes |
|---|---|---|---|
| `filesystem` | built-in (`src/backends/filesystem.js`) | none | Required. Real file moves + `Status:` header + markdown linking. |
| `linear` | built-in (`src/backends/linear.js`) | `LINEAR_API_KEY` | Mirrors artifacts onto Linear issues. |

## 5. Planned / community backends

`github` (Issues) is the next candidate and will ship as a built-in `github`
backend. Contributions for Jira, Notion, GitLab and others are welcome as
extension folders following the template above.
