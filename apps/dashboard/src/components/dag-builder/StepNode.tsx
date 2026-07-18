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

const TYPE_COLOR: Record<DagStepDefinition['type'], { border: string; bg: string; text: string }> = {
  http: {
    border: 'rgba(59, 130, 246, 0.5)', // Blue
    bg: 'rgba(59, 130, 246, 0.1)',
    text: '#60a5fa',
  },
  script: {
    border: 'rgba(168, 85, 247, 0.5)', // Purple
    bg: 'rgba(168, 85, 247, 0.1)',
    text: '#c084fc',
  },
  delay: {
    border: 'rgba(234, 179, 8, 0.5)', // Yellow
    bg: 'rgba(234, 179, 8, 0.1)',
    text: '#facc15',
  },
  condition: {
    border: 'rgba(20, 184, 166, 0.5)', // Teal
    bg: 'rgba(20, 184, 166, 0.1)',
    text: '#2dd4bf',
  },
};

/** Custom React Flow node — same card language as the rest of the app (`.card`, blue accent), not the reference screenshot's palette. */
export function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { step } = data;
  const colors = TYPE_COLOR[step.type];

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-2)',
        width: 140,
        borderColor: selected ? 'var(--accent)' : colors.border,
        boxShadow: selected ? 'var(--glow-accent)' : 'var(--shadow-sm)',
        borderWidth: selected ? '2px' : '1px',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: selected ? 'var(--accent)' : colors.border, border: 'none' }} />
      <div
        style={{
          marginBottom: 'var(--space-1)',
          padding: '2px 8px',
          fontSize: '9px',
          fontWeight: 'bold',
          borderRadius: '999px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        <span aria-hidden="true">{TYPE_ICON[step.type]}</span> {step.type.toUpperCase()}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '11px', marginBottom: 1, color: '#fff' }}>{step.key}</div>
      <div
        style={{
          fontSize: '9px',
          color: 'var(--ink-mut)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={summarize(step)}
      >
        {summarize(step)}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: selected ? 'var(--accent)' : colors.border, border: 'none' }} />
    </div>
  );
}

export const NODE_TYPES = { step: StepNode };
