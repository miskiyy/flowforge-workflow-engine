import { describe, expect, it } from 'vitest';
import { buildExecutionPlan, parseDag, topoSort } from '../src/engine/dag.js';
import { cyclicDag, duplicateKeyDag, malformedDag, unknownDependencyDag, validDag } from './fixtures.js';

describe('dag engine', () => {
  describe('parseDag', () => {
    it('builds a graph from a valid linear dag', () => {
      const result = parseDag(validDag());
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect([...result.graph.steps.keys()]).toEqual(['a', 'b']);
      expect(result.graph.dependents.get('a')).toEqual(['b']);
    });

    it('rejects malformed input with a specific schema error', () => {
      const result = parseDag(malformedDag);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects duplicate step keys', () => {
      const result = parseDag(duplicateKeyDag);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors.some((e) => e.message.includes('duplicate step key'))).toBe(true);
    });

    it('rejects an unknown dependency reference', () => {
      const result = parseDag(unknownDependencyDag);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors.some((e) => e.message.includes('unknown dependency'))).toBe(true);
    });

    it('rejects a step that depends on itself', () => {
      const result = parseDag({ steps: [{ key: 'a', type: 'delay', dependsOn: ['a'], durationMs: 100 }] });
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors.some((e) => e.message.includes('depend on itself'))).toBe(true);
    });

    it.each([null, undefined, 'not a dag', 42, [], {}, { steps: 'not an array' }])(
      'rejects non-dag root input: %p',
      (input) => {
        const result = parseDag(input);
        expect(result.valid).toBe(false);
      },
    );

    it('tolerates a step declaring the same dependency twice (still builds a valid graph)', () => {
      const result = parseDag({
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'b', type: 'delay', dependsOn: ['a', 'a'], durationMs: 1 },
        ],
      });
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.graph.dependents.get('a')).toEqual(['b', 'b']);
    });
  });

  describe('topoSort', () => {
    it('orders a linear dag', () => {
      const parsed = parseDag(validDag());
      if (!parsed.valid) throw new Error('expected valid graph');
      const result = topoSort(parsed.graph);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.order).toEqual(['a', 'b']);
      expect(result.levels).toEqual([['a'], ['b']]);
    });

    it('groups independent branches of a diamond into the same level', () => {
      const diamond = {
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
          { key: 'c', type: 'delay', dependsOn: ['a'], durationMs: 1 },
          { key: 'd', type: 'delay', dependsOn: ['b', 'c'], durationMs: 1 },
        ],
      };
      const parsed = parseDag(diamond);
      if (!parsed.valid) throw new Error('expected valid graph');
      const result = topoSort(parsed.graph);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.levels).toEqual([['a'], ['b', 'c'], ['d']]);
      expect(result.order).toEqual(['a', 'b', 'c', 'd']);
    });

    it('orders disconnected components independently, deterministically by key', () => {
      const disconnected = {
        steps: [
          { key: 'z', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'y', type: 'delay', dependsOn: [], durationMs: 1 },
        ],
      };
      const parsed = parseDag(disconnected);
      if (!parsed.valid) throw new Error('expected valid graph');
      const result = topoSort(parsed.graph);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.order).toEqual(['y', 'z']);
      expect(result.levels).toEqual([['y', 'z']]);
    });

    it('is deterministic across repeated runs', () => {
      const parsed = parseDag(validDag());
      if (!parsed.valid) throw new Error('expected valid graph');
      const first = topoSort(parsed.graph);
      const second = topoSort(parsed.graph);
      expect(first).toEqual(second);
    });

    it('orders a graph with a duplicated dependency edge correctly (b still resolves after one completion of a)', () => {
      const parsed = parseDag({
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'b', type: 'delay', dependsOn: ['a', 'a'], durationMs: 1 },
        ],
      });
      if (!parsed.valid) throw new Error('expected valid graph');
      const result = topoSort(parsed.graph);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.order).toEqual(['a', 'b']);
    });

    it('handles a large linear chain without excessive cost (no accidental quadratic blowup)', () => {
      const STEP_COUNT = 500;
      const steps = Array.from({ length: STEP_COUNT }, (_, i) => ({
        key: `s${i}`,
        type: 'delay' as const,
        dependsOn: i === 0 ? [] : [`s${i - 1}`],
        durationMs: 1,
      }));
      const parsed = parseDag({ steps });
      if (!parsed.valid) throw new Error('expected valid graph');

      const startedAt = Date.now();
      const result = topoSort(parsed.graph);
      const elapsedMs = Date.now() - startedAt;

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.order).toHaveLength(STEP_COUNT);
      expect(result.order[0]).toBe('s0');
      expect(result.order[STEP_COUNT - 1]).toBe(`s${STEP_COUNT - 1}`);
      expect(elapsedMs).toBeLessThan(1000);
    });

    it('detects a cycle and reports the offending nodes', () => {
      const parsed = parseDag(cyclicDag);
      if (!parsed.valid) throw new Error('expected valid graph');
      const result = topoSort(parsed.graph);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.cycle).toEqual(['a', 'b']);
      expect(result.errors[0]?.message).toContain('cycle detected');
    });
  });

  describe('buildExecutionPlan', () => {
    it('parses and orders a valid dag in one call', () => {
      const result = buildExecutionPlan(validDag());
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.order).toEqual(['a', 'b']);
    });

    it('surfaces cycle errors without a partial order', () => {
      const result = buildExecutionPlan(cyclicDag);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors[0]?.message).toContain('cycle detected');
    });

    it('surfaces structural errors before ever attempting a sort', () => {
      const result = buildExecutionPlan(unknownDependencyDag);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.errors.some((e) => e.message.includes('unknown dependency'))).toBe(true);
    });
  });
});
