# GraphQL layer

`POST /graphql` (GraphiQL enabled outside production at the same URL). Added
as the brief's bonus item, alongside the REST API rather than instead of it.

## Scope: read+operate, not a REST mirror

- **Queries**: `workflow`, `workflows`, `run`, `runs`, `stats`.
- **Mutations**: `createWorkflow`, `updateWorkflow`, `deleteWorkflow`,
  `triggerWorkflow`, `cancelRun`, `rollbackWorkflow`.
- **Deliberately REST-only**: minting/revoking a workflow's webhook token
  (`POST`/`DELETE /workflows/:id/webhook-token`). It's a one-off admin
  action, not something a GraphQL client composes into a query alongside
  other fields — adding it here would be surface area for its own sake.

## Nothing here is reimplemented

Every resolver calls the same repository functions
(`workflows/repository.ts`, `execution/repository.ts`) and the same
validation (`workflows/routes.ts`'s `validateAndGuardDag`,
`scheduling/cron.ts`'s `isValidCronExpression`) the REST routes call. One
DAG validator, one cron validator, one set of tenant-scoped queries — two
transports in front of them, not two implementations behind them.

## Auth, tenant isolation, RBAC, rate limiting

Mercurius's `context` hook does what REST's `preHandler` array
(`authenticate`, `requireWrite`, `requireAdmin` in `auth/plugin.ts`) does,
because mercurius owns `/graphql` as a single route — REST's per-route
preHandler composition doesn't apply to a single endpoint serving many
operations:

- `context` verifies the JWT itself (`request.jwtVerify()`) and consumes a
  token from the same `TokenBucketLimiter` shape REST uses (50 capacity, 25
  refill/sec, keyed by `tenantId`) — a separate bucket instance, so a
  tenant's GraphQL and REST traffic are rate-limited independently instead
  of fighting over one counter.
- Every resolver reads `tenantId` from `ctx.authUser`, exactly like REST
  reads it from `request.authUser` — never from a GraphQL argument.
- `requireWrite`/`requireAdmin` are re-checked per-mutation inside
  `resolvers.ts` (mercurius has no route-level preHandler to hang them on),
  same role rules as REST: viewer can't mutate; only admin can
  `deleteWorkflow`.

## Error shape

One error model backs both APIs. `AppError` (what every REST route throws)
converts to a `GraphQLError` carrying the same `{ code, statusCode,
details }` in its `extensions` (`resolvers.ts`'s `toGraphQLError`).
Failures that happen *before* GraphQL execution starts — an invalid/expired
JWT, an exhausted rate-limit bucket — throw from the `context` builder,
which mercurius doesn't route through its own error formatter; those are
caught by the same global `setErrorHandler` REST errors go through
(`lib/errors.ts`), so `/graphql` returns a real `401`/`429` with the
identical `{ error: { code, message } }` envelope REST uses, not a generic
200-with-`errors[]`. Failures inside a resolver (bad DAG, wrong role, not
found) use GraphQL's own convention instead: HTTP 200, `data: null`,
`errors: [...]` — that's the correct signal for "the request reached the
server and was understood, but rejected on business-logic grounds," and
matches every GraphQL client's expectations.

## What's out of scope

- **Subscriptions.** Real-time run status stays on the WebSocket gateway
  (`realtime/`) — it already exists, is tested, and a GraphQL subscription
  transport on top would be a second real-time mechanism to keep in sync
  with the first, not a improvement.
- **Field-level dataloading/batching.** No query here fans out into N+1
  patterns (each resolver is one tenant-scoped query), so a DataLoader
  layer would be complexity with nothing to solve yet.
- **`graphql-scalars`.** The one custom scalar needed (`JSON`, for the DAG
  definition) is ~20 lines using `graphql`'s own `GraphQLScalarType`
  (`scalars.ts`) — not worth a dependency.
