---
name: build-spec
description: Implement code changes, execute migrations, and pass quality gates for an active delta specification.
---

# Skill: build-spec

Use this skill when the user requests implementing an approved engineering specification (`/build-spec [id]`).

> **Model-first (Rule 7):** the spec lives in `.specs/model/specs/<state>/XXX-slug.{json,md}`. The projection `.specs/generated/initiatives/[initiative]/specs/[id].md` and the parent feature's `## 6.` section are generated — never edit them.

---

## Procedure

1. **Activate Specification (Planned ➔ Active):**
   ```bash
   spec move [XXX] --to active
   ```
   This performs the model transition, relocates both model files and the projection, and mirrors the movement onto every enabled backend.
   * **Reading the spec:** `spec status [XXX]` for metadata, then read `.specs/model/specs/active/XXX-*.md` for the **body** (the authoritative content).
   * **Inventory & Signatures:** analyze the factorized `tree` (Section 3.1) and key contracts (Section 3.2).
   * **Technical Watchouts:** read **Section 6** before writing any code.
   * **BDD Requirements:** follow the Gherkin scenarios in **Section 8.1** as the implementation roadmap.
   * *Invariance Rule:* if the user requests a scope adjustment mid-development, update the spec first via `/update-spec` before altering code.

2. **Data Tier & Persistence Implementation:**
   * Implement migrations, schema definitions, and repository adapters per project conventions.
   * Ensure primary key standards and integrity constraints are respected.
   * Implement corresponding unit and integration tests for persistence logic.

3. **Core Domain & Service Logic Implementation:**
   * Implement business logic, domain entities, use cases, and services per the project's architectural pattern.
   * Keep business rules decoupled from transport and delivery frameworks.

4. **UI & Consumer Tier Implementation:**
   * Implement UI components, views, CLI handlers, or RPC controllers defined in the spec.
   * Adhere to project styling conventions and state management patterns.
   * Handle standard interaction states (idle, loading, validation error, server error, success).

5. **Infrastructure & Configuration:**
   * Update configuration files, environment variable definitions, or container files declared in Section 4.3.
   * Propagate configuration changes across deployment configs and CI/CD pipelines if applicable.

6. **Quality Gates & Command Execution (Section 8.2):**
   * First execute the targeted test commands declared in Section 8.2.
   * Then run the project's static analysis, linting, and typechecking gates.
   * Fix all detected defects until a 100% pass rate is achieved.

7. **Status Update & Hand-off:**
   * Check off completed tasks in **Section 7** of the body (edit the model body via `/update-spec`, not the projection).
   * Verify `spec render --check` passes and `spec validate` is clean.
   * Prompt the user to run `/test-spec [id]` or `/sync-knowledge [id]`.
