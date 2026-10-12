import { LocalLoadError } from "~/source-filter";

// The landing page's reads of a zip or folder, as pure helpers.

/**
 * One read at a time: each read takes an id, and only the latest one may
 * finish. `File.text()` and `unzipSync` cannot be aborted, so a read the page
 * moved on from (or unmounted during) is dropped when it ends instead.
 */
type ReadGuard = {
  readonly start: () => number;
  readonly isCurrent: (id: number) => boolean;
  readonly cancel: () => void;
};

const createReadGuard = (): ReadGuard => {
  let current = 0;
  return {
    start: () => {
      current += 1;
      return current;
    },
    isCurrent: (id) => id === current,
    cancel: () => {
      current += 1;
    },
  };
};

const ZIP = /\.zip$/i;

/** Drag and drop takes zips only; the folder picker covers folders. */
const isZipName = (name: string): boolean => ZIP.test(name);

/** `repo-main.zip` → `repo-main`, for the HUD. */
const zipLabel = (name: string): string => name.replace(ZIP, "") || name;

/** A folder pick's name: the first segment of any file's relative path. */
const folderLabel = (
  files: readonly { readonly webkitRelativePath?: string }[]
): string => {
  const [first] = files;
  const name = first?.webkitRelativePath?.split("/")[0];
  return name === undefined || name === "" ? "folder" : name;
};

/** What the landing page shows for a read that failed. */
const readErrorMessage = (error: unknown): string => {
  if (error instanceof LocalLoadError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `could not read the files: ${message}`;
};

export { createReadGuard, folderLabel, isZipName, readErrorMessage, zipLabel };
export type { ReadGuard };
