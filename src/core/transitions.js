import { TransitionError } from './errors.js';

/** Legal lifecycle transitions. */
export const ALLOWED_TRANSITIONS = {
  planned: ['active', 'archived'],
  active: ['planned', 'archived'],
  archived: ['active'],
};

/** Human-readable status labels written into artifact headers. */
export const STATE_LABELS = {
  planned: 'Planned',
  active: 'Active',
  archived: 'Archived',
};

/**
 * Accepts user input (`archive`, `archived`, `Active`, `plan`...) and returns a
 * canonical state, or `null` when the input is not a known state.
 */
export function normalizeState(input) {
  if (input === undefined || input === null) return null;
  const value = String(input).trim().toLowerCase();
  if (value === 'planned' || value === 'plan') return 'planned';
  if (value === 'active' || value === 'activate') return 'active';
  if (value === 'archive' || value === 'archived') return 'archived';
  return null;
}

export function canTransition(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

/**
 * Validates a transition for a given artifact.
 * @returns {boolean} `true` when the artifact must move, `false` for a no-op.
 * @throws {TransitionError} on illegal or stateless transitions.
 */
export function assertTransition(artifact, toState) {
  const label = artifact.slug ?? artifact.id ?? artifact.path;
  if (artifact.state === null || artifact.state === undefined) {
    throw new TransitionError(`Artifact "${label}" (${artifact.kind}) has no lifecycle state to transition.`);
  }
  if (artifact.state === toState) return false;
  if (!canTransition(artifact.state, toState)) {
    const allowed = ALLOWED_TRANSITIONS[artifact.state]?.join(', ') ?? 'none';
    throw new TransitionError(
      `Illegal transition ${artifact.state} → ${toState} for ${artifact.kind} "${label}". Allowed from ${artifact.state}: ${allowed}.`,
    );
  }
  return true;
}
