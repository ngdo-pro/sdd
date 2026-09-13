---
name: feature
description: Frame a discrete functional or technical feature and persist it into the canonical model, linked to its initiative.
---

# Skill: feature

Use this skill when the user wants to define or frame a discrete feature within an initiative (`/feature [initiative] [feature-slug]`).

All generated feature content must be authored in the user's language.

A **Feature** represents a concrete, cohesive unit of user experience or technical capability ideally sized for **1 engineering Spec Delta** (a few days of implementation). The document must remain concise (**1 page maximum**), visual, and behavior-oriented.

> **Model-first (Rule 7):** the feature lives in `.sdd/canonical/initiatives/<initiative>/features/<feature>/<feature>.json` + `<feature>.md` (stateless layout). Markdown under `.sdd/generated/initiatives/` is generated.

---

## Procedure

### 1. Immersion
1. Read the parent initiative: `sdd status [initiative] --kind initiative`.
2. Inspect active domain knowledge in `.sdd/knowledge/domains/[domain]/` (hand-authored, not part of the model).
3. Check for duplicates: `sdd list --kind feature`.

### 2. Exhaustive Interaction & Invariants Interview (via `ask_question`)
Clarify all interaction specifics, edge cases, and constraints without artificial question caps:
* **Trigger & Wireframe:** how is the action initiated? What does the interaction look like visually?
* **Functional Invariants:** non-negotiable integrity rules (`INV-1`, `INV-2`...)? Behavior on edge cases, empty states, invalid inputs?
* **Out of Scope:** what is deliberately deferred to ensure focused delivery?
* **Scope Slicing:** if complexity reveals multiple distinct workflows, propose splitting into smaller features.

### 3. Persist Through the CLI
1. Write the **body** (sections 1-5 following `templates/FEATURE_TEMPLATE.md`) to a scratch file, e.g. `.sdd/.draft-[feature-slug].md`.
   * **Do not author `## 6. Implementation Spec(s)`** — it is generated from the specs linked to this feature.
   * Do not write the header/metadata block (`# Feature:`, `> **Parent Initiative:**`, `> **Status:**`) — the renderer generates it from the model.
2. Commit it to the model, linking the parent initiative in the same call:
   ```bash
   sdd upsert feature --slug [feature-slug] --title "[Feature Name]" \
        --initiative [initiative-slug] --state planned --from .sdd/.draft-[feature-slug].md
   ```
3. Delete the scratch file.
4. If the relation was not set at creation time, register it explicitly:
   ```bash
   sdd link [feature-slug] --initiative [initiative-slug]
   ```
   The parent initiative's `## 4. Feature Roadmap` is regenerated automatically.

### 4. Next Step
Propose generating the corresponding technical engineering spec via `/spec [domain] [topic]`.
