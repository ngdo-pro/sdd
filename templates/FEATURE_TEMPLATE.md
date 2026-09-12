# Feature: [Feature Name]

> **Parent Initiative:** `[initiative-slug]`  
> **Status:** Planned | Active | Archived (Default: Planned)  
> **Author(s):** [Name]  
> **Last Updated:** [YYYY-MM-DD]

---

## 1. Problem & Trigger

[In 2 sentences: what specific user need or technical bottleneck does this feature solve? How does the user or system trigger this interaction?]

---

## 2. Wireframe / Visual Behavior

```text
[Precise ASCII diagram of the component, popover, canvas node, or modified view]
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** The user performs [action, click, keyboard shortcut]...
2. **Interaction & Display:** The interface immediately displays [visual feedback, transient state]...
3. **Validation & Persistence:** The outcome is confirmed via [Enter, click outside] and persisted to [format/state].

---

## 4. Functional Invariants (Non-Negotiable Rules)

*These rules will be translated directly into tests and assertions in the engineering Spec:*

* **INV-1:** [Nominal integrity rule 1]
* **INV-2:** [Nominal integrity rule 2]
* **INV-3:** [Expected system behavior for edge cases or invalid inputs]

---

## 5. Out of Scope

*To guarantee rapid and targeted delivery, what is explicitly excluded from this feature:*

* [Excluded item 1 - e.g., no touch/mobile support for this milestone]
* [Excluded item 2 - e.g., no custom color picker]

---

## 6. Implementation Spec(s)

*Choose/adapt based on lifecycle state:*

**State 1 (When initially framed — no specs derived yet):**
*No execution specs linked yet.*

**State 2 (When specs are derived via `/spec` — replace State 1 with spec deltas):**
- [ ] **`[XXX-[slug]]`** : [Spec Title]  
  ↳ *Spec:* [`../../../specs/planned/XXX-[slug].md`](../../../specs/planned/XXX-[slug].md) *(or `active/` once `/build-spec` starts)*
