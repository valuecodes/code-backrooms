import type { SourceFile } from "@repo/parser";

import { examples } from "~/examples";
import type { BundledName } from "~/examples";

// The programs `?code=<name>` can name: the bundled examples, and `self`,
// this repository, loaded only when asked for.

type ExampleName = BundledName | "self";

const isExampleName = (name: string): name is ExampleName =>
  name === "self" || Object.hasOwn(examples, name);

/** A bundled example's files, there from the start; null for `self`. */
const bundledFiles = (name: ExampleName): readonly SourceFile[] | null =>
  name === "self" ? null : examples[name];

/** Any example's files: `self` fetches its own chunk, and may fail to. */
const loadExample = async (name: ExampleName): Promise<readonly SourceFile[]> =>
  bundledFiles(name) ??
  import("~/self-files").then((module) => module.selfFiles);

export { bundledFiles, isExampleName, loadExample };
export type { ExampleName };
