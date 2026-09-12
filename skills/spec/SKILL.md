---
name: spec
description: Frame an evolution requirement and generate a structured delta engineering specification in .specs/specs/planned/.
---

# Skill: spec

Use this skill when the user requests designing, specifying, or framing an engineering evolution for a domain (`/spec [domain] [requirement]`).

All generated specification documents (`.specs/specs/planned/XXX-[slug].md`) must be authored in the user's language.

---

## Procedure

1. **Domain Context & Greenfield Check:**
   * Check if `.specs/knowledge/domains/[domain]/` exists:
     - **If present (Brownfield):** Read domain knowledge files (`behavior.md`, `tech.md`, `contracts.md`, `models.md`) to build strictly upon existing foundations.
     - **If absent (Greenfield / Initial Bootstrap):** Do not block. Treat as a foundational spec establishing the initial architecture for this domain (knowledge base will be seeded upon `/sync-knowledge`).
   * If derived from an initiative feature, read the Feature file in `.specs/initiatives/(active|planned)/[initiative]/(active|planned)/[feature].md` to extract wireframes, invariants, and out-of-scope bounds.
   * Read `.specs/vision.md` and `.specs/architecture.md`.

2. **Exhaustive Technical Interview:**
   * Clarify all technical ambiguities (security boundaries, data migrations, failure modes, concurrency, backward compatibility) via `ask_question`. Never artificially cap questions.
   * **Proactive Slicing:** If resolving technical edge cases reveals cross-cutting complexity across multiple tiers (e.g., heavy backend contracts + complex UI canvas), proactively recommend splitting into sequential specs (e.g., Backend/Contracts first, then Frontend/UI).

3. **Sequential Identifier:**
   * Determine the next sequential 3-digit ID (`XXX`) by scanning `.specs/specs/planned/`, `.specs/specs/active/`, and `.specs/specs/archive/`.

4. **Generate Engineering Delta (`.specs/specs/planned/XXX-[slug].md`):**
   * Instantiate `templates/SPEC_TEMPLATE.md` into `.specs/specs/planned/XXX-[slug].md` adhering strictly to conciseness and structure rules:
     - **Absolute Path Portability:** All paths must be workspace-relative (relative to repository root, e.g., `src/...`, `tests/...`, `config/...`). Never include absolute machine paths.
     - **Section 1 (Intent & Context):** Why, impact, In Scope, Out of Scope. Include clean omission lines for irrelevant tiers (e.g., if UI-only, condense Data/Infra tiers into an omission note).
     - **Section 2 (Flow & Architecture):** Concise Mermaid diagram (nominal + error cases).
     - **Section 3 (Inventory & Contracts):**
       * `3.1 Factorized File Tree`: Strictly formatted as a factorized text `tree` with `[NEW]` / `[MOD]` tags and 1-line roles (bullet lists repeating full paths are forbidden).
       * `3.2 Key Contracts & Signatures`: Strict interface definitions in the project's native language (TypeScript interfaces, Go/Rust structs, Python/PHP DTOs, OpenAPI/protobuf schemas).
     - **Section 4 (Detailed Specifications):** Relevant subsections based on scope:
       * `4.1 Data Models & API Contracts`: Schemas, migrations, endpoints, RPCs.
       * `4.2 UI & Interaction Specifications`: ASCII wireframes, state matrices, CLI options.
       * `4.3 Infrastructure, Configuration & Runtime`: Env vars, container definitions, CI/CD pipelines, queues, workers.
     - **Section 5 (Business Invariants & Traceability):** Numbered binary invariants (`INV-1`, `INV-2`...) with short rule text and `↳ Covered by: [short files](#appendix-file-index)`.
     - **Section 6 (Technical Watchouts):** Exhaustive list of anticipated technical pitfalls and failure modes relevant to the project's stack (concurrency, race conditions, state mutations, cache invalidation, network latency, boundary validation).
     - **Section 7 (Sequential Execution Plan):** Phased checklist with atomic tasks linking to the file index.
     - **Section 8 (BDD Validation & Commands):**
       * `8.1 Exhaustive Gherkin Scenarios`: Mandatory 100% invariant coverage grouped into:
         1. Unit Tests (`@unit`)
         2. Component & Integration Tests (`@component` / `@integration`)
         3. End-to-End / Acceptance Tests (`@e2e`)
       * `8.2 Execution Commands & Quality Gates`: Project-specific copy-pasteable execution commands (test runner, typechecker, linter).
     - **Appendix (File Index):** Path resolution table mapping short names to full workspace-relative paths.

5. **Feature & Initiative Traceability:**
   * If derived from an initiative feature:
     - If the parent initiative is currently in `.specs/initiatives/planned/[initiative]/`:
       * Activate initiative: move directory from `planned/[initiative]/` to `active/[initiative]/`.
       * Update initiative `README.md` header to `Status: Active`.
       * In `.specs/vision.md`, promote the initiative entry from `🎯 Planifiées (Prêtes)` to `🚀 En Cours (Actives)`.
     - If the feature is currently in `[initiative]/planned/[feature].md`:
       * Activate feature: move file from `planned/[feature].md` to `active/[feature].md`.
       * In initiative `README.md`, update link to `active/[feature].md` with state indicator `*(Active 🛠️)*`.
     - In the feature document, set `Status: Active`.
     - Add the new spec under `## 6. Implementation Spec(s)`:
       `- [ ] **`[XXX-[slug]]`** : [Spec Title] (File: `.specs/specs/planned/XXX-[slug].md`)`

6. **Validation:**
   * Invite the user to review the spec before launching implementation (`/build-spec XXX`).
