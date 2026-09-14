# ADR-002: Transport des connecteurs délégué à l'environnement — zéro clé API dans le framework

* **Status:** Accepted — **implémentée par la spec `005-linear-mcp`** (feature `03-linear-mcp` ; résolution du transport par le skill `/sdd-setup`, spec `006-setup-skill`)
* **Date:** 2026-09-13
* **Impact:** `Architecture`
* **Domain:** `spec-model` (initiative `setup-experience`, feature `03-linear-mcp`)

---

## 1. Context & Problem Statement

Le connecteur miroir Linear actuel (`src/connectors/linear.js`) appelle l'API GraphQL de Linear en direct avec une clé d'API (`LINEAR_API_KEY` via env ou `settings.apiKey`). Ce modèle impose à chaque adoptant de créer, distribuer et faire vivre un token Linear — un secret de plus dans l'environnement, exposé au CLI, aux scripts et aux logs. Par ailleurs, l'écosystème fournit des transports déjà authentifiés : serveurs **MCP** (Model Context Protocol) pour Linear, CLI **`gh`** pour GitHub. La question : où vit l'authentification des connecteurs, et qui parle aux services distants ?

## 2. Considered Options

* **Option A — Statu quo (clé API dans le framework) :** transport direct, simple à tester, mais le framework détient et manipule des secrets ; chaque connecteur réimplémente client + auth ; contradiction avec le futur skill `/sdd-setup` qui valide via MCP.
* **Option B — Mirroring agent-driven :** le CLI produit un plan (`sync --dry-run`), les agents exécutent les mutations via MCP ; mais `sdd sync` perd son déterminisme et son usage CI autonome (un cron devrait invoquer un agent).
* **Option C — Transport délégué à l'environnement :** chaque connecteur dialogue avec un transport **déjà authentifié par l'environnement** — serveur MCP Linear (l'auth vit dans la config MCP de l'hôte) pour Linear, CLI `gh` (auth `gh auth`) pour GitHub. Le framework ne détient **aucune clé API**, jamais.

## 3. Decision Outcome

Option C, avec un principe unique et deux matérialisations :

1. **Principe — zéro secret dans le framework :** aucune clé API, aucun token, dans aucun setting, env var ou fichier du framework. L'authentification est la responsabilité exclusive du transport d'environnement choisi par l'adoptant.
2. **Linear — via MCP :** le connecteur Linear devient client MCP (JSON-RPC stdio/HTTP vers le serveur Linear MCP). Le transport résolu (`{ command, args }` ou `{ url }`) vit dans les **settings du connecteur** (`.sdd/config.json`) — découvert et écrit par l'agent de setup (`/sdd-setup` inspecte les configs MCP de l'hôte), jamais par l'utilisateur à la main. `sync`/`move` restent déterministes et CI-friendly.
3. **GitHub — via `gh` CLI :** le futur connecteur GitHub shelle `gh` (auth gérée par `gh auth`). Même principe, transport différent — les connecteurs sont hétérogènes dans le transport, uniformes dans le contrat.

Le bloc `authentication` du manifest Linear (`LINEAR_API_KEY` / `settings.apiKey`) et le transport GraphQL direct sont **supprimés** (clean break, sans période mixte).

## 4. Rationale & Consequences

* **Sécurité :** la surface de secrets du framework tombe à zéro ; la révrotation des tokens Linear/GitHub se fait dans l'environnement (config MCP, `gh auth`), sans toucher au `.sdd/`.
* **Déterminisme préservé :** contrairement à l'option B, `sdd sync`/`sdd move` restent des invocations binaires reproductibles en CI — le CLI est client MCP, pas orchestrateur d'agents.
* **Coût :** le CLI implémente un petit client JSON-RPC (stdio/HTTP) — standard library suffisante, pas de dépendance nouvelle (ADR-001 reste la seule dép runtime). La couverture de tests passe par des serveurs MCP factices (stdio factice).
* **Repli explicite :** sans transport MCP résolu dans les settings, le connecteur est inopérant — `sdd validate` le signale (`connector-settings`), `sync` échoue avec un message invitant à `/sdd-setup` ; jamais de fallback implicite vers une auth directe.
* **Frontière :** la validation sémantique (teamKey, labels, repo) reste agent-side via MCP (feature `02-setup-skill`) ; le CLI n'utilise le MCP que pour ses opérations de miroir (resolve/list/transition/create/link).
