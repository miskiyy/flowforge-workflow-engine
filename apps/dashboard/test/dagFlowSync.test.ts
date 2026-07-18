import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  dagToFlow,
  defaultStepFor,
  edgeId,
  flowToDag,
  nextStepKey,
  type StepFlowNode,
} from '../src/components/dag-builder/dagFlowSync.js';

const diamondDag: WorkflowDagDefinition = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'c', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'd', type: 'delay', dependsOn: ['b', 'c'], durationMs: 1 },
  ],
};

describe('dagToFlow', () => {
  it('produces one node per step, carrying the full step definition', () => {
    const { nodes } = dagToFlow(diamondDag);
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(nodes.find((n) => n.id === 'b')?.data.step).toEqual(diamondDag.steps[1]);
  });

  it('produces one edge per dependsOn relationship, source -> target', () => {
    const { edges } = dagToFlow(diamondDag);
    const pairs = edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(pairs).toEqual(['a->b', 'a->c', 'b->d', 'c->d']);
  });
});

describe('flowToDag', () => {
  it('round-trips a DAG through dagToFlow and back unchanged', () => {
    const { nodes, edges } = dagToFlow(diamondDag);
    const result = flowToDag(nodes, edges);
    const sortByKey = (steps: typeof result.steps) => [...steps].sort((x, y) => x.key.localeCompare(y.key));
    expect(sortByKey(result.steps)).toEqual(sortByKey(diamondDag.steps).map((s) => ({ ...s, dependsOn: [...s.dependsOn].sort() })));
  });

  it('derives dependsOn purely from edges — connecting two nodes on canvas adds the dependency', () => {
    const nodes: StepFlowNode[] = [
      { id: 'x', type: 'step', position: { x: 0, y: 0 }, data: { step: { key: 'x', type: 'delay', dependsOn: [], durationMs: 1 } } },
      { id: 'y', type: 'step', position: { x: 0, y: 0 }, data: { step: { key: 'y', type: 'delay', dependsOn: [], durationMs: 1 } } },
    ];
    const edges: Edge[] = [{ id: edgeId('x', 'y'), source: 'x', target: 'y' }];

    const dag = flowToDag(nodes, edges);
    expect(dag.steps.find((s) => s.key === 'y')?.dependsOn).toEqual(['x']);
    expect(dag.steps.find((s) => s.key === 'x')?.dependsOn).toEqual([]);
  });

  it('removing an edge removes the dependency, without deleting the node', () => {
    const nodes: StepFlowNode[] = [
      { id: 'x', type: 'step', position: { x: 0, y: 0 }, data: { step: { key: 'x', type: 'delay', dependsOn: [], durationMs: 1 } } },
      { id: 'y', type: 'step', position: { x: 0, y: 0 }, data: { step: { key: 'y', type: 'delay', dependsOn: ['x'], durationMs: 1 } } },
    ];
    const dag = flowToDag(nodes, []); // no edges — the connection was removed on canvas
    expect(dag.steps.find((s) => s.key === 'y')?.dependsOn).toEqual([]);
  });
});

describe('nextStepKey', () => {
  it('starts at step_1 when nothing exists yet', () => {
    expect(nextStepKey([])).toBe('step_1');
  });

  it('picks the first unused index, filling a gap left by a deleted step', () => {
    expect(nextStepKey(['step_1', 'step_3'])).toBe('step_2');
  });

  it('ignores hand-renamed keys that do not match the step_N pattern', () => {
    expect(nextStepKey(['fetch_data', 'step_1'])).toBe('step_2');
  });
});

describe('defaultStepFor', () => {
  it('produces a schema-shaped default for every step type', () => {
    expect(defaultStepFor('http', 'a')).toMatchObject({ key: 'a', type: 'http', method: 'GET' });
    expect(defaultStepFor('script', 'a')).toMatchObject({ key: 'a', type: 'script', command: 'echo' });
    expect(defaultStepFor('delay', 'a')).toMatchObject({ key: 'a', type: 'delay', durationMs: 1000 });
    expect(defaultStepFor('condition', 'a')).toMatchObject({ key: 'a', type: 'condition', op: 'eq' });
  });
});
