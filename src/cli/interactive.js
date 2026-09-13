import { UsageError } from '../core/errors.js';
import { coerceSetting } from '../connectors/registry.js';

/**
 * Builds the default prompter on demand: `@clack/prompts` is dynamically
 * imported ONLY on the interactive path (never at module level), and cancel
 * gestures are mapped to a typed error. Tests inject their own prompter and
 * never touch stdin.
 */
async function clackPrompter() {
  const clack = await import('@clack/prompts');
  const unwrap = (value) => {
    if (clack.isCancel(value)) throw new UsageError('Interactive setup cancelled.');
    return value;
  };
  return {
    async multiselect({ message, options }) {
      return unwrap(await clack.multiselect({ message, options, required: false }));
    },
    async text({ message, initialValue }) {
      return unwrap(await clack.text({ message, initialValue }));
    },
    async confirm({ message, initialValue }) {
      return unwrap(await clack.confirm({ message, initialValue }));
    },
  };
}

/** Prompts one typed settings leaf, pre-filled with its manifest default. */
async function promptLeaf(prompter, id, settingPath, type, initial) {
  if (type === 'boolean') {
    return prompter.confirm({ message: `${id}.${settingPath}`, initialValue: initial === true });
  }
  const raw = await prompter.text({
    message: `${id}.${settingPath}`,
    initialValue: initial === null || initial === undefined ? '' : String(initial),
  });
  return coerceSetting(id, settingPath, raw, type);
}

/**
 * TTY interview (INV-4): prompts happen only behind an explicit
 * `--interactive` AND a TTY stdout — otherwise a UsageError inviting to the
 * explicit flags, with nothing written and no prompt at all.
 *
 * `catalog` is the resolved manifest list (`listManifests`); the intrinsic
 * local connector is never offered. Every prompted value is user-confirmed,
 * so all leaves are marked `explicit` for the idempotent merge.
 *
 * @returns {Promise<{ connectors: Array<{ id, type, settings, explicit, enabled: true }> }>}
 */
export async function runInteractive({ catalog = [], prompter }) {
  if (!process.stdout.isTTY) {
    throw new UsageError(
      'Interactive mode requires a TTY (stdout is not a terminal). '
      + 'Use explicit flags instead, e.g. `sdd init --connector linear --linear.teamKey=ENG`.',
    );
  }

  const selectable = catalog.filter((manifest) => manifest.id !== 'local' && manifest.kind !== 'local');
  if (selectable.length === 0) return { connectors: [] };

  const active = prompter ?? await clackPrompter();

  const selected = await active.multiselect({
    message: 'Connectors to declare (the local model is intrinsic):',
    options: selectable.map((manifest) => ({
      value: manifest.id,
      label: manifest.name ? `${manifest.id} — ${manifest.name}` : manifest.id,
      hint: manifest.description,
    })),
  });

  const connectors = [];
  for (const id of selected) {
    const manifest = selectable.find((candidate) => candidate.id === id);
    const settingTypes = manifest.settingTypes ?? {};
    const settings = {};
    const explicit = [];
    for (const [key, initial] of Object.entries(manifest.settings ?? {})) {
      const type = settingTypes[key] ?? 'string';
      if (type === 'object') {
        settings[key] = {};
        for (const [subkey, subInitial] of Object.entries(initial ?? {})) {
          settings[key][subkey] = await promptLeaf(active, id, `${key}.${subkey}`, 'string', subInitial);
          explicit.push(`${key}.${subkey}`);
        }
        continue;
      }
      settings[key] = await promptLeaf(active, id, key, type, initial);
      explicit.push(key);
    }
    connectors.push({ id, type: manifest.type ?? id, settings, explicit, enabled: true });
  }
  return { connectors };
}
