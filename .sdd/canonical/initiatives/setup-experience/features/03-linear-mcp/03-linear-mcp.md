## 1. Problem & Trigger

Le connecteur Linear actuel appelle l'API GraphQL en direct avec `LINEAR_API_KEY` — un secret que le framework ne doit pas détenir (ADR-002). Déclencheur : adoption du principe « transport délégué à l'environnement » ; le mirroring `sync`/`move` doit passer par le serveur MCP Linear déjà authentifié côté hôte, sans dégrader le déterminisme CI.

---

## 2. Wireframe / Visual Behavior

```text
$ sdd sync --connector linear
  · transport   MCP stdio: npx -y @linear/mcp-server (from settings.mcp)
  · resolve 042-login  → issue ENG-142 ✔
  · move 042-login → active   ENG-142: Backlog → In Progress ✔
  ✔ 3 artifact(s) mirrored — no API key involved

$ sdd sync            # sans settings.mcp résolu
  ✖ Connector "linear" has no MCP transport configured — run /setup
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** `sdd sync` / `sdd move` sur un connecteur linear dont les settings portent un transport MCP résolu (`settings.mcp: { command, args }` stdio ou `{ url }` HTTP).
2. **Interaction & Display:** le CLI (client MCP JSON-RPC, standard library) mappe ses opérations de miroir (`resolve`, `list`, `transition`, `create`, `link`) sur les tools du serveur MCP, affiche le plan et les résultats par artefact ; `--dry-run` inchangé.
3. **Validation & Persistence:** les `remoteRef` retournés sont persistés dans le modèle comme aujourd'hui (`artifact.remote.linear`) — seule la couche transport change, le contrat miroir est intact.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** le connecteur ne détient aucun secret — le bloc `authentication` (`LINEAR_API_KEY`, `settings.apiKey`) disparaît du manifest ; aucun fallback vers une auth directe, jamais.
* **INV-2:** sans `settings.mcp` résolu, le connecteur est inopérant : `sync`/`move` échouent avec un message renvoyant à `/sdd-setup`, et `sdd validate` (règle `connector-settings`) signale l'absence de transport requis.
* **INV-3:** le contrat miroir (`resolve`/`list`/`transition`/`create`/`link`, `remoteRef`, `--dry-run`, mirrors activés) est inchangé — les call-sites (`sync.js`, `move.js`, `done.js`) ne perçoivent pas la migration.
* **INV-4:** le client MCP est un process par invocation (spawn stdio / requête HTTP), démarré et arrêté proprement — pas de serveur résident, pas de dépendance npm nouvelle (JSON-RPC sur standard library).

---

## 5. Out of Scope

* Le connecteur GitHub (transport `gh` CLI) — future feature, seul le principe ADR-002 est posé.
* La découverte des serveurs MCP par le CLI — c'est le rôle de l'agent `/sdd-setup` (feature `02-setup-skill`) qui écrit `settings.mcp` via les flags.
* La validation sémantique (teamKey, labels) — reste agent-side via MCP.
