---
name: sync-tech
description: Synchronize architectural patterns, technical components, and security invariants from a delivered specification into .specs/knowledge/domains/[domain]/tech.md.
---

# Skill: sync-tech

Use this skill to update the technical architecture and patterns documentation of a domain (`/sync-tech [id]`), following `DOMAIN_TECH_TEMPLATE.md`.

---

## Procedure

1. **Load Inputs:**
   * Read the delivered specification `.specs/specs/active/[id]*.md` and identify its target domain (`[domain]`).
   * Read `.specs/knowledge/domains/[domain]/tech.md` (or initialize from `templates/DOMAIN_TECH_TEMPLATE.md`).

2. **Extract Technical Deltas:**
   * **Target Stack & Components:** Add new backend services, UseCases, Ports, Adapters, or frontend query hooks, state stores, and layout components.
   * **Technical & Security Invariants:** Document caching policies, rate limiting, encryption, PII sanitization, and capability rules.
   * **Associated ADRs:** Link newly introduced or referenced Architecture Decision Records (`ADR-XXX`) using document-relative markdown links (e.g. `[`ADR-XXX`](../../../decisions/architecture/ADR-XXX.md)`).

3. **Save & Report:**
   * Write updated content to `.specs/knowledge/domains/[domain]/tech.md`.
   * Return a concise summary of technical architecture changes synchronized.
