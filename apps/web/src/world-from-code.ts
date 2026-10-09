import type { CodeGraph } from "@repo/code-graph";
import {
  portalSubject,
  roomSubject,
  toWorldGraph,
} from "@repo/code-graph/world-graph";
import { buildCodeGraph } from "@repo/parser";
import type { GeneratedWorld } from "@repo/types";
import { generateWorld } from "@repo/world-generator";
import type { Target } from "@repo/world-generator/interaction";
import type { Frame } from "@repo/world-generator/navigation";

import { examples } from "~/examples";
import type { ExampleName } from "~/examples";

// The code half of the pipeline, kept free of React so it runs under vitest:
// bundled source -> CodeGraph -> WorldGraph -> generated world, plus the
// HUD's words for rooms, the navigation stack and the thing in front of
// the player.

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

/** `Class.method()` for a function room, the path for a hub, the id otherwise. */
const labelOf = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = codeGraph === null ? null : roomSubject(codeGraph, roomId);
  if (subject === null) {
    return roomId;
  }
  return subject.kind === "module"
    ? subject.module.path
    : `${subject.fn.qualifiedName}()`;
};

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

/** `main() → login() → validateUser()`: every caller on the stack, then here. */
const breadcrumbOf = (
  codeGraph: CodeGraph | null,
  frames: readonly Frame[],
  roomId: string | null
): string | null => {
  if (codeGraph === null || roomId === null) {
    return null;
  }
  return [...frames.map((frame) => frame.callerRoomId), roomId]
    .map((id) => labelOf(codeGraph, id))
    .join(" → ");
};

/** What stepping through the thing in front of the player would do. */
const promptOf = (
  codeGraph: CodeGraph | null,
  frames: readonly Frame[],
  target: Target | null
): string | null => {
  if (target === null) {
    return null;
  }
  if (target.kind === "door") {
    return `→ ${labelOf(codeGraph, target.targetRoomId)}`;
  }
  const subject =
    codeGraph === null ? null : portalSubject(codeGraph, target.portalId);
  if (subject === null) {
    return target.portalId;
  }
  if (subject.kind === "call") {
    return `→ ${subject.callee.qualifiedName}()`;
  }
  const top = frames.at(-1);
  return `return to ${top === undefined ? subject.fn.moduleId : labelOf(codeGraph, top.callerRoomId)}`;
};

export { breadcrumbOf, codeGraphOf, describeRoom, promptOf, worldFromCode };
