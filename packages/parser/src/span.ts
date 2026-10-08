import type { Node } from "@babel/types";
import type { SourceSpan } from "@repo/code-graph";

/**
 * Every node Babel parses carries offsets and locations; they are typed as
 * optional only because synthesised nodes may lack them. Throwing here keeps
 * the rest of the parser free of null checks.
 */
const spanOf = (node: Node): SourceSpan => {
  const { start, end, loc } = node;
  if (
    start === null ||
    start === undefined ||
    end === null ||
    end === undefined ||
    loc === null ||
    loc === undefined
  ) {
    throw new Error(`${node.type} node has no source location`);
  }
  return {
    start,
    end,
    startLine: loc.start.line,
    startColumn: loc.start.column,
    endLine: loc.end.line,
    endColumn: loc.end.column,
  };
};

const lineCountOf = (source: string): number => {
  if (source === "") {
    return 0;
  }
  let count = 1;
  for (const char of source) {
    if (char === "\n") {
      count += 1;
    }
  }
  return source.endsWith("\n") ? count - 1 : count;
};

export { lineCountOf, spanOf };
