import type { CodeGraph, SourceSpan } from "@repo/code-graph";
import { roomSubject } from "@repo/code-graph/subjects";

// The source panel's model, kept free of React so it runs under vitest: the
// code of the room the player stands in, as whole lines of its function (or
// of its file, for a hub), with the room's own code marked.

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
  /** `Class.method()`; null for a hub. */
  readonly fn: string | null;
  /** The room's HUD words (`await fetch(…)`); null for a hub or a function. */
  readonly region: string | null;
  /** `4–8`: the marked lines, else the lines shown. */
  readonly lines: string;
  readonly code: readonly SourceLine[];
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
 * whole function for a function room, and the function with the room's
 * code marked for a flow room. Null for the entrance (no file of its
 * own), corridors and ids not from this graph.
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
  const subject = found?.kind === "entrance" ? null : found;
  const source = subject === null ? undefined : sources.get(subject.module.id);
  if (subject === null || source === undefined) {
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
    };
  }
  const { fn } = subject;
  const head = {
    path: subject.module.path,
    fn: `${fn.qualifiedName}()`,
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
