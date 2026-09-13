/**
 * Typed error hierarchy for the Spec Framework CLI.
 * Every error carries a stable `code` and a process `exitCode`.
 */
export class SpecFrameworkError extends Error {
  constructor(message, { code = 'SPEC_ERROR', exitCode = 1 } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class ConfigError extends SpecFrameworkError {
  constructor(message) {
    super(message, { code: 'CONFIG_ERROR' });
  }
}

export class ResolutionError extends SpecFrameworkError {
  constructor(message) {
    super(message, { code: 'RESOLUTION_ERROR' });
  }
}

export class TransitionError extends SpecFrameworkError {
  constructor(message) {
    super(message, { code: 'TRANSITION_ERROR' });
  }
}

/**
 * Migration failure (`spec migrate`, coexistence guard, unreadable source):
 * the workspace is left untouched (source kept, marker written by the engine)
 * and the user is told how to recover.
 */
export class MigrationError extends SpecFrameworkError {
  constructor(message) {
    super(message, { code: 'MIGRATION_ERROR' });
  }
}

export class BackendError extends SpecFrameworkError {
  constructor(message, { code = 'BACKEND_ERROR', exitCode = 1 } = {}) {
    super(message, { code, exitCode });
  }
}

export class UsageError extends SpecFrameworkError {
  constructor(message) {
    super(message, { code: 'USAGE_ERROR', exitCode: 2 });
  }
}
