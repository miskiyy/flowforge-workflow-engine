import { STEP_TYPES, WorkflowDagDefinition } from '@flowforge/shared-types';
import type { DagValidationError } from '../workflows/dag-validation.js';
import type { ChatMessage } from './provider.js';

/**
 * The prompt's derived schema — `JSON.stringify` of the same TypeBox object
 * Ajv compiles in engine/dag.ts. Never hand-copied: if the schema changes,
 * this changes with it. This is an *advisory* rendering for the model, not
 * the enforcement path — see ai-subsystem-design.md §0 for why the canonical
 * schema can't be handed to strict/tool-calling mode verbatim.
 */
const SCHEMA_JSON = JSON.stringify(WorkflowDagDefinition);

interface FewShotExample {
  request: string;
  dag: WorkflowDagDefinition;
}

/**
 * Typed as `WorkflowDagDefinition` so `tsc` fails the build if an example
 * drifts from the schema — a stale few-shot teaching an invalid shape is a
 * silent poisoning the compiler catches for free. Three examples: free
 * models have tight context budgets and no prompt caching, so this stays
 * deliberately short — but `condition` is otherwise invisible to the model
 * (its `left`/`op`/`right` shape isn't self-explanatory from the JSON
 * schema alone), and an unseen step type never gets generated.
 */
const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    request: 'Fetch a URL, then wait 2 seconds before finishing.',
    dag: {
      steps: [
        { key: 'fetch', type: 'http', dependsOn: [], method: 'GET', url: 'https://api.example.com/data' },
        { key: 'wait', type: 'delay', dependsOn: ['fetch'], durationMs: 2000 },
      ],
    },
  },
  {
    request: 'Run a setup step, then two independent checks in parallel, then notify once both finish.',
    dag: {
      steps: [
        { key: 'setup', type: 'delay', dependsOn: [], durationMs: 500 },
        { key: 'check_a', type: 'http', dependsOn: ['setup'], method: 'GET', url: 'https://api.example.com/check-a' },
        { key: 'check_b', type: 'http', dependsOn: ['setup'], method: 'GET', url: 'https://api.example.com/check-b' },
        {
          key: 'notify',
          type: 'http',
          dependsOn: ['check_a', 'check_b'],
          method: 'POST',
          url: 'https://api.example.com/notify',
        },
      ],
    },
  },
  {
    request: 'Check a health endpoint, and only send an alert if that check failed.',
    dag: {
      steps: [
        { key: 'health_check', type: 'http', dependsOn: [], method: 'GET', url: 'https://api.example.com/health' },
        {
          key: 'gate',
          type: 'condition',
          dependsOn: ['health_check'],
          left: '$.steps.health_check.status',
          op: 'eq',
          right: 'failed',
        },
        { key: 'alert', type: 'http', dependsOn: ['gate'], method: 'POST', url: 'https://api.example.com/alert' },
      ],
    },
  },
];

function buildSystemMessage(): ChatMessage {
  const vocabulary = STEP_TYPES.join(' | ');
  const examples = FEW_SHOT_EXAMPLES.map(
    (example, i) => `Example ${i + 1}:\nRequest: ${example.request}\nOutput: ${JSON.stringify(example.dag)}`,
  ).join('\n\n');

  const content = [
    'You translate plain-English descriptions into FlowForge workflow DAGs. Output JSON only — no prose, no markdown fences.',
    `The output must satisfy this JSON schema:\n${SCHEMA_JSON}`,
    `The closed, exhaustive set of step "type" values is: ${vocabulary}. Never invent a step type outside this list.`,
    'Hard rules: every "dependsOn" entry must reference another step\'s "key" in this same DAG; a step may not depend on itself; step keys must be unique; the dependency graph must not contain a cycle. A "condition" step\'s "left" must be exactly "$.steps.<key>.status" where <key> is one of that same condition step\'s own "dependsOn" entries; "op" is "eq" or "neq"; "right" is one of "succeeded", "failed", "skipped". If the comparison is false, the condition step\'s own dependents are skipped (not the whole workflow) — model that as steps depending on the condition step, not on the step it inspects.',
    `${examples}`,
  ].join('\n\n');

  return { role: 'system', content };
}

function buildUserMessage(baseDag: WorkflowDagDefinition | null, userText: string): ChatMessage {
  const currentWorkflow = baseDag ? JSON.stringify(baseDag) : 'none — new workflow';
  return {
    role: 'user',
    content: `<current_workflow>${currentWorkflow}</current_workflow>\n<request>${userText}</request>`,
  };
}

/** The failed draft plus the validator's own errors, verbatim — no translation layer between the engine's error shape and what the model sees. */
function buildRepairMessages(draftText: string, errors: DagValidationError[]): ChatMessage[] {
  return [
    { role: 'assistant', content: draftText },
    {
      role: 'user',
      content: `<validation_errors>${JSON.stringify(errors)}</validation_errors>\nFix these errors. Output the corrected complete JSON.`,
    },
  ];
}

export interface PriorAttempt {
  draftText: string;
  errors: DagValidationError[];
}

/**
 * Pure: same inputs, same messages, every time. No network, no I/O — fully
 * unit-testable. `priorAttempt` is set on repair calls (attempts 2 and 3);
 * omitted on the first attempt.
 */
export function buildPromptMessages(
  baseDag: WorkflowDagDefinition | null,
  userText: string,
  priorAttempt?: PriorAttempt,
): ChatMessage[] {
  const messages = [buildSystemMessage(), buildUserMessage(baseDag, userText)];
  if (priorAttempt) messages.push(...buildRepairMessages(priorAttempt.draftText, priorAttempt.errors));
  return messages;
}
