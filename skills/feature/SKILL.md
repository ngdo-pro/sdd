---
name: feature
description: Frame a discrete functional or technical feature in .specs/initiatives/active/[initiative]/[feature].md, ready for technical spec.
---

# Skill: feature

Use this skill when the user wants to define or frame a discrete feature within an active initiative (`/feature [initiative] [feature-slug]`).

All generated feature documents (`.specs/initiatives/active/[initiative]/[feature-slug].md`) and user discussions must be authored in the user's language.

A **Feature** represents a concrete, cohesive unit of user experience or technical capability ideally sized for **1 engineering Spec Delta** (a few days of implementation).

The document must remain concise (**1 page maximum**), visual, and behavior-oriented.

---

## Procedure

### 1. Immersion
1. Read the parent initiative's overview in `.specs/initiatives/active/[initiative]/README.md` (or `.specs/initiatives/planned/[initiative]/README.md`).
2. Inspect active domain knowledge in `.specs/knowledge/domains/[domain]/` to understand current behavior.

### 2. Exhaustive Interaction & Invariants Interview (via `ask_question`)
Clarify all interaction specifics, edge cases, and constraints without artificial question caps:
* **Trigger & Wireframe:** How does the user/system initiate the action? What does the interaction look like visually (inline editing, popover, canvas connector)?
* **Functional Invariants:** What are the non-negotiable integrity rules (`INV-1`, `INV-2`...)? What happens on edge cases, empty states, or invalid inputs?
* **Out of Scope:** What elements are deliberately deferred to ensure rapid, focused delivery?
* **Scope Slicing:** If the interaction complexity reveals multiple distinct user workflows, sub-states, or conflicting goals, proactively propose splitting into multiple smaller features.

### 3. Generate Feature Document
1. Locate the parent initiative directory (`.specs/initiatives/active/[initiative]/` or `.specs/initiatives/planned/[initiative]/`). Ensure its `planned/` subfolder exists.
2. Instantiate `templates/FEATURE_TEMPLATE.md` in `.specs/initiatives/[initiative-dir]/planned/[feature-slug].md`.
3. Complete thoroughly in the user's language:
   - 2-sentence Problem & Trigger.
   - Precise ASCII wireframe.
   - 3-step nominal user flow (*Happy Path*: Trigger, Interaction, Validation).
   - Numbered functional invariants (`INV-1`, `INV-2`...).
   - Strict Out-of-Scope boundaries.
4. Update the feature roadmap in the parent initiative's `README.md`:
   - Link to the newly framed feature: `[`planned/[feature-slug].md`](./planned/[feature-slug].md)`.
   - Update its state indicator (e.g., `*(Framed ✅ — Ready for `/spec`)*`).

### 4. Next Step
Propose generating the corresponding technical engineering spec via `/spec [domain] [topic]`.
