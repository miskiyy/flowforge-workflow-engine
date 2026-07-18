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

  // Regression guard: pins the WCAG AA-passing values, paired with dark-ink
  // text (var(--bg)) on the dark theme's light status fills (frontend-design.md
  // §11). If this snapshot changes, re-check contrast against dark ink before
  // accepting it — the darkest value (skipped, #6b7280) is ~4.8:1.
  it('pins the AA-passing status colors', () => {
    expect(STEP_STATUS_COLOR).toMatchInlineSnapshot(`
      {
        "failed": "#ff7a7a",
        "pending": "#8c909f",
        "queued": "#8c909f",
        "running": "#6d94ff",
        "skipped": "#6b7280",
        "succeeded": "#4ade80",
      }
    `);
  });
});
