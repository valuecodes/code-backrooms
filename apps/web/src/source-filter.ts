import { isManifest } from "@repo/parser";

// Which files of a zip or a picked folder become the code world, decided from
// paths and sizes alone, before anything is inflated or read. One table of
// rules, applied in a fixed order: metadata out, the common root stripped,
// then the ignore and extension rules, then the caps.

type FileEntry = {
  readonly path: string;
  /** Uncompressed bytes. */
  readonly size: number;
};

/** A kept file: `path` stripped and normalised, `original` as it was given. */
type KeptEntry = FileEntry & { readonly original: string };

type Selection = {
  /** Sorted by `path` in code-unit order; empty when `fatal` is set. */
  readonly kept: readonly KeptEntry[];
  /** Files over `MAX_FILE_BYTES`, left out. Ignored files are not counted. */
  readonly skipped: number;
  /** Why nothing can be loaded, shown to the user as is. */
  readonly fatal: string | null;
};

/** A zip or folder that cannot be loaded; the message is shown as is. */
class LocalLoadError extends Error {
  override readonly name = "LocalLoadError";
}

const MAX_FILE_BYTES = 256 * 1024;
const MAX_KEPT_FILES = 400;
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const IGNORED_FILE = /\.(?:test|spec)\.|\.d\.[mc]?ts$|\.min\.js$/;
const METADATA_FILES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db"]);
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "generated",
  "vendor",
  "__tests__",
  "__mocks__",
  "__snapshots__",
]);

/** Dot-directories (`.git`, `.next`, `..`) and the build and test folders. */
const isIgnoredDir = (segment: string): boolean =>
  segment.startsWith(".") || IGNORED_DIRS.has(segment);

/** `\` to `/`, without a leading `./` or `/`. */
const normalise = (path: string): string =>
  path.replaceAll("\\", "/").replace(/^(?:\.?\/)+/, "");

type Named = {
  readonly segments: readonly string[];
  readonly entry: FileEntry;
};

/** A file, not a directory entry or OS metadata. */
const isContent = ({ segments }: Named): boolean => {
  const base = segments.at(-1) ?? "";
  return (
    base !== "" && !METADATA_FILES.has(base) && !segments.includes("__MACOSX")
  );
};

/**
 * The one first segment every file sits under (a GitHub zip's `repo-main/`,
 * a picked folder's name), or null. Files under a top-level ignored
 * directory do not count, so a stray `node_modules/` beside the root does not
 * hide it; when that leaves nothing, every file counts.
 */
const commonRoot = (files: readonly Named[]): string | null => {
  const counted = files.filter(
    ({ segments }) => !isIgnoredDir(segments[0] ?? "")
  );
  const pool = counted.length === 0 ? files : counted;
  const first = pool[0]?.segments[0];
  if (first === undefined) {
    return null;
  }
  const shared = pool.every(
    ({ segments }) => segments.length >= 2 && segments[0] === first
  );
  return shared ? first : null;
};

/** A source or manifest outside every ignored directory. */
const isWanted = (segments: readonly string[]): boolean => {
  const base = segments.at(-1) ?? "";
  if (segments.slice(0, -1).some(isIgnoredDir) || IGNORED_FILE.test(base)) {
    return false;
  }
  return SOURCE_EXTENSION.test(base) || isManifest(segments.join("/"));
};

const byPath = (a: KeptEntry, b: KeptEntry): number => {
  if (a.path === b.path) {
    return 0;
  }
  return a.path < b.path ? -1 : 1;
};

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** The fatal reason for what survived the rules, or null when it loads. */
const fatalOf = (kept: readonly KeptEntry[]): string | null => {
  if (kept.length > MAX_KEPT_FILES) {
    return `${kept.length} files to load, more than the ${MAX_KEPT_FILES} allowed: load a subfolder`;
  }
  const bytes = kept.reduce((sum, entry) => sum + entry.size, 0);
  if (bytes > MAX_KEPT_BYTES) {
    return `${megabytes(bytes)} MB of sources, more than the ${megabytes(MAX_KEPT_BYTES)} MB allowed: load a subfolder`;
  }
  if (kept.every((entry) => isManifest(entry.path))) {
    return "no JavaScript or TypeScript sources found";
  }
  return null;
};

/** The files to load out of a zip's entries or a folder's files. */
const selectSources = (entries: readonly FileEntry[]): Selection => {
  const files = entries
    .map((entry) => ({ segments: normalise(entry.path).split("/"), entry }))
    .filter(isContent);
  const root = commonRoot(files);
  const candidates = files
    .map(({ segments, entry }) => ({
      segments:
        root !== null && segments[0] === root ? segments.slice(1) : segments,
      entry,
    }))
    .filter(({ segments }) => isWanted(segments))
    .map(({ segments, entry }): KeptEntry => ({
      path: segments.join("/"),
      size: entry.size,
      original: entry.path,
    }))
    .toSorted(byPath);
  const kept: KeptEntry[] = [];
  let skipped = 0;
  let previous: string | null = null;
  // The sort is stable: of a repeated path, the first entry given decides.
  for (const entry of candidates) {
    if (entry.path === previous) {
      continue;
    }
    previous = entry.path;
    if (entry.size > MAX_FILE_BYTES) {
      skipped += 1;
    } else {
      kept.push(entry);
    }
  }
  const fatal = fatalOf(kept);
  return { kept: fatal === null ? kept : [], skipped, fatal };
};

export {
  LocalLoadError,
  MAX_FILE_BYTES,
  MAX_KEPT_BYTES,
  MAX_KEPT_FILES,
  selectSources,
};
export type { FileEntry, KeptEntry };
