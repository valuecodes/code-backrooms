import type { CodeGraph } from "@repo/code-graph";
import { roomSubject, toWorldGraph } from "@repo/code-graph/world-graph";
import { buildCodeGraph } from "@repo/parser";
import type { GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";

import { examples } from "~/examples";
import type { ExampleName } from "~/examples";

// The code half of the pipeline, kept free of React so it runs under vitest:
// bundled source -> CodeGraph -> WorldGraph -> generated world.

type CodeResult =
  | { readonly codeGraph: CodeGraph; readonly error: null }
  | { readonly codeGraph: null; readonly error: string };

/** Parses a bundled example; a syntax error becomes a value, never a throw. */
const codeGraphOf = (name: ExampleName): CodeResult => {
  try {
    return { codeGraph: buildCodeGraph([examples[name]]), error: null };
  } catch (error) {
    return { codeGraph: null, error: String(error) };
  }
};

/** Lays the code graph out; the seed only changes the placement. */
const worldFromCode = (codeGraph: CodeGraph, seed: number): GeneratedWorld =>
  generateWorld({ seed, graph: toWorldGraph(codeGraph) });

/**
 * The HUD line for a room: the file for a hub, `file · Class.method()` for a
 * function, and the raw id for anything else (corridors, preset rooms).
 */
const describeRoom = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = codeGraph === null ? null : roomSubject(codeGraph, roomId);
  if (subject === null) {
    return roomId;
  }
  return subject.kind === "module"
    ? subject.module.path
    : `${subject.module.path} · ${subject.fn.qualifiedName}()`;
};

export { codeGraphOf, describeRoom, worldFromCode };
