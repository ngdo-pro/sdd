---
name: sync-knowledge
description: Propagate a delivered specification into the living knowledge documentation and cascade the completion upwards through the model.
---

# Skill: sync-knowledge

Use this skill after an engineering specification has passed all quality gates and review audits (`/sync-knowledge [id]`).

All updated knowledge documents must be maintained in the user's language.

> **Model-first (Rule 7):** the spec, its parent feature and initiative live in `.sdd/canonical/`. Their markdown documents and remote issues are generated projections. Completion propagates **only** through the CLI.

---

## Procedure

1. **Locate Specification:**
   ```bash
   sdd status [id]
   ```
   Identify the target domain from its metadata; ensure `.sdd/knowledge/domains/[domain]/` exists (initialize if greenfield).

2. **Execute Pillar Synchronizations (knowledge is hand-authored, not modelled):**
   * **Behavior (`/sync-behavior [id]`):** update `.sdd/knowledge/domains/[domain]/behavior.md` (journeys, Mermaid flowchart, business rules, failure matrix). Enforce zero technical pollution.
   * **Contracts (`/sync-contracts [id]`):** update `.sdd/knowledge/domains/[domain]/contracts.md` (endpoints, DTOs, validation schemas).
   * **Models (`/sync-models [id]`):** update `.sdd/knowledge/domains/[domain]/models.md` (aggregates, SQL tables, migrations, ERD).
   * **Tech (`/sync-tech [id]`):** update `.sdd/knowledge/domains/[domain]/tech.md` (patterns, services, security invariants).

3. **Identify & Formalize Structural Decisions (PDR / ADR):**
   * Scan the delivered delta for non-trivial trade-offs:
     - **Product / Ergonomic Decision (PDR):** → `.sdd/knowledge/decisions/product/PDR-XXX-[slug].md` via `templates/PDR_TEMPLATE.md`.
     - **Technical / Architectural Decision (ADR):** → `.sdd/knowledge/decisions/architecture/ADR-XXX-[slug].md` via `templates/ADR_TEMPLATE.md`.
   * Ask the user if any ambiguity remains.

4. **Complete & Cascate Through the CLI:**
   ```bash
   sdd done [id] --cascade
   ```
   This single command:
   * marks the spec `progress.done = true` and archives it (`active/ ➔ archive/`),
   * archives every unfinished parent whose children are now all complete (feature ➔ initiative),
   * regenerates every affected projection, the index, and mirrors the movements onto Linear.
   * The generated sections (`## 6. Implementation Spec(s)`, `## 4. Feature Roadmap`, vision `## 5.`) update automatically — **never edit them by hand**.

   Use `--dry-run` first to preview the cascade, and `--undo` to reopen a spec if it was closed by mistake.

5. **Verification & Confirmation:**
   * `sdd render --check` → must be clean.
   * `sdd validate` → must be clean.
   * Summarize all performed updates in the user's language: updated domain knowledge files, created PDRs/ADRs, archived spec, and the cascaded completion milestones (which features/initiatives were archived).
