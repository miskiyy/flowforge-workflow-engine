import type { DagStepDefinition, WorkflowDagDefinition } from '@flowforge/shared-types';
import { STEP_TYPES } from '@flowforge/shared-types';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';
import { dagToFlow, defaultStepFor, flowToDag, nextStepKey, type StepFlowNode } from './dagFlowSync.js';
import { NODE_TYPES } from './StepNode.js';
import { StepConfigPanel } from './StepConfigPanel.js';

const TYPE_LABEL: Record<DagStepDefinition['type'], string> = {
  http: 'HTTP',
  script: 'Script',
  delay: 'Delay',
  condition: 'Conditional',
};

/**
 * Visual DAG builder — drag nodes, drag between handles to set dependencies,
 * click a node to edit its fields on the right. `dag` in, `onChange(dag)`
 * out on every edit; the parent (WorkflowEditorPage) treats this exactly
 * like DagEditor's textarea, just a different input surface over the same
 * `dagText` state, so Save/AI/stale-conflict handling stays unchanged.
 */
export function DagCanvas({ dag, onChange }: { dag: WorkflowDagDefinition; onChange: (dag: WorkflowDagDefinition) => void }) {
  // Re-derived from `dag` only on mount / external replacement (e.g. AI Apply,
  // switching tabs from the JSON editor) — see the `key`-remount trick where
  // this is used in WorkflowEditorPage, which is simpler than diffing props
  // against local canvas state on every keystroke.
  const initial = useMemo(() => dagToFlow(dag), [dag]);
  const [nodes, setNodes] = useState<StepFlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function commit(nextNodes: StepFlowNode[], nextEdges: Edge[]): void {
    setNodes(nextNodes);
    setEdges(nextEdges);
    onChange(flowToDag(nextNodes, nextEdges));
  }

  function handleNodesChange(changes: NodeChange<StepFlowNode>[]): void {
    const nextNodes = applyNodeChanges(changes, nodes);
    // Position-only drags don't change the DAG shape — skip the onChange
    // round-trip so dragging a node doesn't re-stringify JSON every frame.
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (structural) {
      commit(nextNodes, edges);
    } else {
      setNodes(nextNodes);
    }
  }

  function handleEdgesChange(changes: EdgeChange[]): void {
    commit(nodes, applyEdgeChanges(changes, edges));
  }

  function handleConnect(connection: Connection): void {
    if (connection.source === connection.target) return; // no self-dependency
    commit(nodes, addEdge(connection, edges));
  }

  function addStep(type: DagStepDefinition['type']): void {
    const key = nextStepKey(nodes.map((n) => n.id));
    const newNode: StepFlowNode = {
      id: key,
      type: 'step',
      position: { x: 40, y: 40 + nodes.length * 90 },
      data: { step: defaultStepFor(type, key) },
    };
    commit([...nodes, newNode], edges);
    setSelectedId(key);
  }

  function updateSelectedStep(next: DagStepDefinition): void {
    if (!selectedId) return;
    const renamed = next.key !== selectedId;
    const nextNodes = nodes.map((n) => (n.id === selectedId ? { ...n, id: next.key, data: { step: next } } : n));
    const nextEdges = renamed
      ? edges.map((e) => ({
          ...e,
          id: e.id.replace(selectedId, next.key),
          source: e.source === selectedId ? next.key : e.source,
          target: e.target === selectedId ? next.key : e.target,
        }))
      : edges;
    commit(nextNodes, nextEdges);
    if (renamed) setSelectedId(next.key);
  }

  function deleteSelected(): void {
    if (!selectedId) return;
    commit(
      nodes.filter((n) => n.id !== selectedId),
      edges.filter((e) => e.source !== selectedId && e.target !== selectedId),
    );
    setSelectedId(null);
  }

  const selectedStep = nodes.find((n) => n.id === selectedId)?.data.step ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-3)' }}>
      <div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          {STEP_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => addStep(type)}>
              + {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <div
          style={{ height: 480, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-sunken)' }}
          data-testid="dag-canvas"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            colorMode="dark"
            fitView
          >
            <Background color="var(--border)" gap={20} />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <div>
        {selectedStep ? (
          <StepConfigPanel step={selectedStep} onChange={updateSelectedStep} onDelete={deleteSelected} />
        ) : (
          <div className="card" style={{ padding: 'var(--space-4)', color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>
            Click a step to edit it, or drag between the dots on two steps to set a dependency.
          </div>
        )}
      </div>
    </div>
  );
}
