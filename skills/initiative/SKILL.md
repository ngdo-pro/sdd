---
name: initiative
description: Frame a major strategic milestone (Product or Tech) and persist it into the canonical model.
---

# Skill: initiative

Use this skill when the user wants to launch or structure a major strategic milestone (`/initiative [slug] [topic]`).

All generated initiative content must be authored in the user's language.

An **Initiative** represents a major strategic theme (quarterly or multi-feature), whether:
* **Product / UX** (e.g., `studio-modeling`, `collaborative-editing`)
* **Architecture / Tech** (e.g., `rust-core-engine`, `css-modules-migration`)

It must not exceed **1 to 2 pages**, and aims primarily to align the overarching intent, establish the target system mental model/ASCII diagram, and lay out the **Feature Roadmap** (which is generated).

> **Model-first (Rule 7):** the initiative lives in `.sdd/canonical/initiatives/<initiative>/<initiative>.json` + `<initiative>.md` (stateless layout). Markdown under `.sdd/generated/initiatives/` is generated.

---

## Procedure

### 1. Immersion & Duplicate Prevention
1. Read the vision: `spec status vision --json` (align with tenets).
2. **Existence & Duplicate Check:**
   ```bash
   spec list --kind initiative
   spec status <slug>
   ```
   * **Already planned/active:** stop and inform the user; propose contributing via `/feature [slug] [feature-slug]` instead of duplicating.
   * **Already archived:** warn that the milestone was delivered; suggest an explicit follow-up slug (e.g. `[slug]-phase2`).
   * **Scope overlap:** verify the proposed scope does not duplicate an existing theme under an alternate name.
3. **WIP Limit Check:** if 2 or more initiatives are `active`, the new initiative should default to `planned`.

### 2. Exhaustive Framing Interview (via `ask_question`)
Clarify all strategic axes without artificial question caps:
* **The Gap / Leap:** current bottleneck vs desired future state.
* **Global Architecture / Tenets:** non-negotiable rules governing this initiative.
* **Preliminary Roadmap:** which logical Features comprise this initiative.
* **Scope Slicing:** if the leap reveals too many disparate subsystems, recommend slicing into sequential initiatives.

### 3. Persist Through the CLI
1. Write the **body** (sections 1-3 following `templates/INITIATIVE_TEMPLATE.md`) to a scratch file, e.g. `.sdd/.draft-<initiative-slug>.md`.
   * **Do not author `## 4. Feature Roadmap`** — it is generated from the features linked to this initiative.
2. Commit it to the model:
   ```bash
   spec upsert initiative --slug [slug] --title "[Initiative Name]" \
        --state planned --field "Type=Product / UX" --from .sdd/.draft-<initiative-slug>.md
   ```
3. Delete the scratch file. The CLI regenerates the projection and index.

### 4. Next Step
Prompt the user to frame the first Feature via `/feature [initiative-slug] [feature-slug]`.
