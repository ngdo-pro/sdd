---
name: build-spec
description: Implement code changes, execute migrations, and pass quality gates for an active delta specification.
---

# Skill: build-spec

Use this skill when the user requests implementing an approved engineering specification (`/build-spec [id]`).

---

## Procedure

1. **Activate Specification (Planned ➔ Active):**
   * Check if the spec is located in `.specs/specs/planned/[id]*.md`:
     - If yes: move the file to `.specs/specs/active/[id]*.md` (the spec is now officially active in development).
     - If already in `.specs/specs/active/[id]*.md`: proceed directly.
   * Read `.specs/specs/active/[id]*.md`, `.specs/architecture.md`, and the target domain knowledge (`.specs/knowledge/domains/[domain]/`).
   * **Inventory & Signatures:** Analyze the factorized `tree` (Section 3.1) and key contracts (Section 3.2).
   * **Technical Watchouts:** Read **Section 6** before writing any code to prevent documented pitfalls.
   * **BDD Requirements:** Follow the Gherkin scenarios in **Section 8.1** (Unit ➔ Component/Integration ➔ E2E) as the direct implementation roadmap.
   * *Invariance Rule:* If the user requests a scope adjustment mid-development, update the active spec first (via `/update-spec`) before altering code.

2. **Data Tier & Persistence Implementation:**
   * Implement database migrations, schema definitions, and repository adapters according to project conventions.
   * Ensure primary key standards and data integrity constraints are strictly respected.
   * Implement corresponding unit and integration tests for persistence logic.

3. **Core Domain & Service Logic Implementation:**
   * Implement business logic, domain entities, use cases, and service layers adhering to the project's architectural pattern.
   * Keep business rules decoupled from transport and delivery frameworks.

4. **UI & Consumer Tier Implementation:**
   * Implement UI components, views, CLI handlers, or RPC controllers defined in the spec.
   * Adhere to project styling conventions (e.g., CSS Modules, design tokens) and state management patterns.
   * Handle standard interaction states (idle, loading, validation error, server error, success).

5. **Infrastructure & Configuration:**
   * Update configuration files, environment variable definitions, or container files as declared in Section 4.3 of the spec.
   * Propagate configuration changes across deployment configurations and CI/CD pipelines if applicable.

6. **Quality Gates & Command Execution (Section 8.2):**
   * First, execute the targeted test commands declared in Section 8.2 of the spec.
   * Next, run the project's static analysis, linting, and typechecking quality gates.
   * Fix all detected defects until a 100% pass rate is achieved.

7. **Status Update & Hand-off:**
   * Check off completed tasks in **Section 7 (Sequential Execution Plan)** within the active spec file.
   * Prompt user to run `/test-spec [id]` or `/sync-knowledge [id]`.
