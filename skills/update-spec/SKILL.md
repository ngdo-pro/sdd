---
name: update-spec
description: Update an active engineering specification body during a pivot, scope adjustment, or business rule refinement.
---

# Skill: update-spec

Use this skill whenever the user requests modifying, trimming, or enriching the scope of an active engineering specification (`/update-spec [id] [adjustments]`), or whenever a pivot occurs during development.

> **Model-first (Rule 7):** you edit the **body** in the canonical model, never the generated projection.

---

## Procedure

1. **Load the Active Specification:**
   * Locate it through the CLI: `spec status [id]` (or `spec list --kind spec --state active`).
   * Read the authoritative body from `.specs/model/specs/active/[id]*.md`.
   * If missing from `active/`, return an explicit error prompting the user to verify the ID.

2. **Exhaustive Impact Analysis:**
   * Rigorously identify all impacted body sections:
     * **Section 1 (Intent, Scope & Out of Scope):** add/remove scope items, update user impact and "Why".
     * **Section 2 (Flow & Mermaid Diagram):** update interaction sequences and data flows.
     * **Section 3 (File Inventory & Signatures):** update factorized tree inventory, DTOs, interfaces.
     * **Section 4 (Detailed Specifications):** adjust schemas, endpoints, wireframes, state matrices.
     * **Section 5 (Business Invariants & Traceability):** add/update/remove numbered invariants (`INV-X`).
     * **Section 6 (Technical Watchouts):** update anticipated pitfalls.
     * **Section 7 (Sequential Execution Plan):** rebalance the task checklist (`[ ]` / `[x]`).
     * **Section 8 (BDD Scenarios & Commands):** synchronize Gherkin scenarios.
     * **Appendix (File Index):** keep path resolutions in sync.

3. **Apply the Changes Through the CLI:**
   * Edit the body to a scratch file (e.g. `.specs/.draft-[id].md`) then persist it:
     ```bash
     spec upsert spec --slug [id] --from .specs/.draft-[id].md
     ```
   * The title, metadata fields and all generated sections are preserved/regenerated automatically. Use `--title` / `--field Key=Value` to change them.
   * Relationships are changed with `spec link`, states with `spec move` — never by hand.
   * Thoroughly remove obsolete mentions or removed options from the body.

4. **Validation & Hand-off:**
   * Run `spec validate` and `spec render --check`.
   * Concisely summarize the contractual changes.
   * If associated code must be adjusted, resume implementation via `/build-spec [id]`.
