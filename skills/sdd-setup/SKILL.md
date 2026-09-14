---
name: sdd-setup
description: The single conversational entry point to adopt the framework — read-only état des lieux, legacy `.specs/` migration, host wiring + model init, optional Linear mirror connector — every write through the `sdd` CLI, dry-run first.
---

# Skill: setup

`/setup` is the **unique entry point** to adopt the framework in a repo. There is no separate "install" conversation: probing the repo, migrating a legacy `.specs/` workspace, wiring the agent hosts, bootstrapping the model and enabling a mirror connector (Linear today) are ordered phases of this one protocol. Each phase is **conditional** (Phase 0 decides which ones apply) and **confirmed** (nothing mutates without an explicit go from the human).

Use this skill when the user runs `/setup`, asks to set the framework up in a repo, or asks to configure a mirror connector (Linear today) in their environment.

Everything shown to the adoptant (questions, matrices, syntheses, summaries) must be authored in the user's language; no unexplained CLI jargon in the questions.

> **Model-first (Rule 7):** this skill never writes a model or config file by hand. The `.sdd/` workspace is created and mutated exclusively through the `sdd` CLI (`sdd migrate`, `sdd install`, `sdd init`, `sdd connectors enable`). Host MCP configs (`.mcp.json`, `opencode.json`, `.agents/**`) are read-only: never edit, repair or provision them.

> **Test contract:** the `@protocol` Gherkin scenarios of spec 010 (§8.1) are behavioral contracts of this protocol, not `node:test` targets — this skill ships **no automated tests** and is validated by review and dogfooding. The hard layer beneath it (migration strict gate, install journal, dry-run previews, idempotent merge, `connector-settings` validation) is already automated by the specs 003–008 suites.

## CLI surface (the only persistence layer)

| Purpose | Command |
|---|---|
| Probe the workspace (Phase 0, first read of every run) | `sdd status` (or `--json`) · `sdd list --json` |
| Preview the legacy migration plan — writes nothing | `sdd migrate --dry-run` |
| Rebuild `.sdd/` from a legacy `.specs/` workspace, then retire it | `sdd migrate` |
| Preview the host wiring + model bootstrap — writes nothing | `sdd install --dry-run` |
| Wire the detected agent hosts, then run `sdd init` | `sdd install [--host h]` |
| Preview connector settings on an initialized workspace | `sdd connectors enable linear … --dry-run` |
| Apply or merge connector settings | `sdd connectors enable linear …` |
| Structural validation after every mutation | `sdd validate` |

Settings flags deep-merge and are coerced through the connector manifest: `--linear.<key>[.<subkey>]=<value>` (depth ≤ 2), repeated flags form arrays (`--linear.mcp.args=-y --linear.mcp.args=npx`), booleans are strict (`true`/`false`). The `mcp` transport is exactly one of `command`+`args` (stdio) or `url` (HTTP) — never both. The grammar is unified across `sdd init` and `sdd connectors enable|disable`: top-level keys bind to the positional connector id (`--teamKey=ENG`, dotted paths of a declared setting like `--mcp.command=…`) and the namespaced form is accepted when the namespace matches the id (`--linear.mcp.command=…`). `connectors enable` supports `--dry-run` — the same zero-write preview as `sdd init --dry-run` — so an enable or a re-run merge can be previewed before it is applied.

## Protocol — ordered phases, each conditional and confirmed

### Phase 0 — État des lieux (read-only, every run)

1. Probe first: `sdd status` (and `sdd list --json` when a workspace exists). If the CLI reports no workspace, a partial one, or an anomaly, keep its own diagnosis verbatim — never reinterpret or second-guess it.
2. Check the filesystem for: `.specs/` (legacy workspace) and the host markers `opencode.json`, `.claude/`, `.agents/` — the same markers `sdd install` detects.
3. Present the **to-do matrix**: what exists (workspace, wiring per host, legacy source, enabled connector) and what is missing (migration? wiring + init? connector?). No phase runs before the user has seen this matrix.
4. This phase never mutates anything and never re-implements the CLI's detection logic: **the CLI is the arbiter** — it already refuses coexistence (every mutation is locked while `.specs/` and `.sdd/` coexist; `sdd migrate` alone is the recovery path) and rejects invalid metadata. The skill reads verdicts, it does not render its own.

### Phase 1 — Legacy migration (only if `.specs/` exists)

* `.specs/` present and no valid `.sdd/`: run `sdd migrate --dry-run`, show the plan (artifacts, divergences, token rewrites, removals), and wait for an explicit confirmation before running `sdd migrate`. **Refusal → nothing is executed**; the plan stays consultable.
* `.specs/` and a valid `.sdd/` coexist: present the **arbitrage**, never a bare yes/no —
  * what the current `.sdd/` contains and its state (from `sdd list --json`: states, `updatedAt` dates);
  * what the legacy source contains (its own status markers, git history for recency);
  * and the CLI's verdict, shown verbatim: **`sdd migrate` wipes `.sdd/` and rebuilds it from the legacy source**, then retires `.specs/` — and meanwhile every other mutation is locked, so migrating (or restoring from git and removing the legacy root) is the only way out. The human decides with both sides on the table.
* After the migration, re-run `sdd status` and continue with the Phase 2 checklist (host wiring may still be missing).

### Phase 2 — Wiring + init (only if `.sdd/` is absent)

1. Run `sdd install --dry-run` first — it detects the hosts and prints the plan without writing anything.
2. Show the plan; on explicit confirmation run `sdd install`. Several hosts detected → the CLI asks which ones to wire (TTY) or fails in CI — pass `--host <id>` then. No host detected → `sdd init` still runs and manual wiring instructions are printed.
3. Close the phase with `sdd validate` and `sdd render --check`.

