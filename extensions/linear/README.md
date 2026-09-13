# Extension: Linear

Mirrors SDD Framework artifacts onto **Linear issues**. Built into the CLI
(`src/connectors/linear.js`) — no installation needed, just enable it.

---

## 1. Enable

```bash
export LINEAR_API_KEY="lin_api_..."      # Personal API key
sdd connectors enable linear
sdd sync --create                       # create the missing issues
```

Then set your team key in `.sdd/config.json`:

```json
{
  "connectors": [
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
| Local ↔ remote identity | `artifact.remote.linear` in the artifact's canonical metadata |

The **model is the source of truth**: `sdd move` performs the model transition
*and* realigns the linked issue. The returned identifier is persisted by the CLI
into `.sdd/canonical/**/<artifact>.json` → `remote.linear`.

---

## 3. Usage

```bash
sdd sync --create --connector linear   # create issues + align states
sdd move 042-login --to active       # model transition AND issue transition
sdd status 042-login                 # show the current mirror reference
```

`createOnMove: true` makes `sdd move` auto-create the missing issue instead of
failing when an artifact was never synced.

---

## 4. State mapping resolution

`stateMap` values must match the **names of your Linear team workflow states**
(case-insensitive), e.g. `Backlog`, `In Progress`, `Done`. The CLI resolves them
by querying `team.key = teamKey` and reading its `states`.

If a mapping name does not exist in the team, the movement fails with an
actionable `ConnectorError` — adjust `stateMap` rather than renaming Linear states.

---

## 5. Limitations (v1)

* `link` is a no-op: Linear issue relations are not wired yet.
* Only the first 100 issues of the team are listed (`sdd list --connector linear`).
* Labels must pre-exist in the team to be attached; unknown labels are skipped.
