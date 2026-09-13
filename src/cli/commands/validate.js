import { loadModel } from '../../model/store.js';
import { computeFindings } from '../../model/audit.js';
import { loadConfig } from '../../core/config.js';
import { findManifest } from '../../connectors/registry.js';
import { heading, info, printJson, success, warn } from '../render.js';

/** Structural match between a settings value and its manifest-declared type. */
function matchesType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

/**
 * Rule `connector-settings` (INV-5): an enabled connector must carry every
 * `requiredSettings` entry of its manifest (present and non-empty) and every
 * declared `settingTypes` entry must be structurally valid. Connectors
 * without a manifest are unchecked (third-party, retrocompatible).
 */
async function connectorSettingsFindings(cwd) {
  const config = await loadConfig(cwd);
  const findings = [];
  for (const connector of config.connectors) {
    if (!connector.enabled) continue;
    const manifest = await findManifest(cwd, connector.id);
    if (!manifest) continue;

    const settings = connector.settings ?? {};
    const required = manifest.requiredSettings ?? [];
    for (const key of required) {
      const value = settings[key];
      if (value === undefined || value === null || value === '') {
        findings.push({
          artifact: `connector ${connector.id}`,
          rule: 'connector-settings',
          detail: `required setting "${key}" is missing or empty (requiredSettings: ${JSON.stringify(required)})`,
        });
      }
    }
    for (const [key, type] of Object.entries(manifest.settingTypes ?? {})) {
      const value = settings[key];
      if (value === undefined || value === null) continue;
      if (!matchesType(value, type)) {
        findings.push({
          artifact: `connector ${connector.id}`,
          rule: 'connector-settings',
          detail: `settings.${key} must be ${type} (got ${Array.isArray(value) ? 'array' : typeof value})`,
        });
      }
    }
  }
  return findings;
}

/**
 * `sdd validate` — enforces spec-rules.md against the canonical model, plus
 * the structural `connector-settings` rule over `.sdd/config.json`.
 * The findings engine lives in `src/model/audit.js` (pure reader) so the
 * strict gate of `sdd migrate` reuses the exact same model rules; the config
 * rule is local to this command (audit.js stays config-free).
 */
export async function validate({ cwd, flags }) {
  const findings = [
    ...await computeFindings(cwd),
    ...await connectorSettingsFindings(cwd),
  ];
  const artifacts = await loadModel(cwd);

  if (flags.json) {
    printJson({ artifacts: artifacts.length, findings });
    if (findings.length > 0) process.exitCode = 1;
    return;
  }

  heading(`Validating ${artifacts.length} artifact(s)`);
  if (findings.length === 0) {
    success('Model complies with spec-rules.md.');
    return;
  }

  for (const finding of findings) {
    warn(`[${finding.rule}] ${finding.artifact}: ${finding.detail}`);
  }
  info(`${findings.length} finding(s) detected.`);
  process.exitCode = 1;
}
