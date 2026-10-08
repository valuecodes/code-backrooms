import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { childrenOf } from "./walk";

describe("childrenOf", () => {
  it("returns child nodes in source order and skips scalars", () => {
    const ast = parse("foo(a, b);\nlet x = 1;", { sourceType: "module" });
    const program = childrenOf(ast);
    expect(program.map((node) => node.type)).toEqual(["Program"]);
    const statements = childrenOf(program[0] ?? ast);
    expect(statements.map((node) => node.type)).toEqual([
      "ExpressionStatement",
      "VariableDeclaration",
    ]);
    const call = childrenOf(statements[0] ?? ast)[0];
    expect(call?.type).toBe("CallExpression");
    expect(childrenOf(call ?? ast).map((node) => node.type)).toEqual([
      "Identifier",
      "Identifier",
      "Identifier",
    ]);
  });
});
