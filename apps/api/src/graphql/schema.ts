/**
 * Deliberately a read+operate surface, not a 1:1 mirror of every REST route.
 * Webhook-token minting/revocation stays REST-only (see graphql/README.md) —
 * everything a dashboard or external client needs day-to-day is here.
 */
export const typeDefs = `
  scalar JSON

  enum RunStatus {
    pending
    running
    succeeded
    failed
    timed_out
    cancelled
  }

  type WorkflowVersion {
    id: ID!
    workflowId: ID!
    versionNumber: Int!
    dag: JSON!
    createdBy: ID!
    createdAt: String!
  }

  type Workflow {
    id: ID!
    name: String!
    currentVersionId: ID
    cronExpression: String
    webhookToken: String
    createdAt: String!
  }

  type WorkflowPage {
    items: [Workflow!]!
    nextCursor: String
  }

  type Run {
    id: ID!
    workflowId: ID!
    workflowVersionId: ID!
    triggerType: String!
    triggeredBy: String
    status: RunStatus!
    startedAt: String
    finishedAt: String
    createdAt: String!
  }

  type RunPage {
    items: [Run!]!
    nextCursor: String
  }

  type Stats24h {
    total: Int!
    succeeded: Int!
    failed: Int!
    successRate: Float
    avgDurationMs: Float
  }

  type Stats {
    activeRuns: Int!
    last24h: Stats24h!
  }

  type Query {
    workflow(id: ID!): Workflow
    workflows(cursor: String, limit: Int, name: String): WorkflowPage!
    run(id: ID!): Run
    runs(cursor: String, limit: Int, status: RunStatus, workflowId: ID): RunPage!
    stats: Stats!
  }

  type Mutation {
    "Editor or admin."
    createWorkflow(name: String!, dag: JSON!, cronExpression: String): Workflow!
    "Editor or admin. Omit cronExpression to leave it unchanged; pass null to clear it."
    updateWorkflow(id: ID!, name: String, dag: JSON, cronExpression: String, baseVersionId: ID): Workflow!
    "Admin only."
    deleteWorkflow(id: ID!): Boolean!
    "Editor or admin."
    triggerWorkflow(id: ID!): Run!
    "Editor or admin."
    cancelRun(id: ID!): Run!
    "Editor or admin."
    rollbackWorkflow(id: ID!, versionId: ID!): Workflow!
  }
`;
