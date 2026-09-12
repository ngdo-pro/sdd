---
name: sync-behavior
description: Synchronize functional behavior changes from a delivered specification into .specs/knowledge/domains/[domain]/behavior.md.
---

# Skill: sync-behavior

Use this skill to update the functional living documentation of a domain (`/sync-behavior [id]`), following the strict structure of `DOMAIN_BEHAVIOR_TEMPLATE.md`.

---

## Procedure

1. **Load Inputs:**
   * Read the delivered specification `.specs/specs/active/[id]*.md` and identify its target domain (`[domain]`).
   * Read the existing domain behavior document `.specs/knowledge/domains/[domain]/behavior.md`.
   * If `behavior.md` does not exist, initialize it from `templates/DOMAIN_BEHAVIOR_TEMPLATE.md`.

2. **Extract Functional Delta:**
   * **Scope & Bounded Context:** Verify that all changes belong strictly to this domain.
   * **Mermaid Flowchart:** Update the domain workflow diagram to reflect new navigation paths, views, or state transitions.
   * **Journeys Mapping:** Add or update table rows in Section 2 (`PAR-[DOM]-XX`).
   * **Journey Details:** Add standardized cards in Section 3 (Actor, Preconditions, Trigger, Nominal Steps, Post-conditions).
   * **Business Invariants:** Append or refine domain rules (`RULE-[DOM]-XX`) in Section 4.
   * **Failure Matrix:** Update Section 5 with new user-visible error states and recovery actions.

3. **Enforce Cleanliness (Strict Guardrails):**
   * **Zero Technical Pollution:** Strictly remove or prevent any CSS classes, database schemas, API payload structures, or package names from entering `behavior.md`. Those belong exclusively in `contracts.md`, `models.md`, or `tech.md`.
   * Ensure language consistency (written in the user's language).

4. **Save & Report:**
   * Write updated content to `.specs/knowledge/domains/[domain]/behavior.md`.
   * Return a concise summary of behavioral changes synchronized.
