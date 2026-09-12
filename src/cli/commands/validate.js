import path from 'node:path';
import fsp from 'node:fs/promises';
import { listSpecs } from '../../core/artifact.js';
import { heading, info, printJson, success, warn } from '../render.js';

/** Machine-specific absolute path patterns forbidden by spec-rules.md. */
const ABSOLUTE_PATH_PATTERNS = [
  /\/Users\/\S+/g,
  /\/home\/\S+/g,
  /file:\/\/\/\S+/g,
  /[A-Za-z]:\\\\\S+/g,
];

const INVARIANT_DEF_RE = /\*\*\s*(INV-\d+)/;
const COVERAGE_RE = /Covered by/i;

/**
 * Returns the invariant IDs declared in a spec that lack a `Covered by` mapping.
 * Definition format: `* **INV-1 · Rule Title**` followed by a `↳ *Covered by:*` line.
 */
export function uncoveredInvariants(content) {
  const lines = content.split('\n');
  const uncovered = [];

  for (let index = 0; index < lines.length; index += 1) {
    const definition = lines[index].match(INVARIANT_DEF_RE);
    if (!definition) continue;
    const id = definition[1];

    let covered = false;
    for (let lookahead = index + 1; lookahead < Math.min(index + 6, lines.length); lookahead += 1) {
      if (INVARIANT_DEF_RE.test(lines[lookahead])) break;
      if (COVERAGE_RE.test(lines[lookahead])) {
        covered = true;
        break;
      }
    }
    if (!covered) uncovered.push(id);
  }

  return uncovered;
}

/** `spec validate` — enforces the portable-path and BDD traceability rules. */
export async function validate({ cwd, flags }) {
  const specs = await listSpecs(cwd);
  const findings = [];

  for (const spec of specs) {
    const content = await fsp.readFile(path.join(cwd, spec.path), 'utf8');

    for (const pattern of ABSOLUTE_PATH_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        findings.push({ spec: spec.slug, rule: 'portable-paths', detail: matches[0] });
      }
    }

    for (const invariant of uncoveredInvariants(content)) {
      findings.push({
        spec: spec.slug,
        rule: 'invariant-traceability',
        detail: `${invariant} has no "Covered by" mapping`,
      });
    }
  }

  if (flags.json) {
    printJson({ specs: specs.length, findings });
    if (findings.length > 0) process.exitCode = 1;
    return;
  }

  heading(`Validating ${specs.length} spec(s)`);
  if (findings.length === 0) {
    success('All specs comply with spec-rules.md.');
    return;
  }

  for (const finding of findings) {
    warn(`[${finding.rule}] ${finding.spec}: ${finding.detail}`);
  }
  info(`${findings.length} finding(s) detected.`);
  process.exitCode = 1;
}
