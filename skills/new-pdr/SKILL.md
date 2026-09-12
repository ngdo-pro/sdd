---
name: new-pdr
description: Formalize an ergonomic or product design decision as a PDR.
---

# Skill: new-pdr

Use this skill to document a strategic product or user experience decision (`/new-pdr [topic]`).

The generated PDR document must be authored in the user's language.

---

## Procedure

1. Determine the next sequential ID (`PDR-XXX`) in `.specs/decisions/pdr/` (or `.specs/decisions/product/`).
2. Use `templates/PDR_TEMPLATE.md`.
3. Document the user context, evaluated interaction options, chosen decision, and ergonomic trade-offs.
4. Create the document in `.specs/decisions/pdr/PDR-XXX-[slug].md`.
