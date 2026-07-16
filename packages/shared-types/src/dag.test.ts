import { Ajv } from 'ajv';
import * as ajvFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { STEP_TYPES, WorkflowDagDefinition } from './dag.js';

// ajv-formats ships a nested copy of ajv's types for its peer dependency,
// so its default export's declared type doesn't structurally match the
// `Ajv` we import above — cast to the call signature we actually use.
const addFormats = ajvFormats.default as unknown as (instance: Ajv) => Ajv;
const ajv = addFormats(new Ajv({}));
const validate = ajv.compile(WorkflowDagDefinition);

const validLinearDag = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1000 },
    { key: 'b', type: 'http', dependsOn: ['a'], method: 'GET', url: 'https://example.com' },
  ],
};

describe('WorkflowDagDefinition schema', () => {
  beforeAll(() => {
    // Guards the closed step-type vocab this schema and the ajv fixtures
    // above both assume — catches drift if a step type is added/renamed.
    expect(STEP_TYPES).toEqual(['http', 'script', 'delay', 'condition']);
  });

  it('accepts a valid linear DAG', () => {
    expect(validate(validLinearDag)).toBe(true);
  });

  it('rejects an empty step list', () => {
    expect(validate({ steps: [] })).toBe(false);
  });

  it('rejects an unknown step type', () => {
    expect(validate({ steps: [{ key: 'a', type: 'nope', dependsOn: [] }] })).toBe(false);
  });

  it('rejects unknown properties on a step', () => {
    const dagWithJunkKey = {
      steps: [
        { key: 'a', type: 'delay', dependsOn: [], durationMs: 1000, evilExtra: 'inject me' },
      ],
    };
    expect(validate(dagWithJunkKey)).toBe(false);
  });

  it('rejects unknown properties on the root object', () => {
    expect(validate({ steps: validLinearDag.steps, extra: true })).toBe(false);
  });

  // Audit C3: an unbounded delay let ten schema-valid steps of 2^31ms each
  // permanently consume every worker slot — a tenant-triggerable DoS from
  // valid input. Capped to match ScriptStep.timeoutMs's existing 300s bound.
  it('rejects a delay step exceeding the 300s cap', () => {
    expect(validate({ steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 300_001 }] })).toBe(false);
  });

  it('accepts a delay step at exactly the 300s cap', () => {
    expect(validate({ steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 300_000 }] })).toBe(true);
  });

  describe('condition step — closed { left, op, right } comparison', () => {
    it('accepts a valid condition step', () => {
      expect(
        validate({
          steps: [
            { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
            { key: 'gate', type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' },
          ],
        }),
      ).toBe(true);
    });

    it('rejects a left that is not the $.steps.<key>.status shape', () => {
      expect(
        validate({
          steps: [{ key: 'gate', type: 'condition', dependsOn: [], left: 'steps.a.status', op: 'eq', right: 'succeeded' }],
        }),
      ).toBe(false);
    });

    it('rejects an unknown op', () => {
      expect(
        validate({
          steps: [
            { key: 'gate', type: 'condition', dependsOn: [], left: '$.steps.a.status', op: 'gt', right: 'succeeded' },
          ],
        }),
      ).toBe(false);
    });

    it('rejects an unknown right-hand status literal', () => {
      expect(
        validate({
          steps: [
            { key: 'gate', type: 'condition', dependsOn: [], left: '$.steps.a.status', op: 'eq', right: 'bogus' },
          ],
        }),
      ).toBe(false);
    });

    it('rejects the old free-text expression field — it is no longer part of the shape', () => {
      expect(
        validate({
          steps: [{ key: 'gate', type: 'condition', dependsOn: [], expression: "steps.a.status == 'succeeded'" }],
        }),
      ).toBe(false);
    });
  });
});
