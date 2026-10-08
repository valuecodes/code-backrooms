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

export { childrenOf };
