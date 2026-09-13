import { findPortablePathViolations, uncoveredInvariants } from '../../core/rules.js';
import { heading, info, printJson, success, warn } from '../render.js';
import { loadContext } from '../context.js';

/**
 * `spec validate` — enforces spec-rules.md against the canonical model:
 * portable paths (rule 1), invariant traceability (rule 3) and graph integrity.
 */
export async function validate({ cwd, flags }) {
  const { artifacts } = await loadContext(cwd);
  const slugs = new Set(artifacts.map((artifact) => artifact.slug));
  const findings = [];

  for (const artifact of artifacts) {
    const label = `${artifact.kind} ${artifact.slug}`;

    for (const violation of findPortablePathViolations(artifact.body ?? '')) {
      findings.push({ artifact: label, rule: 'portable-paths', detail: violation });
    }

    if (artifact.kind === 'spec') {
      for (const invariant of uncoveredInvariants(artifact.body ?? '')) {
        findings.push({
          artifact: label,
          rule: 'invariant-traceability',
          detail: `${invariant} has no "Covered by" mapping`,
        });
      }
      if (!artifact.relations?.feature) {
        findings.push({ artifact: label, rule: 'graph-integrity', detail: 'no parent feature linked (run `spec link`)' });
      }
    }

    if (artifact.kind === 'feature' && !artifact.relations?.initiative) {
      findings.push({ artifact: label, rule: 'graph-integrity', detail: 'no parent initiative linked' });
    }

    for (const [relation, target] of Object.entries(artifact.relations ?? {})) {
      if (target && !slugs.has(target)) {
        findings.push({ artifact: label, rule: 'graph-integrity', detail: `dangling ${relation} → "${target}"` });
      }
    }
  }

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
