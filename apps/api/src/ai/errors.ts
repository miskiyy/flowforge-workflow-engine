import { AppError } from '../lib/errors.js';
import type { DagValidationError } from '../workflows/dag-validation.js';

/** Provider unreachable, timed out, or hit its (free-tier) rate cap. Always retryable by the caller. */
export class AiUnavailableError extends AppError {
  constructor(message = 'AI provider unavailable') {
    super(503, 'AI_UNAVAILABLE', message, { retryable: true });
  }
}

/**
 * The repair loop (ai/propose.ts) exhausted its attempts without producing a
 * schema-valid draft. `lastDraft` lets the caller hand-fix in the editor
 * instead of starting over — see ai-subsystem-design.md §9.
 */
export class AiDraftInvalidError extends AppError {
  constructor(errors: DagValidationError[], lastDraft: unknown) {
    super(422, 'AI_DRAFT_INVALID', 'AI could not produce a valid workflow draft', { errors, lastDraft });
  }
}
