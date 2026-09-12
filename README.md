# Spec Framework (Spec-Driven Development)

A structured, universal framework to drive AI agentic software development through a rigorous, scannable, and highly executable documentation pipeline.

Natively compatible with **Google Antigravity (`.agents`)** and **Claude Code (`.claude`)**.

---

## Pipeline Architecture

```text
1. VISION         → "Why the product exists" (.specs/vision.md)
   ↓
2. INITIATIVE     → "The macro strategic milestone" (.specs/initiatives/(planned|active|archive)/[slug]/README.md)
   ↓
3. FEATURE        → "What the user or system achieves" (.specs/initiatives/.../[slug]/(planned|active|archive)/[feature].md)
   ↓
4. SPEC           → "The executable, tested engineering plan" (.specs/specs/(planned|active|archive)/XXX-[slug].md)
   ↓
5. BUILD & QA     → Code implementation & quality gates validation
   ↓
6. SYNC KNOWLEDGE → Living documentation & capitalization (.specs/knowledge/)
```

---

## Plugin Contents

* **`agents/`**: Specialized agent definitions (Product Orchestrator, Delivery Orchestrator, Knowledge Orchestrator, Product Designer, Product Challenger, Spec Writer, Implementer, QA Tester, Clean-Room Reviewer).
* **`templates/`**: Standardized markdown templates (Vision, Initiative, Feature, Spec, ADR, PDR, Domain Behavior, Contracts, Models, Tech).
* **`skills/`**: Agentic skills and slash commands (`/vision`, `/initiative`, `/feature`, `/spec`, `/build-spec`, `/test-spec`, `/sync-knowledge`, `/sync-behavior`, `/sync-contracts`, `/sync-models`, `/sync-tech`, etc.).
* **`rules/`**: Specification integrity rules (`spec-rules.md`).
