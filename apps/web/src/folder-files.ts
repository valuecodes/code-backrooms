import type { SourceFile } from "@repo/parser";

import { LocalLoadError, selectSources } from "~/source-filter";
import type { LocalFiles } from "~/zip-files";

// A folder picked with `<input type="file" webkitdirectory>` to the files of
// a code world. Paths and sizes decide what is kept before any file is read.

/** What the reader needs of a picked `File`; Node's `File` lacks `webkitRelativePath`. */
type PickedFile = Pick<File, "name" | "size" | "text"> & {
  readonly webkitRelativePath?: string;
};

/** The path inside the picked folder, its name included, else the bare name. */
const pathOf = (file: PickedFile): string =>
  file.webkitRelativePath === undefined || file.webkitRelativePath === ""
    ? file.name
    : file.webkitRelativePath;

/** The sources and manifests of a folder pick, root stripped and sorted; only those are read. */
const filesFromFolder = async (
  picked: readonly PickedFile[]
): Promise<LocalFiles> => {
  const byPath = new Map(picked.map((file) => [pathOf(file), file]));
  const { kept, skipped, fatal } = selectSources(
    [...byPath].map(([path, file]) => ({ path, size: file.size }))
  );
  if (fatal !== null) {
    throw new LocalLoadError(fatal);
  }
  const files = await Promise.all(
    kept.map(async (entry): Promise<SourceFile> => {
      const file = byPath.get(entry.original);
      if (file === undefined) {
        throw new Error(`No picked file for ${entry.original}`);
      }
      return { path: entry.path, source: await file.text() };
    })
  );
  return { files, skipped };
};

export { filesFromFolder };
