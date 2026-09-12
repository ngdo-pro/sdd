---
name: test-spec
description: Audit, design, and synchronize unit, integration, E2E tests, and their Gherkin scenarios in the active specification.
---

# Skill: test-spec

Use this skill to audit, design, and synchronize tests (unit, integration, E2E) ensuring every behavioral invariant and edge case possesses an automated test AND a matching Gherkin scenario in the active specification (`.specs/specs/active/[id]*.md`).

---

## When to use?

1. **Before or during `/build-spec`:** To frame the test strategy and apply TDD/BDD practices.
2. **After adding any test or handling an edge case:** To immediately synchronize Gherkin scenarios in Section 8.1 of the active spec (zero drift between spec and tests).
3. **Upon explicit request (`/test-spec [id]`):** To audit actual test coverage against acceptance criteria and invariants.

---

## Procedure

### 1. Cross-Audit: Spec vs Test Code
* Load the active specification in `.specs/specs/active/[id]*.md`.
* Analyze **Section 5 (Business Invariants & Traceability)** and **Section 8.1 (Exhaustive Gherkin Scenarios)**.
* Inspect existing test suites across the project's testing directories (unit, integration, acceptance/E2E).
* Identify discrepancies:
  * **Invariant or edge case lacking an automated test.**
  * **Existing unit, component, or E2E test without a corresponding Gherkin scenario in Section 8.1.**
  * **Obsolete Gherkin scenario out of sync with actual assertions.**

### 2. Implement Missing Tests
* **Unit Tier:**
  * Tests for isolated domain rules, math/parsing utilities, entities, and data transformations.
* **Component & Integration Tier:**
  * Tests for service boundaries, persistence adapters, and UI component interactions.
* **Acceptance & E2E Tier:**
  * Full nominal and failure workflows validating end-to-end integration and data persistence.

### 3. Systematic Active Spec Synchronization
* **Section 8.1 (Exhaustive Gherkin Scenarios):**
  * Populate missing scenarios respecting strict hierarchy by test tier:
    1. Unit Tests (`@unit`)
    2. Component & Integration Tests (`@component` / `@integration`)
    3. End-to-End Tests (`@e2e`)
  * Adhere to standard BDD syntax:
    ```gherkin
    @unit
    Scenario: [INV-X] [Concise verified behavior summary]
      Given [initial state]
      When [triggered action]
      Then [observable result and locked invariant]
    ```
* **Section 5 (Business Invariants):**
  * Update `↳ Covered by: [short files](#appendix-file-index)` to link invariants to test files.
* **Appendix (File Index):**
  * Add newly created test files to the path resolution table.

### 4. Validate Quality Gates (Section 8.2)
* Run the project's test suite and targeted commands as prescribed in Section 8.2.
* Verify zero linting, formatting, or static analysis errors using the project's validation commands.

### 5. Summary & Hand-off
* Summarize added/updated test files and counts.
* Confirm 1-to-1 synchronization between Section 5 invariants and Section 8.1 Gherkin scenarios.
