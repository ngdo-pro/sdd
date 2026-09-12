# Core Specification Rules (Spec Rules)

These rules apply universally to all agents operating within the **Spec Framework**:

---

## 1. Path Portability & Relative Markdown Links Rule
* **Strictly Portable Paths:** Never include machine-specific absolute paths (`/Users/...`, `file:///...`, `C:\...`, `/tmp/...`) in any specification, initiative, feature, decision record (ADR/PDR), template, or living knowledge file.
* **Document-to-Document Markdown Links:** All Markdown hyperlinks (`[label](path)`) between files within the repository MUST use document-relative paths (e.g., `[ADR-0002](../../../decisions/architecture/ADR-0002.md)`, `[Contracts](./contracts.md)`). This guarantees that links resolve seamlessly across git platforms (GitHub, GitLab), IDE markdown previewers, and documentation generators.
* **Workspace-Relative Text References:** Mentions of source code files in text, lists, or trees are written relative to the workspace root without leading slashes (e.g., `src/core/user.ts`, `.specs/specs/active/...`).

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

---

## 5. Language Consistency Rule
* Agent definitions, skills instructions, rules, and tooling files are maintained in **English**.
* All generated deliverables (Vision, Initiatives, Features, Specs, Decisions, and user communications) must be authored in the **user's language**.

---

## 6. Exhaustiveness & Scope Slicing Rule
* **Never artificially cap questions, edge cases, invariants, or pitfalls.** Be thorough and resolve all ambiguities, failure modes, security boundaries, and architectural trade-offs upfront.
* **Proactive Scope Slicing:** If addressing all edge cases or pitfalls reveals that a feature or spec is becoming too dense, spans too many user journeys, or carries excessive risk, **never hide or omit requirements**. Instead, explicitly recommend slicing the scope into smaller, atomic, sequential features or specs.
