# Feature: Durcissement surface connecteurs

> **Parent Initiative:** `connector-ecosystem`  
> **Status:** Archived  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-14  

---

## 1. Problem & Trigger

Trois défauts relevés lors des revues des specs 004-006 : grammaire de settings divergente entre `init` et `connectors enable` (les subkeys namespacées sont rejetées), `--dry-run` ignoré par `connectors enable` (écriture immédiate, contournement documenté dans le skill `/setup`), et `sync`/`move` exit 0 même quand tous les miroirs échouent — invisible en CI. Déclencheur : durcissement post-livraison, avant l'arrivée de nouveaux connecteurs.

---

## 2. Wireframe / Visual Behavior

```text
$ sdd connectors enable linear --linear.mcp.command=npx --linear.mcp.args=-y --dry-run
  · connector linear   would enable (settings: mcp.command=npx, mcp.args=[-y])
  (dry-run: nothing was written)

$ sdd sync --connector linear          # serveur MCP injoignable, seul miroir activé
  ⚠ linear: ConnectorError — connection refused
  ✖ all enabled mirrors failed (1/1) — run `sdd validate` for structural checks
  exit 1

$ sdd connectors enable linear         # sans transport résolu
  · hint: run /setup — it discovers the MCP transport in your host config
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd connectors enable|disable <id>` avec flags settings (top-level non-namespacés rattachés au `<id>`, namespacés `--<id>.key[.subkey]` acceptés), et/ou `--dry-run`.
2. **Interaction & Display:** le plan est affiché (dry-run s'arrête là), le hint éventuel provient du champ dédié du manifest, l'application suit la mécanique de merge existante.
3. **Validation & Persistence:** `sync`/`move` agrègent les résultats miroir : échec de **tous** les miroirs activés ⇒ exit 1 avec synthèse ; échec partiel ⇒ exit 0 + warnings (isolation par artefact préservée).

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** `connectors enable|disable` accepte exactement la grammaire de settings de `sdd init` (subkeys namespacées == id positionnel, profondeur ≤ 2, flags répétés → tableau, coercion typée) et supporte `--dry-run` (aucun octet écrit) — le contournement documenté dans `/setup` devient inutile.
* **INV-2:** `sync`/`move` exitent 1 si et seulement si au moins un miroir est activé et que **tous** échouent ; partiel ⇒ exit 0 ; zéro miroir activé ⇒ comportement actuel (warning, exit 0).
* **INV-3:** plus aucun id de connecteur n'apparaît dans `src/**` — le hint « connecteur non configuré » est lu depuis un champ optionnel du manifest (`extension.json`) ; `sdd validate` reste inchangé.
* **INV-4:** la mécanique de merge (idempotence, explicit-wins) est inchangée — la grammaire étendue passe par les mêmes helpers que `sdd init`.

---

## 5. Out of Scope

* Connecteur GitHub via `gh` — reporté, seule l'initiative est créée pour tracer la direction (ADR-002).
* Changement du contrat `settings.mcp`, du secret-scan ou de `requiredSettings` (livrés en 005).
* Nouvelle sémantique d'exit pour `sdd validate` (déjà exit 1 sur finding).

---

## 6. Implementation Spec(s)

- [x] **`007-connector-hardening`** : Durcissement surface connecteurs  
  ↳ *Spec:* [`generated/initiatives/connector-ecosystem/specs/007.md`](../specs/007.md)
