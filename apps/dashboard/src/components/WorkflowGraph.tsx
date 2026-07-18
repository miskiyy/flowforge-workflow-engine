import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { useMemo } from 'react';
import { computeLayout } from '../layout.js';
import type { StepDisplayStatus, StepState } from '../realtime/types.js';
import { STEP_STATUS_COLOR, STEP_STATUS_GLYPH, STEP_STATUS_LABEL } from '../statusColor.js';

/** "Workflow graph: 5 steps, 3 succeeded, 1 failed, 1 pending" — an SVG DAG isn't readable node-by-node, so screen readers get this summary instead (§12). */
function summarizeStatuses(dag: WorkflowDagDefinition, steps: Record<string, StepState>): string {
  const counts: Partial<Record<StepDisplayStatus, number>> = {};
  for (const step of dag.steps) {
    const status = steps[step.key]?.status ?? 'pending';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const order: StepDisplayStatus[] = ['succeeded', 'failed', 'running', 'queued', 'pending', 'skipped'];
  const parts = order.filter((status) => counts[status]).map((status) => `${counts[status]} ${STEP_STATUS_LABEL[status].toLowerCase()}`);
  return `Workflow graph: ${dag.steps.length} steps, ${parts.join(', ')}`;
}

/**
 * SVG, not Canvas — free hit-testing/hover on nodes, and this graph is never
 * going to have thousands of nodes where Canvas's perf edge would matter
 * (per the architecture doc).
 */
export function WorkflowGraph({ dag, steps }: { dag: WorkflowDagDefinition; steps: Record<string, StepState> }) {
  const layout = useMemo(() => computeLayout(dag), [dag]);

  return (
    <svg
      data-testid="workflow-graph"
      viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
      style={{ width: '100%', maxWidth: Math.max(layout.width, 1), height: 'auto', maxHeight: Math.max(layout.height, 1), display: 'block', margin: '0 auto' }}
      role="img"
      aria-label={summarizeStatuses(dag, steps)}
    >
      <style>
        {`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes ff-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
            .ff-node-running { animation: ff-pulse 1.2s ease-in-out infinite; }
          }
          .ff-node rect { transition: fill 200ms ease; }
        `}
      </style>
      <defs>
        <filter id="ff-node-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.3" />
        </filter>
        {/* Glow per active status — the stitch reference's node-glow treatment. */}
        <filter id="ff-node-glow-running" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={STEP_STATUS_COLOR.running} floodOpacity="0.55" />
        </filter>
        <filter id="ff-node-glow-succeeded" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={STEP_STATUS_COLOR.succeeded} floodOpacity="0.45" />
        </filter>
        <filter id="ff-node-glow-failed" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={STEP_STATUS_COLOR.failed} floodOpacity="0.45" />
        </filter>
      </defs>
      <g>
        {layout.edges.map((edge) => (
          <polyline
            key={edge.id}
            data-testid="graph-edge"
            points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#424754"
            strokeWidth={1.5}
          />
        ))}
      </g>
      <g>
        {layout.nodes.map((node) => {
          const status = steps[node.id]?.status ?? 'pending';
          const stepDef = dag.steps.find((s) => s.key === node.id);
          const type = stepDef?.type ?? 'http';
          let details = '';
          if (stepDef) {
            if (stepDef.type === 'http') {
              details = `${stepDef.method} ${stepDef.url}`;
            } else if (stepDef.type === 'script') {
              details = stepDef.command;
            } else if (stepDef.type === 'delay') {
              details = `Duration: ${stepDef.durationMs}ms`;
            } else if (stepDef.type === 'condition') {
              details = `${stepDef.left} ${stepDef.op} ${stepDef.right}`;
            }
          }

          const typeIcon = type === 'http' ? '🌐' : type === 'script' ? '⌨️' : type === 'delay' ? '⏱️' : '◇';

          // Active states carry their solid status color + glow
          const active = status === 'running' || status === 'succeeded' || status === 'failed';
          const statusBorder = active ? STEP_STATUS_COLOR[status] : 'var(--border)';
          const glowFilter =
            status === 'running' ? 'url(#ff-node-glow-running)' : status === 'succeeded' ? 'url(#ff-node-glow-succeeded)' : status === 'failed' ? 'url(#ff-node-glow-failed)' : 'url(#ff-node-shadow)';

          return (
            <g
              key={node.id}
              className={`ff-node${status === 'running' ? ' ff-node-running' : ''}`}
              data-testid="graph-node"
              data-step-key={node.id}
              data-status={status}
              transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
            >
              {/* Outer Card border/fill */}
              <rect
                width={node.width}
                height={node.height}
                rx={8}
                fill="var(--glass-bg)"
                stroke={statusBorder}
                strokeWidth={1.5}
                filter={glowFilter}
              />
              
              {/* Small status dot indicator at the top right */}
              <circle
                cx={node.width - 16}
                cy={16}
                r={4}
                fill={active ? STEP_STATUS_COLOR[status] : '#6b7280'}
              />

              {/* Step Type Icon Chip */}
              <g transform="translate(8, 8)">
                <rect width={60} height={14} rx={7} fill="rgba(109, 148, 255, 0.1)" stroke="rgba(109, 148, 255, 0.3)" strokeWidth={1} />
                <text x={6} y={10} fill="var(--accent)" fontSize={8} fontWeight="bold">
                  {typeIcon} {type.toUpperCase()}
                </text>
              </g>

              {/* Step Key (Title) */}
              <text
                x={8}
                y={32}
                fill="#fff"
                fontSize={11}
                fontWeight={600}
                fontFamily="var(--font-mono)"
              >
                {node.id}
              </text>

              {/* Step Details (Subtitle) */}
              <text
                x={8}
                y={46}
                fill="var(--ink-mut)"
                fontSize={8}
              >
                {details.length > 20 ? `${details.slice(0, 20)}...` : details}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
