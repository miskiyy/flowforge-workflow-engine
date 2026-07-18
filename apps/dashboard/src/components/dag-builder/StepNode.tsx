import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DagStepDefinition } from '@flowforge/shared-types';
import type { StepFlowNode } from './dagFlowSync.js';

const TYPE_ICON: Record<DagStepDefinition['type'], string> = {
  http: '🌐',
  script: '⌨️',
  delay: '⏱️',
  condition: '◇',
};

function summarize(step: DagStepDefinition): string {
  switch (step.type) {
    case 'http':
      return `${step.method} ${step.url}`;
    case 'script':
      return step.command;
    case 'delay':
      return `Duration: ${step.durationMs}ms`;
    case 'condition':
      return `${step.left} ${step.op} ${step.right}`;
  }
}

/** Custom React Flow node — same card language as the rest of the app (`.card`, blue accent), not the reference screenshot's palette. */
export function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { step } = data;
  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-3)',
        width: 200,
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        boxShadow: selected ? 'var(--glow-accent)' : 'var(--shadow-sm)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--accent)', border: 'none' }} />
      <div className="chip chip-accent" style={{ marginBottom: 'var(--space-2)' }}>
        <span aria-hidden="true">{TYPE_ICON[step.type]}</span> {step.type}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, marginBottom: 2 }}>{step.key}</div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-mut)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={summarize(step)}
      >
        {summarize(step)}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--accent)', border: 'none' }} />
    </div>
  );
}

export const NODE_TYPES = { step: StepNode };
