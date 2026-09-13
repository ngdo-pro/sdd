# ADR-001: Adopter `@clack/prompts` comme première dépendance runtime

* **Status:** Accepted
* **Date:** 2026-09-13
* **Impact:** `Infrastructure`
* **Domain:** `spec-model` (feature `01-declarative-init`, spec 004)

---

## 1. Context & Problem Statement

L'init déclarative (`sdd init --interactive`) exige une interview TTY (multi-select de connecteurs, prompts typés par feuille de settings avec défauts pré-remplis). Écrire cette UX à la main sur `node:readline` signifie réimplémenter multi-select, curseur, annulation et rendu — coût élevé pour une qualité moindre. Le framework reposait jusque-là sur un principe « zero-dependency » (aucune dépendance npm au runtime) ; l'ajout d'une bibliothèque de prompts le rompt pour la première fois. Contrainte supplémentaire : chaque invocation du CLI (scripts CI, agents) doit rester légère — la dépendance ne doit pas peser sur les chemins non interactifs.

## 2. Considered Options

* **Option A — Prompts maison sur `node:readline` :** zéro dépendance conservée, mais réécriture et maintenance d'un multi-select + prompts typés + gestion d'annulation ; coût de test élevé (lectures stdin), UX inférieure.
* **Option B — `@clack/prompts` ^0.11.0 en import dynamique :** UX complète et éprouvée (multi-select, text, confirm, `isCancel`), petit empreinte (déps transitives : `@clack/core` 0.5.0, `picocolors` ^1.0.0, `sisteransi` ^1.0.5 — aucune ne déclare de contrainte `engines`), natif ESM (`type: module`), compatible avec le plancher du framework (Node ≥ 18.17, `package.json` `engines`) ; l'import dynamique le confine au chemin interactif.
* **Option C — `enquirer` / `inquirer` :** couverture fonctionnelle comparable mais empreinte plus lourde et historique CommonJS/compatibilité relative avec Node ESM pur — moins aligné avec un CLI ESM sans transpilation.

## 3. Decision Outcome

Option B : adopter **`@clack/prompts` ^0.11.0** comme **première dépendance runtime** (seule entrée `dependencies`, `package.json`). Trois garde-fous accompagnent l'adoption :

1. **Import dynamique uniquement** (`await import('@clack/prompts')` dans `src/cli/interactive.js`) — jamais au niveau module : les invocations non interactives (et les tests non-TTY) ne chargent jamais la dépendance, et un module absent échoue proprement sur le seul chemin `--interactive`.
2. **Prompter injectable** : `runInteractive({ catalog, prompter })` reçoit une interface `multiselect`/`text`/`confirm` — les tests injectent un prompteur factice et ne touchent jamais stdin.
3. **Portée confinée** : la dépendance ne sert que l'interview TTY ; toute la logique de merge/coercion/validation reste standard library.

## 4. Rationale & Consequences

* Le claim « zero-dependency » du README est **retiré** ; il devient « une seule dépendance runtime, chargée à la demande » (README, section `bin/` + `src/`). Le principe sous-jacent — un CLI léger, sans transpilation, auditable — est préservé : une dépendance ESM pure, bornée au chemin interactif.
* Impact maintenance : la surface consommée est mince (`multiselect`, `text`, `confirm`, `isCancel`) et isolée derrière le prompter injectable — un remplacement futur de bibliothèque ne toucherait que `clackPrompter()`.
* Dette acceptée : le suivi de mise à jour de `@clack/prompts` (pinné `^0.11.0`) devient un degré de liberté de plus ; le pin garantit la compatibilité avec le plancher Node ≥ 18.17 du framework.
* Alternative de repli : en l'absence de TTY, l'interview est refusée (`UsageError` invitant aux flags déclaratifs) — la dépendance n'est jamais un prérequis du CLI.
