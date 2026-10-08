import { isNode, VISITOR_KEYS } from "@babel/types";
import type { Node } from "@babel/types";

/**
 * Direct child nodes in Babel's visitor-key order, which follows the source
 * for everything this parser cares about (statement lists, class bodies,
 * declarator lists, call arguments). Scalars and nulls are skipped.
 */
const childrenOf = (node: Node): readonly Node[] => {
  const record = node as unknown as Record<string, unknown>;
  const children: Node[] = [];
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item);
        }
      }
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
};

/**
 * Deeper than any real program nests, shallower than the call stack: the
 * walkers refuse pathological input with a clear error instead of a
 * RangeError from somewhere inside.
 */
const MAX_DEPTH = 1500;

const guardDepth = (depth: number): void => {
  if (depth > MAX_DEPTH) {
    throw new Error(`source is nested more than ${MAX_DEPTH} levels deep`);
  }
};

export { childrenOf, guardDepth };
