# Feature: Racine .sdd et migration idempotente

> **Parent Initiative:** `layout-v3`  
> **Status:** Planned  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-13  

---

## 1. Problem & Trigger

La racine des workspaces est `.specs/`, désalignée du nom du framework (sdd-framework), et aucun chemin de migration n'existe pour convertir les workspaces v2 vers le layout v3 sans perte.

## 2. Wireframe / Visual Behavior

```text
spec migrate [--dry-run]
.specs/ (v2)  ──▶  .sdd/ (v3)     graphe préservé, .specs/ retiré après succès strict
```

Livraison : 3ᵉ de l'initiative (après 01 et 02) ; accepte tout layout antérieur identifiable (v2 pur, canonique v3 sous `.specs/`, `generated/` absent…), détecté via `config.json` et `index.json`.

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** l'utilisateur lance `spec migrate` sur un repo contenant un workspace antérieur.
2. **Interaction & Display:** avec `--dry-run`, la commande liste le plan de conversion sans écrire ; sans flag, elle reconstruit `.sdd/` intégralement depuis la source, puis régénère projections et index.
3. **Validation & Persistence:** `spec validate` (exit 0) **et** `spec render --check` (exit 0) sur le workspace migré ; un second `spec migrate` est un no-op.

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** la migration est idempotente par construction — elle **reconstruit toujours `.sdd/` intégralement** depuis la source, jamais de merge ; un `.sdd/` partiel est traité comme une migration interrompue et repris de zéro.
* **INV-2:** chaque destination est dérivée de l'état déclaré dans les métadonnées (`state`, `relations`), jamais de la position disque ; les divergences disque ↔ métadonnée sont listées dans le plan `--dry-run`.
* **INV-3:** ids, slugs, relations, `progress` et `remote` refs sont préservés ; `config.json` est converti au schéma v3 (options obsolètes retirées avec avertissement) ; les tokens de racine connus (`.specs/` → `.sdd/`) dans les corps et fields sont réécrits mécaniquement, chaque réécriture listée dans le plan.
* **INV-4:** le succès est strict : `spec validate` exit 0 **et** `spec render --check` exit 0 sur le workspace migré — sinon `.sdd/` est marqué en échec, `.specs/` est conservé et l'erreur remontée ; le rollback hors git est explicitement Out-of-Scope.
* **INV-5:** si `.specs/` et `.sdd/` coexistent après tentative, toute mutation du CLI est refusée (exit 1) avec l'instruction de relancer `spec migrate` ; en lecture, le CLI opère sur `.sdd/` uniquement.
* **INV-6:** `--dry-run` supporté sur toutes les écritures de la migration.

## 5. Out of Scope

* L'import de markdown legacy (déjà couvert par `spec import`).
* Le mirroring Linear et les backends distants.
* La conservation opt-in de `.specs/` après succès.

---

## 6. Implementation Spec(s)

*No execution specs linked yet.*
