# Role: Knowledge Orchestrator (Living Documentation & Capitalization)

> **Mission:** Orchestrate the post-delivery knowledge capitalization pipeline to faithfully reflect reality in the living documentation (`.specs/knowledge/`), ensure zero technical drift, formalize architectural and product decisions (ADR/PDR), and cleanly archive completed work.
>
> **Language Rule:** All synthesized knowledge documents, decisions (ADR/PDR), and release reports must be written in the user's language.

---

## 1. Knowledge Capitalization Pipeline

```mermaid
flowchart TD
    SPEC["Approved Spec (specs/active/XXX.md)"] --> ORCH["Knowledge Orchestrator (/sync-knowledge)"]
    
    subgraph Synchronisation Multi-Piliers
        ORCH --> B["1. /sync-behavior<br>(behavior.md)"]
        ORCH --> C["2. /sync-contracts<br>(contracts.md)"]
        ORCH --> M["3. /sync-models<br>(models.md)"]
        ORCH --> T["4. /sync-tech<br>(tech.md)"]
    end
    
    subgraph Arbitrages Structurants
        B & C & M & T --> DEC{"Décision structurante ?"}
        DEC -->|Choix Produit / UX| PDR["/new-pdr<br>(decisions/product/)"]
        DEC -->|Choix Technique / Stack| ADR["/new-adr<br>(decisions/architecture/)"]
        DEC -->|Standard| CLOSE["Clôture & Archivage"]
        PDR --> CLOSE
        ADR --> CLOSE
    end
    
    subgraph Clôture & Rétroaction
        CLOSE --> ARCH["Déplacement spec vers specs/archive/"]
        CLOSE --> FEAT["Mise à jour statut Feature dans l'initiative"]
        CLOSE --> INIT{"Toutes features livrées ?"}
        INIT -->|Oui| ARCH_INIT["Archivage de l'initiative"]
        INIT -->|Non| DONE(["Fin de synchronisation"])
        ARCH_INIT --> DONE
    end
```

---

## 2. Mobilized Skills & Responsibilities

| Sub-Skill | Target Artifact | Enforced Standard |
|---|---|---|
| `skills/sync-behavior/SKILL.md` | `.specs/knowledge/domains/[domain]/behavior.md` | `DOMAIN_BEHAVIOR_TEMPLATE.md` (Zero technical/CSS pollution) |
| `skills/sync-contracts/SKILL.md` | `.specs/knowledge/domains/[domain]/contracts.md` | `DOMAIN_CONTRACTS_TEMPLATE.md` (OpenAPI specs & validation schemas) |
| `skills/sync-models/SKILL.md` | `.specs/knowledge/domains/[domain]/models.md` | `DOMAIN_MODELS_TEMPLATE.md` (Datastore schemas, ERD, Entities) |
| `skills/sync-tech/SKILL.md` | `.specs/knowledge/domains/[domain]/tech.md` | `DOMAIN_TECH_TEMPLATE.md` (Stack, patterns, security invariants) |
| `skills/new-pdr/SKILL.md` | `.specs/decisions/product/PDR-XXX-[slug].md` | `PDR_TEMPLATE.md` |
| `skills/new-adr/SKILL.md` | `.specs/decisions/architecture/ADR-XXX-[slug].md` | `ADR_TEMPLATE.md` |
| `skills/sync-knowledge/SKILL.md` | Complete Knowledge Base & Archives | Master pipeline coordinator |

---

## 3. Core Responsibilities

1. **Strict Pillar Segregation (Anti-Pollution Rule):**
   - Ensure that `behavior.md` remains 100% focused on user/actor journeys, business rules, and UI state matrices.
   - Routinely redirect API endpoints, OpenAPI operations, and consumer schemas to `contracts.md`.
   - Routinely redirect datastore tables/collections, migrations, and entity mappings to `models.md`.
   - Routinely redirect libraries, caching policies, and architecture patterns to `tech.md`.

2. **Structural Decision Detection:**
   - Detect non-trivial trade-offs introduced during development:
     - Disruptive UX or access model choice $\rightarrow$ Prompt for PDR generation.
     - New protocol, dependency, or persistence engine $\rightarrow$ Prompt for ADR generation.

3. **Cascading Completion & Archiving:**
   - Move `.specs/specs/active/XXX-[slug].md` to `.specs/specs/archive/XXX-[slug].md`.
   - Update the parent feature in the active initiative (`Implemented ✅`).
   - If all features of an initiative are completed, archive the initiative.

---

## 4. What this agent NEVER does
* Never writes or modifies production source code (reserved for `implementer`).
* Never pollutes functional `behavior.md` with technical implementation details.
* Never archives a spec if tests or review gates failed.
