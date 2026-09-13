# Extension: Linear

Mirrors SDD Framework artifacts onto **Linear issues** through the **Linear MCP
server** (JSON-RPC). Built into the CLI (`src/connectors/linear.js`) — no
installation needed, just enable it and resolve the transport.

> **Zero secrets (INV-1).** The connector holds no API key and never will: the
> GraphQL transport and its `LINEAR_API_KEY`/`settings.apiKey` were removed.
> Authentication lives entirely in your environment's Linear MCP server; the
> framework only stores *where to reach it*.

---

## 1. Transport (`settings.mcp`)

The authenticated transport is resolved once by the **`/setup`** skill and
written into `.sdd/config.json`. Exactly one of two shapes, never both:

```json
{ "mcp": { "command": "npx", "args": ["-y", "@linear/mcp-server"] } }
```

```json
{ "mcp": { "url": "https://mcp.linear.app/sse" } }
```

* **stdio** — the CLI spawns `{ command, args }` per command invocation and
  speaks newline-delimited JSON-RPC 2.0 over its stdin/stdout (no
  Content-Length/LSP framing).
* **HTTP** — plain POST JSON-RPC; the response may be a single JSON body or a
  streamable/SSE stream (responses are matched by request id). No reconnect
  logic: the client is ephemeral, one per invocation.
* `args` are plain strings (paths with spaces are fine). On the command line,
  repeat the flag to build the array — a naive space-split would break paths:

  ```bash
  sdd connectors enable linear --teamKey=ENG \
    --mcp.command=npx --mcp.args=-y --mcp.args=@linear/mcp-server
  ```

Every call (handshake included) times out after 15s (configurable per client)
with a `ConnectorError` naming the transport and inviting `/setup`.

---

## 2. Enable

```bash
sdd connectors enable linear --teamKey=ENG   # declare the mirror with its team
sdd sync --create                            # create the missing issues
```

Then make sure `.sdd/config.json` carries both required settings:

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
        "createOnMove": false,
        "mcp": { "command": "npx", "args": ["-y", "@linear/mcp-server"] }
      }
    }
  ]
}
```

`sdd validate` guards both invariants: an enabled Linear connector without
`settings.mcp` is a `connector-settings` finding (INV-2), and any settings key
shaped like a secret (`apiKey`, `token`, `secret` — key or key suffix,
case-insensitive) is rejected before it can ever be committed.

---

## 3. Mapping model

| Framework concept | Linear entity |
|---|---|
| Any artifact (initiative, feature, spec) | **Issue** in `teamKey` |
| Artifact kind | **Label** (`initiative` / `feature` / `spec`) — reused if it already exists |
| Lifecycle state | **Workflow state** via `stateMap` (resolved server-side by name) |
| Parent ↔ child link | Reported as unsupported (Linear relations are not managed yet) |
| Local ↔ remote identity | `artifact.remote.linear` in the artifact's canonical metadata |

The mirror maps onto the Linear MCP tools: `get_issue` (resolve),
`list_issues` (list), `create_issue` (create), `update_issue` (transition &
metadata). The **model is the source of truth**: `sdd move` performs the model
transition *and* realigns the linked issue. The returned identifier is
persisted by the CLI into `.sdd/canonical/**/<artifact>.json` →
`remote.linear`.

---

## 4. Usage

```bash
sdd sync --create --connector linear   # create issues + align states
sdd move 042-login --to active         # model transition AND issue transition
sdd status 042-login                   # show the current mirror reference
```

`createOnMove: true` makes `sdd move` auto-create the missing issue instead of
failing when an artifact was never synced.

---

## 5. State mapping resolution

`stateMap` values must match the **names of your Linear team workflow states**
(case-insensitive), e.g. `Backlog`, `In Progress`, `Done`. The MCP server
resolves them; an unknown name surfaces as a tool error reported per artifact —
adjust `stateMap` rather than renaming Linear states.

---

## 6. Limitations (v2)

* `link` is a no-op: Linear issue relations are not wired yet.
* Labels must pre-exist in the team to be attached; unknown labels are skipped.
* Without `settings.mcp`, `sync`/`move` fail fast per artifact with
  "no MCP transport configured — run /setup" (INV-2).