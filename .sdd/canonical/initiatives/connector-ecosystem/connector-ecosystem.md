## 1. Intent & The Gap

* **Today:** La couche connecteurs livrée avec la spec 005 fonctionne mais porte trois scories relevées en revue : `sdd connectors enable` refuse les subkeys namespacées (`--linear.mcp.command`) là où `sdd init` les accepte, ignore `--dry-run`, et `sync`/`move` ressortent exit 0 même quand tous les miroirs échouent (le seul signal bloquant est `sdd validate`). Le hint « run /setup » est en plus codé en dur pour `linear` dans `connectors.js`, en contradiction avec le principe manifest-driven (INV-1 de la spec 004).
* **Tomorrow:** Une surface connecteurs homogène : la grammaire de settings est identique sur `init` et `connectors enable/disable` (subkeys namespacées, `--dry-run`), l'échec total de miroir est signalé par l'exit code (CI-friendly), et plus aucune connaissance spécifique à un connecteur ne vit dans `src/` — le hint vient du manifest.

---

## 2. Target System Architecture & Interface Diagram

```text
sdd connectors enable linear --linear.mcp.command=npx --linear.mcp.args=-y --dry-run
     │
     ├─ grammaire settings identique à sdd init (namespacé == id positionnel, depth ≤ 2)
     ├─ --dry-run : plan affiché, rien d'écrit
     └─ hint de reprise lu depuis extension.json (manifest) — plus de 'linear' codé en dur

sdd sync / sdd move  →  résultats de miroir par artefact (inchangés)
     └─ tous les miroirs activés en échec → exit 1 ; partiel → exit 0 + warnings
```

---

## 3. Strategic Invariants & Guardrails

* **Zéro connaissance de connecteur dans le code :** le hint (et tout message spécifique) vient du manifest ; `src/` ne mentionne aucun id de connecteur.
* **Exit honnête :** l'exit code reflète l'issue réelle du mirroring (total failed ⇒ 1) sans casser l'isolation par artefact livrée en 005.
* **Parité de grammaire :** `init` et `connectors enable/disable` partagent la même résolution de settings (helpers du registre), testée aux deux endroits.
