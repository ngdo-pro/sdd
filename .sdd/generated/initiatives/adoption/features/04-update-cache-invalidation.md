# Feature: Invalidation du cache update-check au changement de version

> **Parent Initiative:** `adoption`  
> **Status:** Archived  
> **Author(s):** TBD  
> **Last Updated:** 2026-09-14  

---

## 1. Problem & Trigger

Le cache 24 h du check-update peut contenir `latest: null` (check effectué pendant qu'une version n'était pas encore répliquée sur le registre, ou offline). Constaté en production : après publication puis upgrade du binaire, la notice reste absente jusqu'à expiration du cache — un `latest: null` ou une valeur périmée survit à un changement de version installée. Déclencheur : `checkUpdate` lit un cache frais sans vérifier que la version installée n'a pas changé depuis.

---

## 2. Wireframe / Visual Behavior

```text
$ sdd list                     # cache: { lastCheck: -24h, latest: null, installedVersion: "2.0.1" }
  ...sortie...                 # ← cache ignoré: installedVersion ≠ version courante
· update available: v2.0.2 (installed: v2.0.2) — npm i -g @ngdo-pro/sdd
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `checkUpdate` lit un cache (mémoire ou dotfile) dont `lastCheck < 24h`.
2. **Interaction & Display:** le cache embarque désormais `installedVersion` ; si elle diffère de la version courante du binaire, le cache est invalidé (check frais, refetch) — sinon comportement inchangé.
3. **Validation & Persistence:** chaque écriture de cache (succès, échec, égalité) enregistre la version installée du moment ; les caches legacy sans `installedVersion` sont traités comme invalidés (check frais, rétrocompatible).

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** un cache (mémoire ou dotfile) dont `installedVersion` diffère de la version du binaire en cours est invalidé — un upgrade déclenche toujours un check frais, même si `lastCheck < 24h`.
* **INV-2:** les caches sans `installedVersion` (formé avant cette spec) sont invalidés — jamais de notice bloquée par un cache legacy.
* **INV-3:** le schéma du cache reste additif (`{ lastCheck, latest, installedVersion }`) — le dotfile `.update-check.json` garde sa tolérance root-layout et son API `{ notice, cached }`.

---

## 6. Implementation Spec(s)

- [x] **`011-update-cache-invalidation`** : Invalidation du cache update-check au changement de version  
  ↳ *Spec:* [`generated/initiatives/adoption/specs/011.md`](../specs/011.md)
