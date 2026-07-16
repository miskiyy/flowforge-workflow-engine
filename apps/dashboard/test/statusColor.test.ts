import { describe, expect, it } from 'vitest';
import { STEP_STATUS_COLOR, STEP_STATUS_GLYPH } from '../src/statusColor.js';
import { type StepDisplayStatus } from '../src/realtime/types.js';

const STATUSES: StepDisplayStatus[] = ['pending', 'queued', 'running', 'succeeded', 'failed', 'skipped'];

describe('statusColor', () => {
  it('has a glyph for every status', () => {
    for (const status of STATUSES) {
      expect(STEP_STATUS_GLYPH[status]).toBeTruthy();
    }
  });

  // Regression guard: pins the WCAG AA-passing values (frontend-design.md
  // §11). If this snapshot changes, re-check contrast before accepting it.
  it('pins the AA-passing status colors', () => {
    expect(STEP_STATUS_COLOR).toMatchInlineSnapshot(`
      {
        "failed": "#b91c1c",
        "pending": "#6b7280",
        "queued": "#6b7280",
        "running": "#1d4ed8",
        "skipped": "#4b5563",
        "succeeded": "#15803d",
      }
    `);
  });
});
