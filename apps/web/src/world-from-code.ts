import type { CodeGraph } from "@repo/code-graph";
import { laneText } from "@repo/code-graph/flow-text";
import { portalSubject, roomSubject } from "@repo/code-graph/subjects";
import type { RoomSubject } from "@repo/code-graph/subjects";
import { generateCodeWorld } from "@repo/code-graph/world-graph";
import { buildCodeGraph } from "@repo/parser";
import type { GeneratedWorld } from "@repo/types";
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

/** Lays the code graph out; a call door that does not fit becomes a portal. */
const worldFromCode = (codeGraph: CodeGraph, seed: number): GeneratedWorld =>
  generateCodeWorld(codeGraph, seed);

const subjectOf = (
  codeGraph: CodeGraph | null,
  roomId: string
): RoomSubject | null =>
  codeGraph === null ? null : roomSubject(codeGraph, roomId);

/** `Class.method()` for a function or one of its rooms, the path for a hub, the id otherwise. */
const labelOf = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = subjectOf(codeGraph, roomId);
  if (subject === null) {
    return roomId;
  }
  return subject.kind === "module"
    ? subject.module.path
    : `${subject.fn.qualifiedName}()`;
};

/**
 * The HUD line for a room: the file for a hub, `file · Class.method()` for
 * a function, `file · Class.method() · await fetch(…)` for a room of its
 * flow, and the raw id for anything else (corridors, preset rooms).
 */
const describeRoom = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = subjectOf(codeGraph, roomId);
  if (subject === null) {
    return roomId;
  }
  if (subject.kind === "module") {
    return subject.module.path;
  }
  const head = `${subject.module.path} · ${subject.fn.qualifiedName}()`;
  return subject.kind === "flow" ? `${head} · ${subject.text}` : head;
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

/**
 * `→ true` / `→ case "x"` / `→ repeat` / `→ exit` into a lane, `→ await
 * load(…)` within a function, `→ getUser()` into another one.
 */
const doorPrompt = (codeGraph: CodeGraph | null, target: Target): string => {
  if (target.kind !== "door") {
    return "";
  }
  const here = subjectOf(codeGraph, target.roomId);
  const there = subjectOf(codeGraph, target.targetRoomId);
  const withinFunction =
    here?.kind === "flow" &&
    there?.kind === "flow" &&
    here.fn.id === there.fn.id;
  // Only a door walked with the flow carries its lane (`→ repeat`).
  if (withinFunction && target.lane !== undefined) {
    return `→ ${laneText(target.lane)}`;
  }
  return withinFunction
    ? `→ ${there.text}`
    : `→ ${labelOf(codeGraph, target.targetRoomId)}`;
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
    return doorPrompt(codeGraph, target);
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
