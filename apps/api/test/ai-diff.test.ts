import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import { diffDag } from '../src/ai/diff.js';

const base: WorkflowDagDefinition = {
  steps: [
    { key: 'seed', type: 'delay', dependsOn: [], durationMs: 100 },
    { key: 'fetch', type: 'http', dependsOn: ['seed'], method: 'GET', url: 'https://example.com/a' },
    { key: 'legacy_ping', type: 'delay', dependsOn: [], durationMs: 50 },
  ],
};

describe('diffDag', () => {
  it('reports a step present only in the proposed DAG as added', () => {
    const proposed: WorkflowDagDefinition = { steps: [...base.steps, { key: 'notify', type: 'delay', dependsOn: [], durationMs: 10 }] };
    const diff = diffDag(base, proposed);
    expect(diff.added).toEqual(['notify']);
  });

  it('reports a step present only in the base DAG as removed', () => {
    const proposed: WorkflowDagDefinition = { steps: base.steps.filter((s) => s.key !== 'legacy_ping') };
    const diff = diffDag(base, proposed);
    expect(diff.removed).toEqual(['legacy_ping']);
  });

  it('reports a step with the same key but different fields as modified, naming the changed fields', () => {
    const proposed: WorkflowDagDefinition = {
      steps: base.steps.map((s) => (s.key === 'fetch' ? { ...s, method: 'POST' as const, url: 'https://example.com/b' } : s)),
    };
    const diff = diffDag(base, proposed);
    expect(diff.modified).toEqual([{ key: 'fetch', fields: ['method', 'url'] }]);
  });

  it('reports a byte-identical step as unchanged', () => {
    const diff = diffDag(base, base);
    expect(diff.unchanged.sort()).toEqual(['fetch', 'legacy_ping', 'seed']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it('reordering steps is not a change', () => {
    const reordered: WorkflowDagDefinition = { steps: [...base.steps].reverse() };
    const diff = diffDag(base, reordered);
    expect(diff.unchanged.sort()).toEqual(['fetch', 'legacy_ping', 'seed']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it('an empty (null) base means every proposed step is added — the greenfield case', () => {
    const diff = diffDag(null, base);
    expect(diff.added.sort()).toEqual(['fetch', 'legacy_ping', 'seed']);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });
});
