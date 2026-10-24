import { areaLinksOf } from "@repo/code-graph/area-links";
import type { AreaLink } from "@repo/code-graph/area-links";
import type { SourceFile } from "@repo/parser";

import { codeGraphOf, sourceSeedOf } from "~/world-from-code";
import type { CodeResult } from "~/world-from-code";

// Everything a world setup derives from source files, as one value. A
// repository the user brought is analysed in a worker (`analyse.worker.ts`):
// parsing hundreds of files takes seconds, which would freeze the tab. The
// value crosses the worker boundary by structured clone, so it holds only
// plain data (and the `sources` Map).

type Analysis = {
  readonly code: CodeResult;
  /** The world map's links between areas; none without a graph. */
  readonly areaLinks: readonly AreaLink[];
  /** The source's own seed, or null when there is no source to hash. */
  readonly sourceSeed: number | null;
};

/** Parses `files` and derives the links and seed; never throws for bad code. */
const analyse = (
  files: readonly SourceFile[],
  { tolerant }: { readonly tolerant: boolean }
): Analysis => {
  const code = codeGraphOf(files, { tolerant });
  return {
    code,
    areaLinks: code.codeGraph === null ? [] : areaLinksOf(code.codeGraph),
    sourceSeed: sourceSeedOf(files),
  };
};

/** An analysis that could not run: shown as the world's error. */
const analysisFailed = (error: string): Analysis => ({
  code: { codeGraph: null, error },
  areaLinks: [],
  sourceSeed: null,
});

/** What the worker posts back. */
type AnalyseResponse =
  | { readonly analysis: Analysis }
  | { readonly error: string };

/** The worker's whole job: a local repository, tolerantly, never a throw. */
const respond = (files: readonly SourceFile[]): AnalyseResponse => {
  try {
    return { analysis: analyse(files, { tolerant: true }) };
  } catch (error) {
    return { error: `the repository could not be analysed: ${String(error)}` };
  }
};

export { analyse, analysisFailed, respond };
export type { AnalyseResponse, Analysis };
