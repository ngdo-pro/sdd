import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

export const VERSION = pkg.version;

export const HELP = `
  spec — Spec Framework CLI (${VERSION})

  Model-first pipeline: canonical artifacts live in .sdd/canonical/ (JSON
  metadata + markdown body, stateless layout — lifecycle lives in metadata).
  Every other output — markdown docs under .sdd/generated/, Linear issues —
  is a generated projection, and the CLI is their only writer.

  USAGE
    spec <command> [options]

  COMMANDS
    init                 Bootstrap .sdd/canonical/ + config (nothing else)
    migrate [--dry-run]  Rebuild .sdd/ from a legacy workspace (.specs/) —
                         strict gate, then the legacy root is retired
    import               Convert legacy .specs/**/*.md into the model
    upsert <kind>        Create/update an artifact (body via --from)
    move <ref>           Transition an artifact state (model + mirrors)
    done <ref>           Mark delivered, check off parents (--cascade)
    link <ref>           Set a parent relation in the model
    render [--check]     Regenerate .sdd/generated/ projections (CI drift
                         guard); preview the write plan with --dry-run
    model [--write]      Inspect the graph / regenerate index.json
    status [<ref>]       Model state, derived progress, remote mirrors
    list                 List artifacts (--kind, --state)
    sync [<ref>]         Reconcile remote mirrors (Linear) with the model
    backend <action>     list | enable <id> | disable <id>
    validate             Enforce spec-rules.md (paths, invariants, graph)

  OPTIONS
    --to <state>         Target state: planned | active | archived
    --kind <kind>        spec | feature | initiative | vision
    --slug <slug>        Artifact slug (upsert); specs use NNN-slug
    --title <title>      Title (upsert)
    --from <file|->      Body markdown source, "-" reads stdin (upsert)
    --field Key=Value    Extra metadata field (repeatable, upsert)
    --feature <ref>      Parent feature (link / upsert)
    --initiative <slug>  Parent initiative (link / upsert)
    --state <state>      Filter (list) or initial state (upsert)
    --cascade            Archive parents whose children are all complete
    --undo               Reopen an artifact (done)
    --create             Create missing remote artifacts (sync)
    --check              Report drift without writing (render)
    --write              Write index.json (model)
    --backend <id>       Restrict to a mirror (repeatable)
    --dry-run            Preview changes without writing
    --json               Machine-readable output
    --force              Overwrite existing material (init, import)
    --cwd <path>         Run against another workspace root
    -h, --help           Show this help
    -v, --version        Show the CLI version

  EXAMPLES
    spec init
    spec migrate --dry-run && spec migrate
    spec upsert spec --slug 042-login --title "Magic link login" --from draft.md
    spec link 042-login --feature auth-login
    spec move 042-login --to active
    spec done 042-login --cascade
    spec render --check
    spec import && spec model --write

  REFERENCES
    <ref> accepts an id (042), a slug (042-login / auth-login) or a path.
`;
