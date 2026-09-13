# Core Specification Rules (Spec Rules)

These rules apply universally to all agents operating within the **Spec Framework**:

---

## 1. Path Portability & Relative Markdown Links Rule
* **Strictly Portable Paths:** Never include machine-specific absolute paths (`/Users/...`, `file:///...`, `C:\...`, `/tmp/...`) in any specification, initiative, feature, decision record (ADR/PDR), template, or living knowledge file.
* **Document-to-Document Markdown Links:** All Markdown hyperlinks (`[label](path)`) between files within the repository MUST use document-relative paths (e.g., `[ADR-0002](../../../decisions/architecture/ADR-0002.md)`, `[Contracts](./contracts.md)`). This guarantees that links resolve seamlessly across git platforms (GitHub, GitLab), IDE markdown previewers, and documentation generators.
* **Workspace-Relative Text References:** Mentions of source code files in text, lists, or trees are written relative to the workspace root without leading slashes (e.g., `src/core/user.ts`, `.sdd/canonical/initiatives/<initiative>/features/<feature>/specs/042.md`).

---

## 2. Scannability & Conciseness Rule
* **Initiatives and Features: 1 to 2 pages maximum.** Avoid narrative prose essays. Prioritize ASCII diagrams, invariant lists, and behavioral tables.
* **Engineering Specs (`SPEC_TEMPLATE.md`):**
  - Section 3.1: File inventory must be presented as a factorized text `tree` with `[NEW]` and `[MOD]` tags. Bullet lists repeating the full path on every line are forbidden.
  - Clean omission notes: Condense irrelevant technical tiers into a single clear omission line (e.g., if UI-only, condense Data/Infra tiers into an explicit omission note).

---

## 3. BDD Traceability Rule
* **Every Invariant (`INV-X`)** defined in Section 5 of an engineering spec must have:
  1. A direct file coverage mapping in the appendix (`↳ Covered by: [files]`).
  2. A dedicated Gherkin test scenario in Section 8.1.
* Zero unverified or orphan invariants allowed.

---

## 4. Integrity & Non-Regression Rule
* A spec can only be marked as completed and synced into `knowledge/` when **100% of quality gates** (unit tests, component/integration tests, e2e tests, linter, typechecker) pass cleanly.
* **Reviewer Independent Execution:** The Clean-Room Reviewer is strictly required to execute the test suite (unit, integration, E2E) and static checks locally during audit before granting `APPROVED`. Zero faith-based or unchecked approvals allowed.

---

## 5. Language Consistency Rule
* Agent definitions, skills instructions, rules, and tooling files are maintained in **English**.
* All generated deliverables (Vision, Initiatives, Features, Specs, Decisions, and user communications) must be authored in the **user's language**.

---

## 6. Exhaustiveness & Scope Slicing Rule
* **Never artificially cap questions, edge cases, invariants, or pitfalls.** Be thorough and resolve all ambiguities, failure modes, security boundaries, and architectural trade-offs upfront.
* **Proactive Scope Slicing:** If addressing all edge cases or pitfalls reveals that a feature or spec is becoming too dense, spans too many user journeys, or carries excessive risk, **never hide or omit requirements**. Instead, explicitly recommend slicing the scope into smaller, atomic, sequential features or specs.

---

## 7. Model-First & Single-Writer Rule
* **Canonical model:** The single source of truth is `.sdd/canonical/` — one JSON metadata file plus one markdown body file per artifact (stateless layout, no lifecycle segment in any path):
  - `vision.json` / `vision.md`
  - `initiatives/<initiative-slug>/<initiative-slug>.{json,md}`
  - `initiatives/<initiative>/features/<feature>/specs/<id>.{json,md}`
* **Everything else is generated:** markdown documents under `.sdd/` and remote issues (Linear, …) are **projections**. Never hand-edit a projection or a remote issue as a primary copy — edit the model and re-project.
* **Single writer (CLI):** all model mutations go through the `spec` CLI. Never write model files by hand, and never `mv` projections:
  - `sdd upsert <kind> --slug <slug> --from <file>` — author/update an artifact.
  - `sdd link <ref> --feature|--initiative <parent>` — set graph relations.
  - `sdd move <ref> --to <state>` — lifecycle transition (model + mirrors).
  - `sdd done <ref> --cascade` — mark delivered, archive, propagate upwards.
  - `sdd render [--check]` — regenerate projections (`--check` is the CI drift guard).
  - `sdd migrate [--dry-run]` — one-shot conversion of any legacy `.specs/` workspace (v2 model or v3-canonical) into `.sdd/`: full reconstruction from the metadata, strict gate (`sdd validate` + `sdd render --check` exit 0), then the legacy root is retired.
  - `sdd import` — one-shot conversion of legacy markdown documents into the model.
* **Generated sections:** the following sections are derived from the graph and must never be authored inside a body — the renderer appends them:
  - initiative `## 4. Feature Roadmap`
  - feature `## 6. Implementation Spec(s)`
  - vision `## 5. Strategic Initiatives Roadmap`
  The header/metadata block (title, `Status:`, `Parent Initiative:`, spec `## Metadata`) is likewise generated from the model.
* **Derived completion:** an artifact is complete when its children are all complete (leaf artifact ⇒ its `progress.done` flag). `sdd done --cascade` archives every unfinished parent whose children are complete — this is the only sanctioned way to propagate completion upwards.
* **Local-first source of truth:** `.sdd/canonical/` is canonical and versioned; remote connectors are **mirrors**. Never author the sole copy of an artifact remotely.
* **Connector resolution:** mirrors are declared in `.sdd/config.json` and resolved through the adapter port documented in `extensions/README.md`. Extensions MUST respect `--dry-run` and be idempotent.
* **Read-only inspection:** `sdd status`, `sdd list`, `sdd graph` and `sdd validate` (rules 1 & 3 enforcement) are the canonical ways to inspect the workspace.
