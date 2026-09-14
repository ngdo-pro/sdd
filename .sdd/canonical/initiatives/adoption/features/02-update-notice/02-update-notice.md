## 1. Problem & Trigger

npm ne notifie personne : un utilisateur qui a fait `npm i -g shodo` reste figé sur sa version, et le cache npx ré-utilise une version potentiellement vieille. Le framework doit signaler lui-même la disponibilité d'une nouvelle version — sans jamais bloquer ni parler au réseau par surprise. Déclencheur : toute invocation `sdd` (notice discrète), et `sdd install` (mention explicite).

---

## 2. Wireframe / Visual Behavior

```text
$ sdd status
  ...sortie normale...
  
  · update available: v2.1.0 (installed: v2.0.0) — npm i -g shodo   ← 1 ligne, stderr, max 1×/24h

$ sdd status --no-update-check      # opt-out per-call
$ SDD_NO_UPDATE_CHECK=1 sdd status  # opt-out env (CI)
```

---

## 3. Nominal User Flow (*Happy Path*)

1. **Trigger:** après l'exécution d'une commande `sdd` (jamais avant — la notice ne doit pas précéder ni retarder la sortie utile).
2. **Interaction & Display:** cache 24 h (`.sdd/.update-check.json` : lastCheck + latest), fetch best-effort du registre (timeout 1,5 s), comparaison semver ; si plus récente → 1 ligne sur **stderr**.
3. **Validation & Persistence:** tout échec (offline, timeout, parse) est silencieux ; le cache est mis à jour même en cas d'égalité de version.

---

## 4. Functional Invariants (Non-Negotiable Rules)

* **INV-1:** la notice n'apparaît qu'après la commande, sur stderr, max une fois par 24 h (cache) — jamais avant la sortie utile, jamais en doublon dans une même session.
* **INV-2:** best-effort strict : timeout 1,5 s, tout échec réseau/parse est silencieux — la commande ne doit jamais échouer ni ralentir perceptiblement à cause du check.
* **INV-3:** opt-outs : `--no-update-check` (flag global) et `SDD_NO_UPDATE_CHECK=1` (env) ; le check est désactivé par défaut en CI (`CI=true` ou non-TTY… non : même en CI, exit codes et scripts diffèrent, le check passe, seuls les opt-outs coupent).
* **INV-4:** le cache vit hors du graphe (`.sdd/.update-check.json`, pattern dotfile toléré par root-layout) ; absent de `.sdd/` (install non fait) ⇒ check mémoire par session seulement.
* **INV-5:** la version distante vient du registre npm (`https://registry.npmjs.org/shodo/latest`, fetch stdlib) — jamais d'endpoint maison.

---

## 5. Out of Scope

* Auto-update (jamais — npm gère l'installation) ; telemetry ; check de schema du modèle (rôle de `sdd migrate`).
