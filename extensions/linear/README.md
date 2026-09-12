# Extension: Linear

Mirrors Spec Framework artifacts onto **Linear issues**. Built into the CLI
(`src/backends/linear.js`) — no installation needed, just enable it.

---

## 1. Enable

```bash
export LINEAR_API_KEY="lin_api_..."      # Personal API key
spec backend enable linear
```

Then set your team key in `.specs/config.json`:

```json
{
  "backends": [
    { "id": "filesystem", "type": "filesystem", "enabled": true, "required": true },
    {
      "id": "linear",
      "type": "linear",
      "enabled": true,
      "settings": {
        "teamKey": "ENG",
        "stateMap": { "planned": "Backlog", "active": "In Progress", "archived": "Done" },
        "labels": { "initiative": "initiative", "feature": "feature", "spec": "spec" },
        "createOnMove": false
      }
    }
  ]
}
```

---

## 2. Mapping model

| Framework concept | Linear entity |
|---|---|
| Any artifact (initiative, feature, spec) | **Issue** in `teamKey` |
| Artifact kind | **Label** (`initiative` / `feature` / `spec`) — reused if it already exists |
| Lifecycle state | **Workflow state** via `stateMap` |
| Parent ↔ child link | Reported as unsupported (Linear relations are not managed yet) |
| Local ↔ remote identity | `.specs/.remote-map.json` (committed) |

The **local filesystem remains the source of truth**. Linear is a mirror:
`spec move` performs the local move *and* realigns the linked issue.

---

## 3. Usage

```bash
# Create issues for every local artifact and align their states
spec sync --create --backend linear

# Move a spec: local file moves AND the Linear issue transitions
spec move 042 --to active

# Inspect the mirror
spec status 042
```

`createOnMove: true` makes `spec move` auto-create the missing Linear issue
instead of failing when an artifact was never synced.

---

## 4. State mapping resolution

`stateMap` values must match the **names of your Linear team workflow states**
(case-insensitive), e.g. `Backlog`, `In Progress`, `Done`. The CLI resolves them
by querying `team.key = teamKey` and reading its `states`.

If a mapping name does not exist in the team, the movement fails with an
actionable `BackendError` — adjust `stateMap` rather than renaming Linear states.

---

## 5. Limitations (v1)

* `link` is a no-op: Linear issue relations are not wired yet.
* Only the first 100 issues of the team are listed (`spec list --backend linear`).
* Labels must pre-exist in the team to be attached; unknown labels are skipped.
