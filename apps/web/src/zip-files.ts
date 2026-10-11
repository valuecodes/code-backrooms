import type { SourceFile } from "@repo/parser";
import { unzipSync } from "fflate";

import { LocalLoadError, selectSources } from "~/source-filter";
import type { FileEntry } from "~/source-filter";

// A zip (GitHub's "Download ZIP" or any archive) to the files of a code
// world, in memory. Only fflate's synchronous API: its async one spawns
// blob-URL workers, which the CSP's `script-src 'self'` blocks.
//
// Entry sizes come from the zip's central directory, so a crafted archive
// can lie about them. Everything runs in the user's own tab on their own
// file, so the worst case is that tab stalling.

/** Files to build a world from, and how many were too big to load. */
type LocalFiles = {
  readonly files: readonly SourceFile[];
  readonly skipped: number;
};

/** Larger zips are refused before they are read. */
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Every entry's name and uncompressed size; nothing is inflated. */
const listEntries = (bytes: Uint8Array): readonly FileEntry[] => {
  const entries: FileEntry[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries.push({ path: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch {
    throw new LocalLoadError("not a zip file");
  }
  const seen = new Set<string>();
  for (const { path } of entries) {
    // fflate would inflate both and keep the later one under that name,
    // which need not be the entry whose size was checked.
    if (seen.has(path)) {
      throw new LocalLoadError(`the zip lists ${path} twice`);
    }
    seen.add(path);
  }
  return entries;
};

/**
 * The sources and manifests of a zip, root stripped and sorted. Two passes:
 * fflate inflates an accepted entry before it sees the next, so the entries
 * are listed first and only the selected ones inflated after.
 */
const filesFromZip = (bytes: Uint8Array): LocalFiles => {
  const { kept, skipped, fatal } = selectSources(listEntries(bytes));
  if (fatal !== null) {
    throw new LocalLoadError(fatal);
  }
  const wanted = new Set(kept.map((entry) => entry.original));
  let inflated: Readonly<Record<string, Uint8Array>>;
  try {
    inflated = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch (error) {
    throw new LocalLoadError(`the zip is damaged: ${messageOf(error)}`);
  }
  const decoder = new TextDecoder("utf-8");
  const files = kept.map((entry): SourceFile => {
    const data = inflated[entry.original];
    if (data === undefined) {
      throw new LocalLoadError(
        `the zip is damaged: ${entry.original} is missing`
      );
    }
    return { path: entry.path, source: decoder.decode(data) };
  });
  return { files, skipped };
};

/** A picked or dropped zip; one over `MAX_ZIP_BYTES` is never read. */
const readZipFile = async (
  file: Pick<File, "size" | "arrayBuffer">
): Promise<LocalFiles> => {
  if (file.size > MAX_ZIP_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    throw new LocalLoadError(
      `${megabytes} MB zip, more than the 64 MB allowed`
    );
  }
  return filesFromZip(new Uint8Array(await file.arrayBuffer()));
};

export { filesFromZip, readZipFile };
export type { LocalFiles };
