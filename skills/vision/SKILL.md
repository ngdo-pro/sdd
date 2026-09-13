---
name: vision
description: Frame or update the foundational product vision and core tenets in the canonical model (.sdd/canonical/vision.json + vision.md).
---

# Skill: vision

Use this skill when the user wants to define, challenge, or overhaul the global product vision (`/vision`).

All generated vision content must be authored in the user's language.

The Product Vision is the project's **foundational constitution**. It must remain concise (1 page maximum), impactful, purely product-focused (zero engineering jargon), and serve as an authoritative north star to settle trade-offs.

> **Model-first (Rule 7):** the vision lives in `.sdd/canonical/vision.json` (metadata) + `.sdd/canonical/vision.md` (body). `.sdd/generated/vision.md` is a **generated projection** — never edit it.

---

## Procedure

### 1. Immersion & Current Baseline
1. Read the current model with `spec status vision --json` (or `.sdd/canonical/vision.md` if it exists).
2. If no model exists yet, run `spec init` first.
3. Reference template for the **body sections**: `templates/VISION_TEMPLATE.md`.

### 2. Targeted Vision Interview
Conduct an interactive interview through targeted questions covering the 4 manifest pillars:

* **Wave 1: Core Purpose (*The Why & Who*)**
  - What unbearable user frustration exists with current market alternatives?
  - Who is the primary target audience (and who is explicitly out of scope)?
  - What is the single North Star Metric?
* **Wave 2: Three Experience Pillars**
  - What 3 foundational, differentiating promises does the product deliver?
  - How does this experience transform the user's daily workflow?
* **Wave 3: Product Tenets**
  - What 4 non-negotiable rules automatically arbitrate design dilemmas?
  - What is prioritized over what (e.g., *semantic rigor over unstructured drawing*)?
* **Wave 4: Guardrails (*Anti-Vision*)**
  - What does the product categorically refuse to become?

> **Drafting Rules:**
> - **Zero Engineering Jargon:** never mention databases, APIs, bounded contexts or directories.
> - **Strict 1-Page Format:** short, punchy, active sentences.
> - **Sections 1 to 4 only.** `## 5. Strategic Initiatives Roadmap` is **generated** from the graph (rule 7) — never author it.

### 3. Persist Through the CLI
1. Write the body (sections 1-4, following `templates/VISION_TEMPLATE.md`) to a scratch file, e.g. `.sdd/.draft-vision.md`.
2. Commit it to the model:
   ```bash
   spec upsert vision --title "[Product Name]" --from .sdd/.draft-vision.md
   ```
3. Delete the scratch file. The CLI regenerates `.sdd/generated/vision.md` and the index automatically.

### 4. Confirmation
Present a concise summary of the validated trade-offs in the user's language, and confirm the roadmap section was regenerated.
