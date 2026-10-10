import { parseFlowNodeId } from "@repo/code-graph/ids";
import { describe, expect, it } from "vitest";

import { sourceView } from "./source-view";
import { codeGraphOf, promptOf, worldFromCode } from "./world-from-code";

/** The repo example, parsed, or the test fails with the parser's message. */
const parsed = () => {
  const result = codeGraphOf("repo");
  if (result.codeGraph === null) {
    throw new Error(`repo: ${result.error}`);
  }
  return result;
};

const ownerOf = (roomId: string): string =>
  parseFlowNodeId(roomId)?.functionId ?? roomId;

describe("the repo example", () => {
  const { codeGraph, sources } = parsed();
  const world = worldFromCode(codeGraph, 1);
  const prompt = (portalId: string) =>
    promptOf(codeGraph, [], { kind: "portal", portalId });

  it("has a module per file, sorted by path", () => {
    expect(codeGraph.modules.map((module) => module.id)).toEqual([
      "src/config.ts",
      "src/handlers/auth.ts",
      "src/handlers/index.ts",
      "src/handlers/render.ts",
      "src/index.ts",
      "src/server.ts",
      "src/util/log.ts",
    ]);
  });

  it("follows calls across files with call portals", () => {
    const crossing = (world.graph.portals ?? [])
      .filter((portal) => portal.kind === "call")
      .map((portal) => [ownerOf(portal.from), portal.to, prompt(portal.id)])
      .filter(([from, to]) => from?.split("::")[0] !== to?.split("::")[0]);
    expect(crossing).toEqual(
      expect.arrayContaining([
        ["src/index.ts::main", "src/server.ts::startServer", "→ startServer()"],
        ["src/server.ts::startServer", "src/util/log.ts::log", "→ log()"],
        [
          "src/server.ts::startServer",
          "src/handlers/auth.ts::handleRequest",
          "→ handleRequest()",
        ],
        [
          "src/server.ts::startServer",
          "src/handlers/render.ts::render",
          "→ render()",
        ],
        [
          "src/handlers/auth.ts::handleRequest",
          "src/handlers/render.ts::render",
          "→ render()",
        ],
      ])
    );
  });

  it("names the package call and leaves the unknown receiver closed", () => {
    const prompts = world.built.portals
      .filter(({ portal }) => portal.kind === "marker")
      .map(({ portal }) => prompt(portal.id));
    expect(prompts).toContain(
      'closed · console.log(…) external, format(…) package "node:util"'
    );
    expect(prompts).toContain("closed · session.refresh(…) unresolved");
  });

  it("shows each module's own source", () => {
    expect(sources.get("src/server.ts")).toContain(
      "export function startServer"
    );
    const view = sourceView(codeGraph, sources, "src/server.ts::startServer");
    expect(view?.path).toBe("src/server.ts");
    const text = view?.code
      .map((line) => `${line.before}${line.marked}${line.after}`)
      .join("\n");
    expect(text).toContain("handleRequest(request);");
  });
});
