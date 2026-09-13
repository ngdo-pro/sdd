import { loadModel } from '../../model/store.js';
import { computeFindings } from '../../model/audit.js';
import { heading, info, printJson, success, warn } from '../render.js';

/**
 * `spec validate` — enforces spec-rules.md against the canonical model.
 * The findings engine lives in `src/model/audit.js` (pure reader) so the
 * strict gate of `spec migrate` reuses the exact same rules.
 */
export async function validate({ cwd, flags }) {
  const findings = await computeFindings(cwd);
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