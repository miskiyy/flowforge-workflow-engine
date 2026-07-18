import type { DagStepDefinition, WorkflowDagDefinition } from '@flowforge/shared-types';
import type { Edge, Node } from '@xyflow/react';
import { computeLayout } from '../../layout.js';

export interface StepNodeData extends Record<string, unknown> {
  step: DagStepDefinition;
}

export type StepFlowNode = Node<StepNodeData, 'step'>;

/** Edge id doubles as the dependency it represents — `${from}->${to}` means "to dependsOn from". */
export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * DAG JSON -> canvas. Positions come from the same dagre auto-layout
 * WorkflowGraph.tsx uses for run visualization — not persisted anywhere
 * (the schema has no x/y), so this runs fresh every time the builder opens.
 */
export function dagToFlow(dag: WorkflowDagDefinition): { nodes: StepFlowNode[]; edges: Edge[] } {
  const layout = computeLayout(dag);
  const positionByKey = new Map(layout.nodes.map((n) => [n.id, { x: n.x - n.width / 2, y: n.y - n.height / 2 }]));

  const nodes: StepFlowNode[] = dag.steps.map((step) => ({
    id: step.key,
    type: 'step',
    position: positionByKey.get(step.key) ?? { x: 0, y: 0 },
    data: { step },
  }));

  const edges: Edge[] = dag.steps.flatMap((step) =>
    step.dependsOn.map((dep) => ({
      id: edgeId(dep, step.key),
      source: dep,
      target: step.key,
      animated: false,
    })),
  );

  return { nodes, edges };
}

/** Canvas -> DAG JSON. Edge `source -> target` becomes `target.dependsOn including source`, dedup'd and in a stable order. */
export function flowToDag(nodes: StepFlowNode[], edges: Edge[]): WorkflowDagDefinition {
  const dependsOnByTarget = new Map<string, string[]>();
  for (const edge of edges) {
    const deps = dependsOnByTarget.get(edge.target) ?? [];
    if (!deps.includes(edge.source)) deps.push(edge.source);
    dependsOnByTarget.set(edge.target, deps);
  }

  const steps = nodes.map((node): DagStepDefinition => {
    const dependsOn = dependsOnByTarget.get(node.id) ?? [];
    return { ...node.data.step, key: node.id, dependsOn } as DagStepDefinition;
  });

  return { steps };
}

const EXISTING_KEY = /^step_(\d+)$/;

/** `step_1`, `step_2`, ... — first unused index, so deleting and re-adding doesn't pile up gaps forever. */
export function nextStepKey(existingKeys: string[]): string {
  const used = new Set(existingKeys.map((key) => Number(EXISTING_KEY.exec(key)?.[1])).filter((n) => !Number.isNaN(n)));
  let i = 1;
  while (used.has(i)) i++;
  return `step_${i}`;
}

/** One sensible default per step type — matches DagEditor's own scaffold conventions. */
export function defaultStepFor(type: DagStepDefinition['type'], key: string): DagStepDefinition {
  switch (type) {
    case 'http':
      return { key, type: 'http', dependsOn: [], method: 'GET', url: 'https://example.com' };
    case 'script':
      return { key, type: 'script', dependsOn: [], command: 'echo', args: ['hello'], timeoutMs: 5000 };
    case 'delay':
      return { key, type: 'delay', dependsOn: [], durationMs: 1000 };
    case 'condition':
      return { key, type: 'condition', dependsOn: [], left: '$.steps.step_1.status', op: 'eq', right: 'succeeded' };
  }
}
