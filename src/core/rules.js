/** Machine-specific absolute path patterns forbidden by spec-rules.md rule 1. */
export const ABSOLUTE_PATH_PATTERNS = [
  /\/Users\/\S+/g,
  /\/home\/\S+/g,
  /file:\/\/\/\S+/g,
  /[A-Za-z]:\\\\\S+/g,
];

const INVARIANT_DEF_RE = /\*\*\s*(INV-\d+)/;
const COVERAGE_RE = /Covered by/i;

/** Returns every machine-specific absolute path found in a document. */
export function findPortablePathViolations(content) {
  const violations = [];
  for (const pattern of ABSOLUTE_PATH_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) violations.push(...new Set(matches));
  }
  return violations;
}

/**
 * Returns the invariant IDs declared in a spec body that lack a `Covered by`
 * mapping. Definition format: `* **INV-1 · Rule Title**` followed by a
 * `↳ *Covered by:*` line (see SPEC_TEMPLATE.md §5).
 */
export function uncoveredInvariants(content) {
  const lines = content.split('\n');
  const uncovered = [];

  for (let index = 0; index < lines.length; index += 1) {
    const definition = lines[index].match(INVARIANT_DEF_RE);
    if (!definition) continue;

    let covered = false;
    for (let lookahead = index + 1; lookahead < Math.min(index + 6, lines.length); lookahead += 1) {
      if (INVARIANT_DEF_RE.test(lines[lookahead])) break;
      if (COVERAGE_RE.test(lines[lookahead])) {
        covered = true;
        break;
      }
    }
    if (!covered) uncovered.push(definition[1]);
  }

  return uncovered;
}
