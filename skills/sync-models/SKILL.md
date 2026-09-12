---
name: sync-models
description: Synchronize domain aggregates, SQL database schemas, and ERD diagrams from a delivered specification into .specs/knowledge/domains/[domain]/models.md.
---

# Skill: sync-models

Use this skill to update the living data models and database schema documentation of a domain (`/sync-models [id]`), following `DOMAIN_MODELS_TEMPLATE.md`.

---

## Procedure

1. **Load Inputs:**
   * Read the delivered specification `.specs/specs/active/[id]*.md` and identify its target domain (`[domain]`).
   * Read `.specs/knowledge/domains/[domain]/models.md` (or initialize from `templates/DOMAIN_MODELS_TEMPLATE.md`).

2. **Extract Data Model Deltas:**
   * **Core Domain Models:** Document Aggregates, Root Entities, UUIDv7 identifiers, and Value Objects.
   * **Active Database Schema:** Document tables, columns, SQL types, nullability, constraints (PK, FK, unique), and indexes.
   * **Persistence Bindings:** Note initial migration filenames, DBAL repositories, and custom DBAL types.
   * **ERD Diagram:** Update Mermaid `erDiagram` with new entities or relationships.

3. **Save & Report:**
   * Write updated content to `.specs/knowledge/domains/[domain]/models.md`.
   * Return a concise summary of models and database tables synchronized.
