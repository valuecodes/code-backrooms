import type { SourceFile } from "@repo/parser";
import { useEffect, useMemo, useState } from "react";

import { bundledFiles, loadExample } from "~/example-files";
import type { ExampleName } from "~/example-files";
import type { SourceRequest } from "~/source-request";

/** A request's files once known; `files` is null when none was asked for. */
type LoadedSource =
  | { readonly state: "loaded"; readonly files: readonly SourceFile[] | null }
  | { readonly state: "failed"; readonly error: string };

type SourceFiles = LoadedSource | { readonly state: "loading" };

const LOADING: SourceFiles = { state: "loading" };

/** A load as a value: a failed chunk fetch becomes an error, never a throw. */
const settleFiles = (
  pending: Promise<readonly SourceFile[]>
): Promise<LoadedSource> =>
  pending.then(
    (files) => ({ state: "loaded", files }),
    (error: unknown) => ({
      state: "failed",
      error: `The example could not be loaded: ${String(error)}`,
    })
  );

/** What is known before anything loads: everything but `self`. */
const knownSource = (request: SourceRequest): SourceFiles => {
  if (request.kind === "none") {
    return { state: "loaded", files: null };
  }
  if (request.kind === "local") {
    return { state: "loaded", files: request.files };
  }
  const files = bundledFiles(request.name);
  return files === null ? LOADING : { state: "loaded", files };
};

/**
 * The files of `request`: local files and bundled examples on the first
 * render, `self` once its chunk arrives. Stable between renders, so a world
 * built from it is built once.
 */
const useSourceFiles = (request: SourceRequest): SourceFiles => {
  const known = useMemo(() => knownSource(request), [request]);
  const name = request.kind === "example" ? request.name : null;
  const [loaded, setLoaded] = useState<{
    readonly name: ExampleName;
    readonly files: LoadedSource;
  } | null>(null);

  useEffect(() => {
    // A load that ends after the page moved on is dropped.
    let cancelled = false;
    if (known.state === "loading" && name !== null) {
      void settleFiles(loadExample(name)).then((files) => {
        if (!cancelled) {
          setLoaded({ name, files });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [name, known]);

  return name !== null && loaded?.name === name ? loaded.files : known;
};

export { knownSource, settleFiles, useSourceFiles };
export type { LoadedSource };
