---
name: initiative
description: Frame a major strategic milestone (Product or Tech) and generate its overview document in .specs/initiatives/active/[slug]/README.md.
---

# Skill: initiative
 
Use this skill when the user wants to launch or structure a major strategic milestone (`/initiative [slug] [topic]`).

All generated initiative documents (`.specs/initiatives/active/[slug]/README.md`) and user discussions must be authored in the user's language.

An **Initiative** represents a major strategic theme (quarterly or multi-feature), whether:
* **Product / UX** (e.g., `studio-modeling`, `collaborative-editing`)
* **Architecture / Tech** (e.g., `rust-core-engine`, `css-modules-migration`)

It must not exceed **1 to 2 pages** and aims primarily to align the overarching intent, establish the target system mental model/ASCII diagram, and lay out the **Feature Roadmap**.

---

## Procedure

### 1. Immersion & Duplicate Prevention
1. Read `.specs/vision.md` to ensure alignment with foundational tenets and check Section 5 (*Roadmap*).
2. **Existence & Duplicate Check:**
   * Inspect `.specs/initiatives/planned/`, `.specs/initiatives/active/`, and `.specs/initiatives/archive/`:
     - **If already planned in `.specs/initiatives/planned/[slug]/`:** Inform the user that the initiative is already framed. Propose either activating it into `active/` or editing its roadmap.
     - **If already active in `.specs/initiatives/active/[slug]/`:** Stop immediately. Inform the user that the initiative is active, present its current roadmap, and suggest contributing via `/feature [slug] [feature-slug]`.
     - **If already archived in `.specs/initiatives/archive/[slug]/`:** Warn the user that this milestone has been delivered. Suggest an explicit follow-up slug (e.g., `[slug]-phase2`) or direct maintenance specs.
     - **Scope Overlap:** Verify that the proposed scope does not duplicate an existing planned or active theme under an alternate naming.
3. **WIP Limit Check:** If 2 or more initiatives are currently active in `.specs/initiatives/active/`, the new initiative should be placed in `planned/` by default.

### 2. Exhaustive Framing Interview (via `ask_question`)
Clarify all strategic axes with the user without artificial question caps:
* **The Gap / Leap:** What is the current bottleneck and what is the desired future state?
* **Global Architecture / Tenets:** What non-negotiable rules govern this initiative?
* **Preliminary Roadmap:** What logical Features comprise this initiative?
* **Scope Slicing:** If the strategic leap reveals too many disparate subsystems or conflicting milestones, proactively recommend slicing into separate, sequential initiatives.

### 3. Generate Initiative Document
1. Create directory `.specs/initiatives/planned/[slug]/` (or `active/[slug]/` if activating immediately under WIP limits) and initialize its subdirectories: `planned/`, `active/`, and `archive/`.
2. Instantiate `templates/INITIATIVE_TEMPLATE.md` in `.specs/initiatives/planned/[slug]/README.md`.
3. Complete thoroughly in the user's language:
   - Intent & Gap (Today vs Tomorrow).
   - Target System ASCII Diagram.
   - Strategic Invariants.
   - Ordered Feature Roadmap.
4. Register the initiative in `.specs/vision.md` under `🎯 Planifiées (Prêtes)`.

### 4. Next Step
Prompt the user to frame the first Feature of the initiative via `/feature [initiative-slug] [feature-slug]`.
