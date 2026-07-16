import { Type, type Static } from '@sinclair/typebox';

/**
 * Single source of truth for the workflow DAG shape. The JSON schema
 * exported here is consumed as-is by the API's validator (Fastify JSON
 * schema), the execution engine, the dashboard, and the NL->DAG prompt —
 * none of those may redefine this shape independently.
 */

export const STEP_TYPES = ['http', 'script', 'delay', 'condition'] as const;

const HttpStep = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    type: Type.Literal('http'),
    dependsOn: Type.Array(Type.String()),
    method: Type.Union([
      Type.Literal('GET'),
      Type.Literal('POST'),
      Type.Literal('PUT'),
      Type.Literal('PATCH'),
      Type.Literal('DELETE'),
    ]),
    url: Type.String({ format: 'uri' }),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    body: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const ScriptStep = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    type: Type.Literal('script'),
    dependsOn: Type.Array(Type.String()),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    timeoutMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
  },
  { additionalProperties: false },
);

const DelayStep = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    type: Type.Literal('delay'),
    dependsOn: Type.Array(Type.String()),
    // Capped to match ScriptStep.timeoutMs — an unbounded delay pins a worker slot forever (audit C3).
    durationMs: Type.Integer({ minimum: 0, maximum: 300_000 }),
  },
  { additionalProperties: false },
);

export const CONDITION_OPS = ['eq', 'neq'] as const;

/**
 * A closed comparison object, not a string — phase0-self-review.md's
 * Option 1 (the one that was never adopted before this). `left` must be
 * `$.steps.<key>.status`, where `<key>` is one of this step's own
 * `dependsOn` (enforced by workflows/guards.ts, not the schema — a schema
 * can't express "references a sibling array element"); `right` is one of
 * the run-status literals it's compared against. No parser, no eval, zero
 * injection surface, trivially validated by the same JSON schema every
 * other step shape uses.
 */
const ConditionStep = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    type: Type.Literal('condition'),
    dependsOn: Type.Array(Type.String()),
    left: Type.String({ minLength: 1, pattern: '^\\$\\.steps\\.[^.]+\\.status$' }),
    op: Type.Union(CONDITION_OPS.map((op) => Type.Literal(op))),
    right: Type.Union(
      ['succeeded', 'failed', 'skipped'].map((status) => Type.Literal(status)),
    ),
  },
  { additionalProperties: false },
);

export const DagStepDefinition = Type.Union([HttpStep, ScriptStep, DelayStep, ConditionStep]);

export const WorkflowDagDefinition = Type.Object(
  {
    steps: Type.Array(DagStepDefinition, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type DagStepDefinition = Static<typeof DagStepDefinition>;
export type WorkflowDagDefinition = Static<typeof WorkflowDagDefinition>;
