import { GraphQLScalarType, Kind, type ValueNode } from 'graphql';

/**
 * Minimal JSON scalar so `dag` can travel as a real object over GraphQL
 * instead of a stringified blob the client has to JSON.stringify/parse
 * itself. `graphql-scalars` would add a dependency for exactly this one
 * type — CLAUDE.md's "avoid unnecessary dependencies" — so it's inlined,
 * same approach the ecosystem's own JSON scalar recipe uses.
 */
function parseLiteral(node: ValueNode): unknown {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return node.values.map(parseLiteral);
    case Kind.OBJECT:
      return Object.fromEntries(node.fields.map((field) => [field.name.value, parseLiteral(field.value)]));
    default:
      return null;
  }
}

export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value — used for the workflow DAG definition.',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral,
});
