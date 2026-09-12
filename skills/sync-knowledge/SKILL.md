---
name: sync-knowledge
description: Propagate a delivered specification into the living knowledge documentation (.specs/knowledge/) via specialized sub-skills and archive the spec.
---

# Skill: sync-knowledge

Use this skill after an engineering specification has passed all quality gates and review audits (`/sync-knowledge [id]`).

All updated knowledge documents must be maintained in the user's language.

---

## Procedure

1. **Locate Specification:**
   * Read `.specs/specs/active/[id]*.md` and identify the target domain from its metadata (`[domain]`).
   * Ensure directory `.specs/knowledge/domains/[domain]/` exists (initialize if greenfield).

2. **Execute Pillar Synchronizations:**
   * **Behavior (`/sync-behavior [id]`):** Update `.specs/knowledge/domains/[domain]/behavior.md` (User journeys, Mermaid flowchart, business rules, failure matrix). Enforce zero technical pollution.
   * **Contracts (`/sync-contracts [id]`):** Update `.specs/knowledge/domains/[domain]/contracts.md` (REST endpoints, DTOs, Zod validation schemas).
   * **Models (`/sync-models [id]`):** Update `.specs/knowledge/domains/[domain]/models.md` (Aggregates, SQL tables, columns, migrations, ERD).
   * **Tech (`/sync-tech [id]`):** Update `.specs/knowledge/domains/[domain]/tech.md` (Architectural patterns, services, security invariants).

3. **Identify & Formalize Structural Decisions (PDR / ADR):**
   * Scan the delivered delta for non-trivial trade-offs:
     - **Product / Ergonomic Decision (PDR):** Access models, disruptive UX choices, simplified workflows.  
       $\rightarrow$ Generate PDR in `.specs/decisions/product/PDR-XXX-[slug].md` using `templates/PDR_TEMPLATE.md`.
     - **Technical / Architectural Decision (ADR):** New dependencies, rendering engines, persistence patterns, protocols.  
       $\rightarrow$ Generate ADR in `.specs/decisions/architecture/ADR-XXX-[slug].md` using `templates/ADR_TEMPLATE.md`.
   * Ask the user if any ambiguity remains regarding a potential decision.

4. **Archive Specification & Cascading Roadmap Completion:**
   * Move the specification file from `.specs/specs/active/` to `.specs/specs/archive/`.
   * **Level 1 (Feature):** If derived from an initiative feature:
     - Check off this spec under `## 6. Implementation Spec(s)`: `- [x] **`[XXX-[slug]]`**`.
     - **Cascade Check:** Are all specs in Section 6 now marked `[x]`?
       - If yes:
         * Update Feature header to `Status: Archived`.
         * Move the feature file from `active/[feature].md` to `archive/[feature].md`.
   * **Level 2 (Initiative):** If the Feature was archived:
     - In the parent initiative's `README.md`, update the feature link to `archive/[feature].md` and check it off: `- [x] **`[feature-slug]`**: ...`.
     - **Cascade Check:** Are all features of the initiative now in `archive/`?
       - If yes: update Initiative header to `Status: Archived` and move the initiative directory from `.specs/initiatives/active/[initiative]` to `.specs/initiatives/archive/[initiative]`.
   * **Level 3 (Vision):** If the Initiative was archived:
     - In `.specs/vision.md` under Section 5 (*Strategic Initiatives Roadmap*), check off the initiative: `- [x] **`[initiative-slug]`**: ...`.

5. **Confirmation:**
   * Summarize all performed updates (updated domain knowledge files, created PDRs/ADRs, archived spec, and cascaded completion milestones).
