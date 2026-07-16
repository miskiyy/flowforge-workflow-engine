import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/layout.js';

const linearDag: WorkflowDagDefinition = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
  ],
};

const diamondDag: WorkflowDagDefinition = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'c', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'd', type: 'delay', dependsOn: ['b', 'c'], durationMs: 1 },
  ],
};

describe('computeLayout', () => {
  it('positions every DAG step as exactly one node', () => {
    const layout = computeLayout(linearDag);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('lays a linear chain out left-to-right (increasing x)', () => {
    const layout = computeLayout(linearDag);
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(a.x).toBeLessThan(b.x);
  });

  it('creates one edge per dependsOn relationship', () => {
    const layout = computeLayout(diamondDag);
    const edgeIds = layout.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeIds).toEqual(['a->b', 'a->c', 'b->d', 'c->d']);
  });

  it('stacks parallel siblings at different y positions', () => {
    const layout = computeLayout(diamondDag);
    const b = layout.nodes.find((n) => n.id === 'b')!;
    const c = layout.nodes.find((n) => n.id === 'c')!;
    expect(b.y).not.toBe(c.y);
  });
});
