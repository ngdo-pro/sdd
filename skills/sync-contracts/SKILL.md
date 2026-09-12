---
name: sync-contracts
description: Synchronize API contracts, endpoints, and validation schemas from a delivered specification into .specs/knowledge/domains/[domain]/contracts.md.
---

# Skill: sync-contracts

Use this skill to update the living API contracts documentation of a domain (`/sync-contracts [id]`), following the strict structure of `DOMAIN_CONTRACTS_TEMPLATE.md`.

---

## Procedure

1. **Load Inputs:**
   * Read the delivered specification `.specs/specs/active/[id]*.md` and identify its target domain (`[domain]`).
   * Read `.specs/knowledge/domains/[domain]/contracts.md` (or initialize from `templates/DOMAIN_CONTRACTS_TEMPLATE.md`).

2. **Extract Interface Deltas:**
   * **Formal OpenAPI Spec (`openapi.yaml`):** Add or update route definitions (`[METHOD] /...`), operationIds, parameters, request body schemas, response payloads, and HTTP error statuses according to OpenAPI 3.1.
   * **Endpoint Mapping Table:** Update the summary table in `contracts.md` with new routes and links to `openapi.yaml`.
   * **Consumer Validation Models:** Document client-side or consumer validation schemas in the project's consumer language (e.g. Zod, Pydantic, JSON Schema, protobuf, or typed structs).

3. **Save & Report:**
   * Write updated content to `.specs/knowledge/domains/[domain]/contracts.md`.
   * Return a concise summary of endpoints and schemas synchronized.
