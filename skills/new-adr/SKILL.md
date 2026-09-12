---
name: new-adr
description: Formalize a technical, protocol, or architectural decision as an ADR.
---

# Skill: new-adr

Use this skill to record an architectural technical decision (`/new-adr [topic]`).

The generated ADR document must be authored in the user's language.

---

## Procedure

1. Determine the next sequential ID (`ADR-XXX`) in `.specs/decisions/adr/` (or `.specs/decisions/architecture/`).
2. Use `templates/ADR_TEMPLATE.md`.
3. Document the problem statement, compared technical options, chosen decision, and accepted trade-offs.
4. Create the document in `.specs/decisions/adr/ADR-XXX-[slug].md`.
