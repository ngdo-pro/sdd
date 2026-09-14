---
name: setup
description: Guide an adoptant from zero to a configured, validated workspace — interview, read-only MCP discovery, semantic validation, dry-run, and CLI-only application.
---

# Skill: setup

Use this skill when the user runs `/setup` or asks to configure the framework's mirror connectors (Linear today) in their environment.

Everything shown to the adoptant (questions, synthesis, summaries) must be authored in the user's language; no unexplained CLI jargon in the questions.

> **Model-first (Rule 7):** this skill never writes a model or config file by hand. `.sdd/config.json` is mutated exclusively through the `sdd` CLI (`sdd init`, `sdd connectors enable`). Host MCP configs (`.mcp.json`, `opencode.json`, `.agents/**`) are read-only: never edit, repair or provision them.

> **Test contract:** the `@protocol` Gherkin scenarios of spec 006 (§8.1) are behavioral contracts of this protocol, not `node:test` targets — this skill ships **no automated tests** and is validated by review and dogfooding. The hard layer beneath it (dry-run, idempotent merge, `connector-settings` validation) is already automated by the specs 004/005 suites.

## CLI surface (the only persistence layer)

| Purpose | Command |
|---|---|
| Probe the workspace (first read of every run) | `sdd status` (or `--json`) |
| Preview the resolved config — writes nothing, not even the `.sdd/` skeleton | `sdd init --connector linear --linear.… --dry-run` |
| Apply or merge | `sdd init --connector linear --linear.…` |
| Enable on an already-initialized workspace (preview with `--dry-run`) | `sdd connectors enable linear --teamKey=ENG --linear.mcp.command=…` |
| Structural validation after application | `sdd validate` |

Settings flags deep-merge and are coerced through the connector manifest: `--linear.<key>[.<subkey>]=<value>` (depth ≤ 2), repeated flags form arrays (`--linear.mcp.args=-y --linear.mcp.args=npx`), booleans are strict (`true`/`false`). The `mcp` transport is exactly one of `command`+`args` (stdio) or `url` (HTTP) — never both. The grammar is unified across `sdd init` and `sdd connectors enable|disable`: top-level keys bind to the positional connector id (`--teamKey=ENG`, dotted paths of a declared setting like `--mcp.command=…`) and the namespaced form is accepted when the namespace matches the id (`--linear.mcp.command=…`). `connectors enable` supports `--dry-run` — the same zero-write preview as `sdd init --dry-run` — so an enable or a re-run merge can be previewed before it is applied.

## Procedure

### Phase 1 — Interview (one question at a time)

1. Probe first: `sdd status`. If a workspace or config already exists, this is a re-run — continue in merge mode (Phase 6) and frame the interview around adjustments.
2. Ask **one question at a time**, covering: the target connectors (Linear today), the Linear team key, and the labels (spec / feature / initiative).
3. Never invent a default: every value comes from the user, from the connector manifest, or from a verified source (Phase 3).

### Phase 2 — Discovery (read-only)

1. Parse the known host MCP configs and map each linear-like server (`linear`, `linear-mcp`, …) to a transport `{command,args}` or `{url}`:
   * `.mcp.json` — Claude Code, `mcpServers` key;
   * `opencode.json` — `mcp` key;
   * `.agents/**`.
2. Tolerant parsing: malformed or unknown formats are ignored with a visible warning — never fatal, never repaired by the agent.
3. Several linear-like servers → list them and ask the human which one to use.
4. **No server found → explicit fallback (INV-2)**, never silent, never invented:
   * *enable without semantic validation* — the human dictates the transport and values, which will be marked « (non vérifiée) » in the synthesis; or
   * *stay local* — no connector enabled.

   The human arbitrates; nothing executes until then.

### Phase 3 — Validation via MCP

1. Verify the team key against the MCP server (list teams); resolve each label as *existing* or *to be created*, and say which explicitly.
2. Track a verification status per value: any value that cannot be verified enters the synthesis marked **« (non vérifiée) »** (INV-1).

### Phase 4 — Synthesis + dry-run

1. Present the synthesis: each value with its status (verified / « (non vérifiée) »), the resolved transport (secrets redacted — see *Secrets*), and the labels existing / to-create.
2. Only a complete synthesis unlocks the dry-run (the phase order is non-negotiable). Show the full command and run it:
   ```bash
   sdd init --connector linear \
     --linear.teamKey=ENG \
     --linear.labels.spec=SPEC \
     --linear.mcp.command=npx \
     --linear.mcp.args=-y --linear.mcp.args=mcp-server-linear-app \
     --dry-run
   ```
   HTTP transport instead: `--linear.mcp.url=https://mcp.linear.app/sse` (exactly one of the two forms).
3. The dry-run prints the resolved config (deep-merged against the existing one on a re-run) and writes nothing.

### Phase 5 — Application (CLI-only, after explicit confirmation)

1. Wait for the human's explicit confirmation. **Refusal → nothing is executed**; the synthesis stays consultable.
2. On confirmation, run the exact validated command without `--dry-run`, or `sdd connectors enable linear --teamKey=… --linear.mcp.command=…` on an already-initialized workspace. Never paste the dry-run preview into a hand-edited config (INV-3).
3. Close with `sdd validate` (the `connector-settings` rule checks the manifest-required settings and rejects secret-shaped keys) and point to the next step (`sdd sync --create`).

### Phase 6 — Idempotence (re-runs)

1. A re-run reads `sdd status` first: existing workspace, already-enabled connector, current settings.
2. Propose adjustments as a **merge**: preview with `sdd init --connector linear --linear.… --dry-run`, apply on confirmation. Explicit values win, manifest defaults never overwrite a user value, connectors are added but never removed — nothing is duplicated.
3. Dogfood check: running `/setup` on this very repo must exercise this branch (its workspace is already configured).

## Hard guardrails (invariant traceability)

* **INV-1 · Verified-or-marked values** → Phases 3–4: only MCP-verified values reach the CLI; anything unverified is marked « (non vérifiée) » in the synthesis before application.
* **INV-2 · Explicit fallback** → Phase 2: no MCP server found → both paths offered, the human decides, nothing runs silently.
* **INV-3 · CLI-only persistence** → Phase 5: full dry-run shown + explicit confirmation; `sdd init` / `sdd connectors enable` are the only writers; never hand-edit `.sdd/config.json` or a model file (Rule 7).
* **INV-4 · Idempotent** → Phases 1 & 6: `sdd status` first on every run, adjustments proposed as a merge, zero duplication.

## Secrets (hard rule)

Host MCP configs often carry credentials (env vars inside `command`, tokens in headers or URLs). Pass the resolved transport through the flags verbatim — an env-var *reference* may be displayed — but **never display, log, quote or copy a secret value** into the synthesis, the dry-run command or a setting. If the resolved transport embeds a literal secret, pause and let the human substitute it with an env-var reference in their own config (you never edit host configs), or fall back to the Phase 2 explicit choice. `sdd validate` rejects secret-shaped settings keys (`apiKey`, `token`, `secret`) — the framework carries zero credentials.
