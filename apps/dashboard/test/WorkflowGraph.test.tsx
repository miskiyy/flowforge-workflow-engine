import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowGraph } from '../src/components/WorkflowGraph.js';
import type { StepState } from '../src/realtime/types.js';

const dag: WorkflowDagDefinition = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
  ],
};

describe('WorkflowGraph', () => {
  it('renders one node per DAG step and one edge per dependsOn relationship', () => {
    render(<WorkflowGraph dag={dag} steps={{}} />);
    expect(screen.getAllByTestId('graph-node')).toHaveLength(2);
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(1);
  });

  it('defaults a step with no known status to pending', () => {
    render(<WorkflowGraph dag={dag} steps={{}} />);
    const nodeA = screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!;
    expect(nodeA.dataset.status).toBe('pending');
  });

  it('reflects each step\'s live status on its node', () => {
    const steps: Record<string, StepState> = {
      a: { stepKey: 'a', status: 'succeeded' },
      b: { stepKey: 'b', status: 'running' },
    };
    render(<WorkflowGraph dag={dag} steps={steps} />);
    const nodes = screen.getAllByTestId('graph-node');
    const nodeA = nodes.find((n) => n.dataset.stepKey === 'a')!;
    const nodeB = nodes.find((n) => n.dataset.stepKey === 'b')!;
    expect(nodeA.dataset.status).toBe('succeeded');
    expect(nodeB.dataset.status).toBe('running');
    expect(nodeB.getAttribute('class')).toContain('ff-node-running');
  });

  it('re-renders node colors when step statuses change (graph updates correctly)', () => {
    const { rerender } = render(<WorkflowGraph dag={dag} steps={{ a: { stepKey: 'a', status: 'pending' } }} />);
    expect(screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!.dataset.status).toBe('pending');

    rerender(<WorkflowGraph dag={dag} steps={{ a: { stepKey: 'a', status: 'failed' } }} />);
    expect(screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!.dataset.status).toBe('failed');
  });

  it('renders a status glyph inside every node (non-color channel, WCAG 1.4.1)', () => {
    const steps: Record<string, StepState> = { a: { stepKey: 'a', status: 'succeeded' } };
    render(<WorkflowGraph dag={dag} steps={steps} />);
    const nodeA = screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!;
    expect(nodeA.textContent).toContain('✓');
  });

  it('gates the running pulse animation on prefers-reduced-motion', () => {
    const { container } = render(<WorkflowGraph dag={dag} steps={{}} />);
    expect(container.querySelector('style')!.textContent).toContain('prefers-reduced-motion: no-preference');
  });

  it('summarizes step status counts in the graph aria-label for screen readers', () => {
    const steps: Record<string, StepState> = {
      a: { stepKey: 'a', status: 'succeeded' },
      b: { stepKey: 'b', status: 'failed' },
    };
    render(<WorkflowGraph dag={dag} steps={steps} />);
    const label = screen.getByRole('img').getAttribute('aria-label');
    expect(label).toContain('2 steps');
    expect(label).toContain('1 succeeded');
    expect(label).toContain('1 failed');
  });
});
