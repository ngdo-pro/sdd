import path from 'node:path';
import fsp from 'node:fs/promises';
import { ALLOWED_ROOT_ENTRIES, canonicalRoot, specsRoot } from '../core/paths.js';
import { findPortablePathViolations, uncoveredInvariants } from '../core/rules.js';
import { modelRelativePaths } from './layout.js';
import { loadModel } from './store.js';

const LIFECYCLE_DIRS = new Set(['planned', 'active', 'archive']);

async function readdirSafe(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Collects lifecycle-state directories under the canonical tree (INV-1). */
async function findLifecycleDirs(cwd) {
  const root = canonicalRoot(cwd);
  const violations = [];

  async function walk(directory) {
    for (const entry of await readdirSafe(directory)) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      if (LIFECYCLE_DIRS.has(entry.name)) {
        violations.push(`lifecycle directory "${entry.name}/" under ${toRepoRelative(cwd, absolute)}`);
        continue;
      }
      await walk(absolute);
    }
  }

  await walk(path.join(root, 'initiatives'));
  return violations;
}

function toRepoRelative(cwd, absolute) {
  return `.sdd/canonical/${absolute.slice(canonicalRoot(cwd).length + 1).split(path.sep).join('/')}`;
}

/**
 * INV-1: the `.sdd/` root is exhaustive — only `config.json`, `canonical/`,
 * `generated/` and `knowledge/` may live there. Dotfiles (`.DS_Store`,
 * `.gitkeep`, `.migration-failed.json`) are tolerated; `generated/` and
 * `knowledge/` are permitted without being required.
 */
async function findRootLayoutViolations(cwd) {
  const violations = [];
  for (const entry of await readdirSafe(specsRoot(cwd))) {
    if (entry.name.startsWith('.')) continue;
    if (ALLOWED_ROOT_ENTRIES.includes(entry.name)) continue;
    const label = entry.isDirectory() ? `${entry.name}/` : entry.name;
    violations.push(`unexpected root entry "${label}" (allowed: ${ALLOWED_ROOT_ENTRIES.join(', ')})`);
  }
  return violations;
}

/**
 * Computes every spec-rules.md finding for a workspace: portable paths
 * (rule 1), invariant traceability (rule 3), the stateless canonical layout
 * (INV-1), spec id uniqueness (INV-5) and graph integrity.
 * Pure reader — no config, no connectors, no `process.exitCode`: the same
 * engine backs `sdd validate` and the strict gate of `sdd migrate`.
 * @returns {Promise<Array<{ artifact: string, rule: string, detail: string }>>}
 */
export async function computeFindings(cwd) {
  const artifacts = await loadModel(cwd);
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
        findings.push({ artifact: label, rule: 'graph-integrity', detail: 'no parent feature linked (run `sdd link`)' });
      }
      if (!artifact.relations?.initiative) {
        findings.push({ artifact: label, rule: 'graph-integrity', detail: 'no parent initiative linked (derive via `--feature`)' });
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

    // INV-1: the canonical path must derive from slugs/ids + relations alone.
    if (artifact.kind !== 'vision') {
      try {
        const derived = modelRelativePaths(artifact);
        if (artifact.model?.meta && derived.meta !== artifact.model.meta) {
          findings.push({
            artifact: label,
            rule: 'canonical-layout',
            detail: `model path "${artifact.model.meta}" does not derive from relations (expected "${derived.meta}")`,
          });
        }
      } catch {
        // Un-derivable path already reported as graph-integrity above.
      }
    }
  }

  for (const violation of await findLifecycleDirs(cwd)) {
    findings.push({ artifact: 'canonical tree', rule: 'canonical-layout', detail: violation });
  }

  for (const violation of await findRootLayoutViolations(cwd)) {
    findings.push({ artifact: '.sdd/', rule: 'root-layout', detail: violation });
  }

  // INV-5: with the nested tree, spec id uniqueness is no longer guaranteed by
  // directory collisions — the model must enforce it explicitly.
  const byId = new Map();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'spec' || !artifact.id) continue;
    if (!byId.has(artifact.id)) byId.set(artifact.id, []);
    byId.get(artifact.id).push(artifact.slug);
  }
  for (const [id, owners] of byId) {
    if (owners.length > 1) {
      findings.push({ artifact: `spec ${id}`, rule: 'spec-id-uniqueness', detail: `duplicate spec id "${id}" used by ${owners.join(', ')}` });
    }
  }

  return findings;
}