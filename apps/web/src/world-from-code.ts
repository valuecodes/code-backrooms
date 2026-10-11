import type { CodeGraph } from "@repo/code-graph";
import { laneText, markerText } from "@repo/code-graph/flow-text";
import { moduleId } from "@repo/code-graph/ids";
import { generateCodeWorld } from "@repo/code-graph/module-areas";
import {
  packageOf,
  portalSubject,
  roomSubject,
} from "@repo/code-graph/subjects";
import type { RoomSubject } from "@repo/code-graph/subjects";
import { awayZone, zonedPath } from "@repo/code-graph/zone-labels";
import { buildCodeGraph, hashSource } from "@repo/parser";
import type { AreaWorld, GeneratedWorld } from "@repo/types";
import { mergeAreas } from "@repo/world-generator/areas";
import type { Target } from "@repo/world-generator/interaction";
import type { Frame } from "@repo/world-generator/navigation";

import { examples } from "~/examples";
import type { ExampleName } from "~/examples";

// The code half of the pipeline, kept free of React so it runs under vitest:
// bundled source -> CodeGraph -> WorldGraph -> generated world, plus the
// HUD's words for rooms, the navigation stack and the thing in front of
// the player.

type CodeResult =
  | {
      readonly codeGraph: CodeGraph;
      /** Each module's source by module id, for the source panel. */
      readonly sources: ReadonlyMap<string, string>;
      readonly error: null;
    }
  | { readonly codeGraph: null; readonly error: string };

/** The files of a bundled example. */
const filesOf = (name: ExampleName) => examples[name];

/** A bundled example's own seed: the same source always gives the same world. */
const sourceSeedOf = (name: ExampleName): number => hashSource(filesOf(name));

/** Parses a bundled example; a syntax error becomes a value, never a throw. */
const codeGraphOf = (name: ExampleName): CodeResult => {
  const files = filesOf(name);
  try {
    const codeGraph = buildCodeGraph(files);
    // Modules come out sorted by path, each id normalised from its path.
    const sources = new Map(
      files.map((file) => [moduleId(file.path), file.source])
    );
    return { codeGraph, sources, error: null };
  } catch (error) {
    return { codeGraph: null, error: String(error) };
  }
};

/**
 * Lays the code graph out as one area per module; a call door that does
 * not fit becomes a portal.
 */
const areasFromCode = (codeGraph: CodeGraph, seed: number): AreaWorld =>
  generateCodeWorld(codeGraph, seed);

/** The areas as one world, as the renderer and the navigator take it. */
const worldFromCode = (codeGraph: CodeGraph, seed: number): GeneratedWorld =>
  mergeAreas(areasFromCode(codeGraph, seed));

const subjectOf = (
  codeGraph: CodeGraph | null,
  roomId: string
): RoomSubject | null =>
  codeGraph === null ? null : roomSubject(codeGraph, roomId);

/**
 * `Class.method()` for a function or one of its rooms, the path for a hub
 * (inside its zone when there are several: `web · src/main.ts`), `class
 * Svc` for a lobby, the repository's name for the entrance, the package's
 * for a zone's hub, the id otherwise.
 */
const labelOf = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = subjectOf(codeGraph, roomId);
  if (codeGraph === null || subject === null) {
    return roomId;
  }
  if (subject.kind === "entrance") {
    return subject.name;
  }
  if (subject.kind === "zone") {
    return subject.zone.name;
  }
  if (subject.kind === "class") {
    return `class ${subject.node.name}`;
  }
  return subject.kind === "module"
    ? zonedPath(codeGraph, subject.module)
    : `${subject.fn.qualifiedName}()`;
};

/**
 * The HUD line for a room: the repository's name in the entrance, the
 * package's in a zone's hub, the file for a hub, `file · class Svc` for a
 * lobby, `file · Class.method()` for a function, `file · Class.method() ·
 * await fetch(…)` for a room of its flow, and the raw id for anything else
 * (corridors, preset rooms). With several zones the file is named inside
 * its zone: `web · src/main.ts · main()`.
 */
const describeRoom = (codeGraph: CodeGraph | null, roomId: string): string => {
  const subject = subjectOf(codeGraph, roomId);
  if (codeGraph === null || subject === null) {
    return roomId;
  }
  if (subject.kind === "entrance") {
    return subject.name;
  }
  if (subject.kind === "zone") {
    return subject.zone.name;
  }
  const file = zonedPath(codeGraph, subject.module);
  if (subject.kind === "module") {
    return file;
  }
  if (subject.kind === "class") {
    return `${file} · class ${subject.node.name}`;
  }
  const head = `${file} · ${subject.fn.qualifiedName}()`;
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
  if (codeGraph === null || subject === null) {
    return target.portalId;
  }
  // Into another zone, the zone's name goes first, as on the portal's wall.
  if (subject.kind === "call") {
    const { caller, callee } = subject;
    const zone = awayZone(codeGraph, caller.moduleId, callee.moduleId);
    return zone === null
      ? `→ ${callee.qualifiedName}()`
      : `→ ${zone.name} · ${callee.qualifiedName}()`;
  }
  if (subject.kind === "module") {
    const { from, module } = subject;
    const away = from === null ? null : awayZone(codeGraph, from.id, module.id);
    return `→ ${away === null ? module.path : zonedPath(codeGraph, module)}`;
  }
  if (subject.kind === "zone") {
    return `→ ${subject.zone.name}`;
  }
  // A marker leads nowhere: it names the calls the world cannot follow.
  if (subject.kind === "marker") {
    const nameOf = (id: string): string =>
      codeGraph.functions.find((fn) => fn.id === id)?.qualifiedName ?? id;
    return `closed · ${markerText(subject.sites, nameOf, (site) =>
      packageOf(codeGraph, site)
    )}`;
  }
  // A jump reads like a door within the function: `→ again?`, `→ end for`.
  if (subject.kind === "jump") {
    const there = subjectOf(codeGraph, subject.targetRoomId);
    return `→ ${there?.kind === "flow" ? there.text : subject.targetRoomId}`;
  }
  const top = frames.at(-1);
  return `return to ${top === undefined ? subject.fn.moduleId : labelOf(codeGraph, top.callerRoomId)}`;
};

export {
  areasFromCode,
  breadcrumbOf,
  codeGraphOf,
  describeRoom,
  promptOf,
  sourceSeedOf,
  worldFromCode,
};
