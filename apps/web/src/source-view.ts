import type { CodeGraph, FunctionNode, SourceSpan } from "@repo/code-graph";
import { callIndexOf } from "@repo/code-graph/call-index";
import type { CallLink } from "@repo/code-graph/call-index";
import { roomSubject } from "@repo/code-graph/subjects";

import { labelOf } from "~/world-from-code";

// The source panel's model, kept free of React so it runs under vitest: the
// code of the room the player stands in, as whole lines of its function (or
// of its file, for a hub), with the room's own code marked, and who calls
// that function and whom it calls.

/** One line of source, split around the marked part. */
type SourceLine = {
  /** 1-based. */
  readonly number: number;
  readonly before: string;
  /** Empty when the line holds none of the room's code. */
  readonly marked: string;
  readonly after: string;
};

type SourceView = {
  readonly path: string;
  /** `Class.method()`, `class Svc` for a lobby; null for a hub. */
  readonly fn: string | null;
  /** The room's HUD words (`await fetch(…)`); null for a hub or a function. */
  readonly region: string | null;
  /** `4–8`: the marked lines, else the lines shown. */
  readonly lines: string;
  readonly code: readonly SourceLine[];
  /** The function's callers, `count() ↻` for itself; none for a hub or a lobby. */
  readonly callers: readonly string[];
  /** Whom it calls, then `maybe a() | b()` per ambiguous call; cut at `+n`. */
  readonly callees: readonly string[];
};

/** Names a call list shows before it ends in `+n`. */
const CALL_LIST_MAX = 5;

const NO_CALLS: readonly string[] = [];

/** The first `CALL_LIST_MAX` entries, then how many more there are. */
const cut = (entries: readonly string[]): readonly string[] =>
  entries.length > CALL_LIST_MAX
    ? [...entries.slice(0, CALL_LIST_MAX), `+${entries.length - CALL_LIST_MAX}`]
    : entries;

/** `Class.method()` and, for a function calling itself, `↻`. */
const linkLabel = (codeGraph: CodeGraph, link: CallLink): string => {
  const label = labelOf(codeGraph, link.fn.id);
  return link.recursive ? `${label} ↻` : label;
};

const callsOf = (codeGraph: CodeGraph, fn: FunctionNode) => {
  const index = callIndexOf(codeGraph);
  const maybe = index
    .maybeCalleesOf(fn.id)
    .map(
      (group) =>
        `maybe ${group.map((candidate) => labelOf(codeGraph, candidate.id)).join(" | ")}`
    );
  return {
    callers: cut(
      index.callersOf(fn.id).map((link) => linkLabel(codeGraph, link))
    ),
    callees: cut([
      ...index.calleesOf(fn.id).map((link) => linkLabel(codeGraph, link)),
      ...maybe,
    ]),
  };
};

type Range = { readonly start: number; readonly end: number };

const lineRange = (first: number, last: number): string =>
  first === last ? String(first) : `${first}–${last}`;

/**
 * Lines `first..last` of `source` (1-based, clamped to the file), each
 * split around the part of it inside `marked`.
 */
const linesOf = (
  source: string,
  first: number,
  last: number,
  marked: Range | null
): readonly SourceLine[] => {
  const all = source.split("\n");
  // A file ending in a newline has no empty last line.
  if (all.length > 1 && all.at(-1) === "") {
    all.pop();
  }
  const lines: SourceLine[] = [];
  let offset = 0;
  for (const [index, text] of all.entries()) {
    const number = index + 1;
    if (number >= first && number <= last) {
      const from = marked === null ? 0 : marked.start - offset;
      const to = marked === null ? 0 : marked.end - offset;
      const lo = Math.max(0, Math.min(text.length, from));
      const hi = Math.max(lo, Math.min(text.length, to));
      lines.push({
        number,
        before: text.slice(0, lo),
        marked: text.slice(lo, hi),
        after: text.slice(hi),
      });
    }
    offset += text.length + 1;
  }
  return lines;
};

/** Where `span` and `within` overlap, or null when they do not. */
const clamp = (span: SourceSpan, within: SourceSpan): Range | null => {
  const start = Math.max(span.start, within.start);
  const end = Math.min(span.end, within.end);
  return start < end ? { start, end } : null;
};

/**
 * What the source panel shows for a room: the whole file for a hub, the
 * whole class for a lobby, the whole function for a function room, and the function with the room's
 * code marked for a flow room. Null for the entrance and a zone's hub (no
 * file of their own), corridors and ids not from this graph.
 */
const sourceView = (
  codeGraph: CodeGraph | null,
  sources: ReadonlyMap<string, string>,
  roomId: string | null
): SourceView | null => {
  const found =
    codeGraph === null || roomId === null
      ? null
      : roomSubject(codeGraph, roomId);
  const subject =
    found?.kind === "entrance" || found?.kind === "zone" ? null : found;
  const source = subject === null ? undefined : sources.get(subject.module.id);
  if (codeGraph === null || subject === null || source === undefined) {
    return null;
  }
  if (subject.kind === "module") {
    const code = linesOf(source, 1, Number.POSITIVE_INFINITY, null);
    return {
      path: subject.module.path,
      fn: null,
      region: null,
      lines: lineRange(1, code.length),
      code,
      callers: NO_CALLS,
      callees: NO_CALLS,
    };
  }
  if (subject.kind === "class") {
    const { span } = subject.node;
    return {
      path: subject.module.path,
      fn: `class ${subject.node.name}`,
      region: null,
      lines: lineRange(span.startLine, span.endLine),
      code: linesOf(source, span.startLine, span.endLine, null),
      callers: NO_CALLS,
      callees: NO_CALLS,
    };
  }
  const { fn } = subject;
  const head = {
    path: subject.module.path,
    fn: `${fn.qualifiedName}()`,
    ...callsOf(codeGraph, fn),
  };
  if (subject.kind === "function") {
    return {
      ...head,
      region: null,
      lines: lineRange(fn.span.startLine, fn.span.endLine),
      code: linesOf(source, fn.span.startLine, fn.span.endLine, null),
    };
  }
  const { span } = subject;
  return {
    ...head,
    region: subject.text,
    lines: lineRange(span.startLine, span.endLine),
    code: linesOf(
      source,
      fn.span.startLine,
      fn.span.endLine,
      clamp(span, fn.span)
    ),
  };
};

export { sourceView };
export type { SourceView };
