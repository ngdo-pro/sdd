---
name: vision
description: Frame or update the foundational product vision and core tenets in .specs/vision.md through targeted questioning.
---

# Skill: vision

Use this skill when the user wants to define, challenge, or overhaul the global product vision (`/vision`).

All generated vision documents (`.specs/vision.md`) and user discussions must be authored in the user's language.

The Product Vision is the project's **foundational constitution**. It must remain concise (1 page maximum), impactful, purely product-focused (zero engineering jargon about databases, APIs, or directory paths), and serve as an authoritative north star to settle trade-offs.

---

## Procedure

### 1. Immersion & Current Baseline
1. Read `.specs/vision.md` (if existing) or `.agents/plugins/spec-framework/templates/VISION_TEMPLATE.md`.
2. Identify strategic tensions, recent application shifts, or user pivot goals.

### 2. Targeted Vision Interview
Conduct an interactive interview through targeted questions covering the 4 manifest pillars:

* **Wave 1: Core Purpose (*The Why & Who*)**
  - What unbearable user frustration exists with current market alternatives?
  - Who is the primary target audience (and who is explicitly out of scope)?
  - What is the single North Star Metric?
* **Wave 2: Three Experience Pillars**
  - What 3 foundational, differentiating promises does the product deliver?
  - How does this user experience transform the user's daily workflow?
* **Wave 3: Product Tenets**
  - What 4 non-negotiable rules automatically arbitrate design dilemmas?
  - What is prioritized over what (e.g., *semantic rigor over unstructured drawing*)?
  - What commitments exist regarding ergonomic flow and data non-destructiveness?
* **Wave 4: Guardrails (*Anti-Vision*)**
  - What does the product categorically refuse to become (e.g., no throwaway Miro clone, no Jira ticket board, no bureaucratic UML modeler)?

> **Drafting Rules:**
> - **Zero Engineering Jargon:** Never mention database engines, APIs, bounded contexts, or directory paths (those belong exclusively in `.specs/architecture.md`).
> - **Strict 1-Page Format:** Short, punchy, active sentences.
> - **Language:** The generated `.specs/vision.md` document must be authored in the user's language.

### 3. Generate / Update Document
1. Instantiate or update `.specs/vision.md` strictly following `templates/VISION_TEMPLATE.md` in the user's language.
2. Present a concise summary of validated trade-offs to the user in the user's language.
