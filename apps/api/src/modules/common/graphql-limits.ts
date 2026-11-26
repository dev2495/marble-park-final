import { GraphQLError, Kind } from 'graphql';
import type { FragmentDefinitionNode, SelectionSetNode, ValidationContext } from 'graphql';

/**
 * Query size limits so one request cannot stall the API.
 *  - depth: how many levels of nested fields (screens use well under 10)
 *  - cost: number of fields asked for in total, fragments counted each time used
 * Introspection is skipped so schema tools keep working in development.
 * Limits can be raised with GRAPHQL_MAX_DEPTH and GRAPHQL_MAX_COST.
 */
export function graphqlLimitRule(context: ValidationContext) {
  const maxDepth = Number(process.env.GRAPHQL_MAX_DEPTH || 14);
  const maxCost = Number(process.env.GRAPHQL_MAX_COST || 2500);
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of context.getDocument().definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
  }

  function measure(selectionSet: SelectionSetNode | undefined, depth: number, seen: Set<string>): { depth: number; cost: number } {
    if (!selectionSet) return { depth, cost: 0 };
    let deepest = depth;
    let cost = 0;
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        if (selection.name.value.startsWith('__')) continue;
        const inner = measure(selection.selectionSet, depth + 1, seen);
        cost += 1 + inner.cost;
        deepest = Math.max(deepest, inner.depth);
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        const inner = measure(selection.selectionSet, depth, seen);
        cost += inner.cost;
        deepest = Math.max(deepest, inner.depth);
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (!fragment || seen.has(name)) continue; // cycles are reported by the standard rules
        const inner = measure(fragment.selectionSet, depth, new Set(seen).add(name));
        cost += inner.cost;
        deepest = Math.max(deepest, inner.depth);
      }
    }
    return { depth: deepest, cost };
  }

  return {
    OperationDefinition(node: any) {
      const result = measure(node.selectionSet, 0, new Set());
      if (result.depth > maxDepth) {
        context.reportError(new GraphQLError(`This request is nested too deeply (${result.depth} levels, limit ${maxDepth}).`, { nodes: [node] }));
      } else if (result.cost > maxCost) {
        context.reportError(new GraphQLError(`This request asks for too much at once (${result.cost} fields, limit ${maxCost}).`, { nodes: [node] }));
      }
    },
  };
}
