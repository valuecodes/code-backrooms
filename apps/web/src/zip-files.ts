import type { SourceFile } from "@repo/parser";
import { unzipSync } from "fflate";

import { LocalLoadError, selectSources } from "~/source-filter";
import type { FileEntry } from "~/source-filter";

// A GitHub repository's zip (`github-files.ts`) to the files of a code
// world, in memory. Only fflate's synchronous API: its async one spawns
// blob-URL workers, which the CSP's `script-src 'self'` blocks.
//
// Entry sizes come from the zip's central directory, so a crafted archive
// can lie about them. Everything runs in the visitor's own tab, so the worst
// case is that tab stalling.

/** Files to build a world from, and how many were too big to load. */
type LocalFiles = {
  readonly files: readonly SourceFile[];
  readonly skipped: number;
};

/** Larger zips are refused before they are read; `api/github-zip.ts` caps them too. */
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
 * The entries under `subpath` inside the zip's one top folder (a GitHub
 * zip's `repo-sha/`), renamed relative to it, each mapped to its real name.
 */
const underSubpath = (
  entries: readonly FileEntry[],
  subpath: string
): { readonly entries: FileEntry[]; readonly names: Map<string, string> } => {
  const top = entries[0]?.path.split("/")[0] ?? "";
  const prefix = `${top}/${subpath}/`;
  const names = new Map<string, string>();
  const inside: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.path.startsWith(prefix) && entry.path.length > prefix.length) {
      const path = entry.path.slice(prefix.length);
      names.set(path, entry.path);
      inside.push({ path, size: entry.size });
    }
  }
  if (inside.length === 0) {
    throw new LocalLoadError(`no folder ${subpath} in the repository`);
  }
  return { entries: inside, names };
};

/**
 * The sources and manifests of a zip, root stripped and sorted, only those
 * under `subpath` when one is given. Two passes: fflate inflates an accepted
 * entry before it sees the next, so the entries are listed first and only
 * the selected ones inflated after.
 */
const filesFromZip = (
  bytes: Uint8Array,
  subpath: string | null = null
): LocalFiles => {
  const listed = listEntries(bytes);
  const scoped =
    subpath === null
      ? { entries: listed, names: null }
      : underSubpath(listed, subpath);
  const { kept, skipped, fatal } = selectSources(scoped.entries);
  if (fatal !== null) {
    throw new LocalLoadError(fatal);
  }
  // The name each kept entry has inside the zip.
  const nameOf = (original: string): string =>
    scoped.names?.get(original) ?? original;
  const wanted = new Set(kept.map((entry) => nameOf(entry.original)));
  let inflated: Readonly<Record<string, Uint8Array>>;
  try {
    inflated = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch (error) {
    throw new LocalLoadError(`the zip is damaged: ${messageOf(error)}`);
  }
  const decoder = new TextDecoder("utf-8");
  const files = kept.map((entry): SourceFile => {
    const name = nameOf(entry.original);
    const data = inflated[name];
    if (data === undefined) {
      throw new LocalLoadError(`the zip is damaged: ${name} is missing`);
    }
    return { path: entry.path, source: decoder.decode(data) };
  });
  return { files, skipped };
};

export { filesFromZip, MAX_ZIP_BYTES };
export type { LocalFiles };
