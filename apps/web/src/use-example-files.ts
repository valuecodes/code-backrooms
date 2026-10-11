import type { SourceFile } from "@repo/parser";
import { useEffect, useMemo, useState } from "react";

import { bundledFiles, loadExample } from "~/example-files";
import type { ExampleName } from "~/example-files";

/** An example's files once known; `files` is null when none was asked for. */
type LoadedExample =
  | { readonly state: "loaded"; readonly files: readonly SourceFile[] | null }
  | { readonly state: "failed"; readonly error: string };

type ExampleFiles = LoadedExample | { readonly state: "loading" };

const LOADING: ExampleFiles = { state: "loading" };

/** A load as a value: a failed chunk fetch becomes an error, never a throw. */
const settleFiles = (
  pending: Promise<readonly SourceFile[]>
): Promise<LoadedExample> =>
  pending.then(
    (files) => ({ state: "loaded", files }),
    (error: unknown) => ({
      state: "failed",
      error: `The example could not be loaded: ${String(error)}`,
    })
  );

/** What is known before anything loads: everything but `self`. */
const knownFiles = (name: ExampleName | null): ExampleFiles => {
  if (name === null) {
    return { state: "loaded", files: null };
  }
  const files = bundledFiles(name);
  return files === null ? LOADING : { state: "loaded", files };
};

/**
 * The files of the example `name`: a bundled one on the first render, `self`
 * once its chunk arrives. Stable between renders, so a world built from it
 * is built once.
 */
const useExampleFiles = (name: ExampleName | null): ExampleFiles => {
  const known = useMemo(() => knownFiles(name), [name]);
  const [loaded, setLoaded] = useState<{
    readonly name: ExampleName;
    readonly files: LoadedExample;
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

  return loaded?.name === name ? loaded.files : known;
};

export { settleFiles, useExampleFiles };
export type { LoadedExample };
