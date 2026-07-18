import dagre from '@dagrejs/dagre';
import type { WorkflowDagDefinition } from '@flowforge/shared-types';

/**
 * Auto-layout via dagre (per the architecture doc: don't hand-roll graph
 * layout) — layered left-to-right for sequential flow, siblings stacked
 * vertically for parallel branches, computed from the same `dependsOn`
 * adjacency list the backend topo-sorts.
 */
export const NODE_WIDTH = 140;
export const NODE_HEIGHT = 60;

export interface GraphNodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdgeLayout {
  id: string;
  from: string;
  to: string;
  points: { x: number; y: number }[];
}

export interface GraphLayout {
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
  width: number;
  height: number;
}

export function computeLayout(dag: WorkflowDagDefinition): GraphLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const step of dag.steps) {
    g.setNode(step.key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const step of dag.steps) {
    for (const dep of step.dependsOn) {
      g.setEdge(dep, step.key);
    }
  }

  dagre.layout(g);

  const nodes: GraphNodeLayout[] = g.nodes().map((id) => {
    const node = g.node(id);
    return { id, x: node.x, y: node.y, width: node.width, height: node.height };
  });

  const edges: GraphEdgeLayout[] = g.edges().map((edge) => ({
    id: `${edge.v}->${edge.w}`,
    from: edge.v,
    to: edge.w,
    points: g.edge(edge).points,
  }));

  const graphLabel = g.graph();
  return {
    nodes,
    edges,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}
