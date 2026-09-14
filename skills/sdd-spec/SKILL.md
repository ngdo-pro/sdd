---
name: sdd-spec
description: Frame an evolution requirement and generate a structured delta engineering spec in the canonical model.
---

# Skill: spec

Use this skill when the user requests designing, specifying, or framing an engineering evolution for a domain (`/spec [domain] [requirement]`).

All generated specification content must be authored in the user's language.

A spec is stored as `.sdd/canonical/initiatives/<initiative>/features/<feature>/specs/<id>.json` (metadata) + `<id>.md` (body). The markdown under `.sdd/generated/` is a **generated projection** (spec bodies are flattened at `generated/initiatives/[initiative]/specs/[id].md`).

> **Model-first (Rule 7):** never edit `.sdd/generated/**` and never write model files by hand — always go through the `sdd` CLI.

---

## Procedure

1. **Domain Context & Greenfield Check:**
   * Check if `.sdd/knowledge/domains/[domain]/` exists:
     - **Present (Brownfield):** read `behavior.md`, `tech.md`, `contracts.md`, `models.md` to build strictly upon existing foundations.
     - **Absent (Greenfield / Bootstrap):** do not block; treat as the foundational spec for this domain (knowledge will be seeded on `/sync-knowledge`).
   * If derived from an initiative feature: `sdd status [feature-slug] --kind feature`.
   * Read the vision: `sdd status vision --json`.

2. **Exhaustive Technical Interview:**
   * Clarify all technical ambiguities (security boundaries, migrations, failure modes, concurrency, backward compatibility) via `ask_question`. Never artificially cap questions.
   * **Proactive Slicing:** if resolving edge cases reveals cross-cutting complexity across tiers, recommend splitting into sequential specs.

3. **Sequential Identifier:**
   * Determine the next free 3-digit id:
     ```bash
     sdd list --kind spec --json
     ```
   * Slugs are `XXX-slug` (e.g. `042-login`); the CLI derives the `id` from it.

4. **Author the Body (`templates/SPEC_TEMPLATE.md`):**
   * Write the body to a scratch file, e.g. `.sdd/.draft-XXX-[slug].md`, adhering strictly to conciseness and structure rules:
     - **Absolute Path Portability:** all paths workspace-relative (`src/...`, `tests/...`). Never machine-absolute paths (rule 1).
     - **Section 1 (Intent & Context):** Why, impact, In Scope, Out of Scope, with clean omission lines for irrelevant tiers.
     - **Section 2 (Flow & Architecture):** concise Mermaid diagram (nominal + error cases).
     - **Section 3 (Inventory & Contracts):**
       * `3.1 Factorized File Tree`: a factorized `tree` with `[NEW]`/`[MOD]` tags and 1-line roles (no full-path bullet lists).
       * `3.2 Key Contracts & Signatures`: strict interface definitions in the project's native language.
     - **Section 4 (Detailed Specifications):** `4.1 Data Models & API Contracts`, `4.2 UI & Interaction`, `4.3 Infrastructure & Runtime` — only the relevant ones.
     - **Section 5 (Business Invariants & Traceability):** `* **INV-1 · Rule Title**` + definition + `↳ *Covered by:* [...]` (rule 3).
     - **Section 6 (Technical Watchouts):** exhaustive anticipated pitfalls and failure modes.
     - **Section 7 (Sequential Execution Plan):** phased checklist with atomic tasks.
     - **Section 8 (BDD Validation & Commands):** `8.1` exhaustive Gherkin scenarios (`@unit` → `@component`/`@integration` → `@e2e`), `8.2` copy-pasteable execution commands.
     - **Appendix (File Index):** short name → workspace-relative path.
   * **Do not author the header:** `# Spec: XXX - Title` and the `## Metadata` block are generated from the model (`--title` and `--field`).

5. **Persist Through the CLI:**
   ```bash
   sdd upsert spec --slug XXX-[slug] --title "[Spec Title]" \
        --feature [feature-slug] --state planned \
        --field "Domain=\`.sdd/knowledge/domains/[domain]/\`" \
        --field "Change Type=\`New Capability\`" \
        --field "Complexity=\`Medium\`" \
        --from .sdd/.draft-XXX-[slug].md
   ```
   Then delete the scratch file.

6. **Link to the Parent Feature (if not set above):**
   ```bash
   sdd link XXX-[slug] --feature [feature-slug]
   ```
   The feature's `## 6. Implementation Spec(s)` section is regenerated automatically.

7. **Validation:**
   * `sdd validate` — enforces portable paths (rule 1) and invariant traceability (rule 3).
   * `sdd render --check` — confirms projections match the model.
   * Invite the user to review before implementation (`/build-spec XXX`).
