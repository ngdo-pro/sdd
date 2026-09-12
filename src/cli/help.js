import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

export const VERSION = pkg.version;

export const HELP = `
  spec — Spec Framework CLI (${VERSION})

  Deterministic mechanics for the Spec-Driven Development pipeline.
  By default every movement is applied to the local filesystem; when remote
  backends (Linear, …) are enabled, the same movement is mirrored onto them.

  USAGE
    spec <command> [options]

  COMMANDS
    init                 Bootstrap the .specs/ layout and config.json
    move <ref>           Transition an artifact between lifecycle states
    status [<ref>]       Show local state and remote mirrors
    list                 List artifacts (--kind, --state)
    link <ref>           Register an artifact in its parent document
    sync [<ref>]         Reconcile local artifacts with remote backends
    backend <action>     list | enable <id> | disable <id>
    validate             Check spec-rules.md integrity (paths, invariants)

  OPTIONS
    --to <state>         Target state: planned | active | archived
    --kind <kind>        Filter by artifact kind: spec | initiative | feature | vision
    --state <state>      Filter by lifecycle state
    --backend <id>       Restrict to a backend (repeatable)
    --feature <ref>      Parent feature (for \`link <spec-ref>\`)
    --initiative <ref>   Parent initiative (for \`link <feature-ref>\`)
    --create             Create missing remote artifacts during \`sync\`
    --dry-run            Preview changes without writing anything
    --json               Machine-readable output
    --force              Overwrite existing files (init)
    --cwd <path>         Run against another workspace root
    -h, --help           Show this help
    -v, --version        Show the CLI version

  EXAMPLES
    spec init
    spec move 042 --to active
    spec move auth-login --kind feature --to archived
    spec link 042 --feature auth-login
    spec sync --create --backend linear
    spec status 042

  REFERENCES
    <ref> accepts a spec ID (042), a slug (042-auth / auth-login) or a path.
`;
