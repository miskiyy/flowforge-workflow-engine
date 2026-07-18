import type { DagStepDefinition, WorkflowDagDefinition } from '@flowforge/shared-types';
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dagToFlow, defaultStepFor, flowToDag, nextStepKey, type StepFlowNode } from './dagFlowSync.js';
import { NODE_TYPES } from './StepNode.js';
import { StepConfigPanel } from './StepConfigPanel.js';

export type DagBuilderTab = 'edit' | 'json' | 'ai';

/**
 * Visual DAG builder. The canvas (left) is always visible — drag nodes,
 * drag between handles to set dependencies. The right column is a tab
 * strip: "Edit" (this component's own per-node config panel), "JSON" and
 * "AI Generate" render whatever the caller passes in (DagEditor and
 * ProposePanel), kept CSS-hidden rather than unmounted when inactive so
 * neither panel loses its own internal state when you switch tabs.
 *
 * `resetToken` replaces this component's own nodes/edges from `dag` via an
 * effect (not a `key`-remount) specifically so an external dag replacement
 * (AI Apply, loading an existing workflow) never unmounts `jsonPanel`/
 * `aiPanel` — they're rendered *inside* this component's tree, and a
 * `key`-based remount would wipe ProposePanel's just-set result out from
 * under it at the exact moment Apply calls back in to replace the dag.
 */
export function DagCanvas({
  dag,
  onChange,
  activeTab,
  onTabChange,
  resetToken,
  jsonPanel,
  aiPanel,
}: {
  dag: WorkflowDagDefinition;
  onChange: (dag: WorkflowDagDefinition) => void;
  activeTab: DagBuilderTab;
  onTabChange: (tab: DagBuilderTab) => void;
  resetToken: number;
  jsonPanel: ReactNode;
  aiPanel: ReactNode;
}) {
  // Lazy initializers — dagToFlow only needs to run once, on mount.
  const [nodes, setNodes] = useState<StepFlowNode[]>(() => dagToFlow(dag).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => dagToFlow(dag).edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastResetToken = useRef(resetToken);

  useEffect(() => {
    if (resetToken === lastResetToken.current) return;
    lastResetToken.current = resetToken;
    const fresh = dagToFlow(dag);
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setSelectedId(null);
    // Only `resetToken` changing should trigger this — `dag` is read fresh
    // from the ref-captured closure at that moment, not tracked itself, or
    // every canvas-originated edit (which also changes `dag` via onChange)
    // would immediately stomp its own in-progress node positions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

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
    onTabChange('edit');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Top Row: Task Selection Palette */}
      <div className="card" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'bold', color: 'var(--ink-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tasks:</div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={() => addStep('http')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: 'var(--text-xs)' }}
            >
              <span>🌐</span> HTTP Request
            </button>
            <button
              type="button"
              onClick={() => addStep('script')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: 'var(--text-xs)' }}
            >
              <span>⌨️</span> Script Run
            </button>
            <button
              type="button"
              onClick={() => addStep('delay')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: 'var(--text-xs)' }}
            >
              <span>⏱️</span> Wait Delay
            </button>
            <button
              type="button"
              onClick={() => addStep('condition')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: 'var(--text-xs)' }}
            >
              <span>◇</span> Condition
            </button>
          </div>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', fontStyle: 'italic' }}>
          "Build pipelines with drag and drop precision."
        </div>
      </div>

      {/* Bottom Row: Canvas (Left) and Configuration Panel (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-4)', alignItems: 'stretch' }}>
        {/* Canvas Section */}
        <div
          style={{ height: 600, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-sunken)', position: 'relative' }}
          data-testid="dag-canvas"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              onTabChange('edit');
            }}
            onPaneClick={() => setSelectedId(null)}
            colorMode="dark"
            fitView
          >
            <Background color="var(--border)" gap={20} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right Properties/Configuration Side */}
        <div>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-3)', width: '100%' }}>
            <button
              type="button"
              style={{
                flex: 1,
                borderRadius: 'var(--radius) var(--radius) 0 0',
                border: 'none',
                borderBottom: activeTab === 'edit' ? '2px solid var(--accent)' : 'none',
                background: activeTab === 'edit' ? 'var(--surface-high)' : 'transparent',
                color: activeTab === 'edit' ? 'var(--ink)' : 'var(--ink-mut)',
                padding: '10px 0',
                fontWeight: activeTab === 'edit' ? 'bold' : 'normal',
              }}
              onClick={() => onTabChange('edit')}
              aria-pressed={activeTab === 'edit'}
            >
              Task
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                borderRadius: 'var(--radius) var(--radius) 0 0',
                border: 'none',
                borderBottom: activeTab === 'ai' ? '2px solid var(--accent)' : 'none',
                background: activeTab === 'ai' ? 'var(--surface-high)' : 'transparent',
                color: activeTab === 'ai' ? 'var(--ink)' : 'var(--ink-mut)',
                padding: '10px 0',
                fontWeight: activeTab === 'ai' ? 'bold' : 'normal',
              }}
              onClick={() => onTabChange('ai')}
              aria-pressed={activeTab === 'ai'}
            >
              Generate AI
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                borderRadius: 'var(--radius) var(--radius) 0 0',
                border: 'none',
                borderBottom: activeTab === 'json' ? '2px solid var(--accent)' : 'none',
                background: activeTab === 'json' ? 'var(--surface-high)' : 'transparent',
                color: activeTab === 'json' ? 'var(--ink)' : 'var(--ink-mut)',
                padding: '10px 0',
                fontWeight: activeTab === 'json' ? 'bold' : 'normal',
              }}
              onClick={() => onTabChange('json')}
              aria-pressed={activeTab === 'json'}
            >
              JSON
            </button>
          </div>

          <div style={{ display: activeTab === 'edit' ? 'block' : 'none' }}>
            {selectedStep ? (
              <StepConfigPanel step={selectedStep} onChange={updateSelectedStep} onDelete={deleteSelected} />
            ) : (
              <div className="card" style={{ padding: 'var(--space-4)', color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>
                Click a step to edit it, or drag between the dots on two steps to set a dependency.
              </div>
            )}
          </div>
          <div style={{ display: activeTab === 'json' ? 'block' : 'none' }}>{jsonPanel}</div>
          <div style={{ display: activeTab === 'ai' ? 'block' : 'none' }}>{aiPanel}</div>
        </div>
      </div>
    </div>
  );
}
