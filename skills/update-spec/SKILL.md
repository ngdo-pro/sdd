---
name: update-spec
description: Update an active engineering specification during a pivot, scope adjustment, or business rule refinement.
---

# Skill: update-spec

Use this skill whenever the user requests modifying, trimming, or enriching the scope of an active engineering specification (`/update-spec [id] [adjustments]`), or whenever a pivot occurs during development.

---

## Procedure

1. **Load Active Specification:**
   * Locate and read `.specs/specs/active/[id]*.md`.
   * If missing from `active/`, return an explicit error prompting to verify the ID.

2. **Exhaustive Impact Analysis:**
   * Rigorously identify all impacted spec sections:
     * **Section 1 (Intent, Scope & Out of Scope):** Add/remove scope items, update user impact and "Why".
     * **Section 2 (Flow & Mermaid Diagram):** Update interaction sequences and data flows.
     * **Section 3 (File Inventory & Signatures):** Update factorized tree inventory, DTOs, or interfaces.
     * **Section 4 (Detailed Specifications):** Adjust SQL schemas, endpoints, ASCII wireframes, or state matrices.
     * **Section 5 (Business Invariants & Traceability):** Add, update, or remove numbered invariants (`INV-X`).
     * **Section 6 (Technical Watchouts):** Update anticipated technical pitfalls.
     * **Section 7 (Sequential Execution Plan):** Rebalance task checklist (`[ ]` / `[x]`).
     * **Section 8 (BDD Scenarios & Commands):** Synchronize Gherkin scenarios to reflect modified behavior.
     * **Appendix (File Index):** Keep path resolutions in sync.

3. **Apply Specification Changes:**
   * Modify `.specs/specs/active/[id]*.md` directly in the user's language.
   * Thoroughly remove obsolete mentions or removed options.

4. **Summary & Hand-off:**
   * Concisely summarize contractual changes.
   * If associated code must be adjusted, resume implementation via `/build-spec [id]`.