### Phase 3 — Connector (optional — only if the user wants one)

Ask first: a mirror connector (Linear today) or none? *None → skip straight to Phase 4.* Otherwise the validated sequence is unchanged (ex-spec 006):

1. **Interview** (one question at a time): the target connectors (Linear today), the Linear team key, and the labels (spec / feature / initiative). Never invent a default: every value comes from the user, from the connector manifest, or from a verified source (step 3).
2. **Discovery (read-only):** parse the known host MCP configs and map each linear-like server (`linear`, `linear-mcp`, …) to a transport `{command,args}` or `{url}`:
   * `.mcp.json` — Claude Code, `mcpServers` key;
   * `opencode.json` — `mcp` key;
   * `.agents/**`.
   Tolerant parsing: malformed or unknown formats are ignored with a visible warning — never fatal, never repaired by the agent. Several linear-like servers → list them and ask the human which one to use. **No server found → explicit fallback (INV-4)**, never silent, never invented:
   * *enable without semantic validation* — the human dictates the transport and values, which will be marked « (non vérifiée) » in the synthesis; or
   * *stay local* — no connector enabled.

   The human arbitrates; nothing executes until then.
3. **Validation via MCP:** verify the team key against the MCP server (list teams); resolve each label as *existing* or *to be created*, and say which explicitly. Track a verification status per value: any value that cannot be verified enters the synthesis marked **« (non vérifiée) »**.
4. **Synthesis + dry-run:** present the synthesis — each value with its status (verified / « (non vérifiée) »), the resolved transport (secrets redacted — see *Secrets*), and the labels existing / to-create. Only a complete synthesis unlocks the dry-run (the phase order is non-negotiable). Show the full command and run it:
   ```bash
   sdd connectors enable linear \
     --teamKey=ENG \
     --labels.spec=SPEC \
     --mcp.command=npx \
     --mcp.args=-y --mcp.args=mcp-server-linear-app \
     --dry-run
   ```
   HTTP transport instead: `--mcp.url=https://mcp.linear.app/sse` (exactly one of the two forms). On a workspace that was just bootstrapped by Phase 2 this is the canonical path; `sdd init --connector linear …` remains the equivalent declarative form. The dry-run prints the resolved config (deep-merged against the existing one on a re-run) and writes nothing.
5. **Application (CLI-only, after explicit confirmation):** wait for the human's explicit confirmation. **Refusal → nothing is executed.** On confirmation, run the exact validated command without `--dry-run`. Never paste the dry-run preview into a hand-edited config (INV-3). Close with `sdd validate` (the `connector-settings` rule checks the manifest-required settings and rejects secret-shaped keys) and point to the next step (`sdd sync --create`).

### Phase 4 — Recap

Present what was **done** (workspace bootstrapped, hosts wired, legacy migrated, connector enabled and validated) and what **remains** (a connector still marked « (non vérifiée) »? a host skipped? a legacy root retired or pending?). Point to the next step: the `/vision` skill, which frames the foundational product vision — the entry into the authored pipeline.

## State matrix

| Situation | Trigger | Behavior |
|---|---|---|
| **Blank repo** | nothing detected | Phase 2 (+3 if wanted) — install, then connector. |
| **Legacy `.specs/`** | `.specs/` present, no valid `.sdd/` | Phase 1: dry-run migration → confirmation → migrate → following phases. |
| **Complete workspace** | `.sdd/` present, no legacy | Phase 0 + adjustments (merge); connector if asked. |
| **Workspace + legacy** | both present | Arbitrage presented (migrate rebuilds `.sdd/` from the legacy source) — never a silent migration; every other mutation is locked meanwhile. |
| **No MCP** | connector wanted, no server found | Two explicit options (enable unvalidated / stay local) — INV-4. |

## Idempotence (re-runs)

A re-run always starts at Phase 0: the existing state is detected and **only the missing phases run** — a complete workspace gets Phase 0 + recap only. Adjustments are proposed as a **merge**: preview with `sdd connectors enable linear --linear.… --dry-run` (or the equivalent `sdd init --connector` form), apply on confirmation. Explicit values win, manifest defaults never overwrite a user value, connectors are added but never removed — nothing is duplicated. Dogfood check: running `/setup` on this very repo must exercise exactly that branch (its workspace is already configured).

## Hard guardrails (invariant traceability — spec 010)

* **INV-1 · Systematic état des lieux** → Phase 0 precedes any action; the whole protocol is idempotent end-to-end.
* **INV-2 · Migration never silent** → Phase 1: the `--dry-run` plan is shown + explicit confirmation required; an explicit arbitrage (with dates/states on both sides) when a valid `.sdd/` coexists.
* **INV-3 · Every write through the CLI** → Phases 1–3: `sdd migrate` / `sdd install` / `sdd connectors enable`, each with a prior dry-run; never hand-edit `.sdd/config.json`, a model file or a host config (Rule 7).
* **INV-4 · Collapsible connector** → Phase 3: no MCP server found → two explicit options, the human decides, nothing runs silently; no secret is ever displayed or stored.
* **INV-5 · Idempotent** → a re-run is Phase 0 → only the missing phases; zero duplication.

## Secrets (hard rule)

Host MCP configs often carry credentials (env vars inside `command`, tokens in headers or URLs). Pass the resolved transport through the flags verbatim — an env-var *reference* may be displayed — but **never display, log, quote or copy a secret value** into the synthesis, the dry-run command or a setting. If the resolved transport embeds a literal secret, pause and let the human substitute it with an env-var reference in their own config (you never edit host configs), or fall back to the Phase 3 explicit choice. `sdd validate` rejects secret-shaped settings keys (`apiKey`, `token`, `secret`) — the framework carries zero credentials.
