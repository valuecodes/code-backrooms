import { TOKEN_HEADER, ZIP_ROUTE } from "~/github-url";
import type { GitHubTarget } from "~/github-url";
import { LocalLoadError } from "~/source-filter";
import { filesFromZip, MAX_ZIP_BYTES } from "~/zip-files";
import type { LocalFiles } from "~/zip-files";

// A public GitHub repository to the files of a code world: one request to
// this site's Worker (`api/github-zip.ts`), which fetches the repository's zip from
// GitHub, then the same zip reader as a dropped file.

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The Worker's route for `target`, relative to this site. */
const zipUrl = ({ owner, repo, ref }: GitHubTarget): string => {
  const query = new URLSearchParams({ owner, repo });
  if (ref !== null) {
    query.set("ref", ref);
  }
  return `${ZIP_ROUTE}?${query.toString()}`;
};

/** The Worker's `{ error }` message, else one for the status alone. */
const failureOf = async (response: Response): Promise<LocalLoadError> => {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return new LocalLoadError(body.error);
    }
  } catch {
    // Not the Worker's JSON: a dev server without it, or a proxy's page.
  }
  return new LocalLoadError(
    `loading from GitHub failed (${response.status}): is the Worker running?`
  );
};

/**
 * The repository's sources, under `target.subpath` when one is given.
 * `token` is the visitor's Turnstile token, used once.
 */
const readGitHubRepo = async (
  target: GitHubTarget,
  token: string,
  { fetch, signal }: { readonly fetch: Fetch; readonly signal?: AbortSignal }
): Promise<LocalFiles> => {
  let response: Response;
  try {
    response = await fetch(zipUrl(target), {
      headers: { [TOKEN_HEADER]: token },
      signal,
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    throw new LocalLoadError("could not reach this site's GitHub loader");
  }
  if (!response.ok) {
    throw await failureOf(response);
  }
  if (response.headers.get("Content-Type") !== "application/zip") {
    // Vite's dev server answers unknown paths with the app's own page.
    throw new LocalLoadError(
      "this server cannot load from GitHub: run the Worker (see the README)"
    );
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    // The Worker cuts a download off past 64 MB.
    throw new LocalLoadError(
      "the download from GitHub broke off: the zip may be over 64 MB"
    );
  }
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new LocalLoadError("the repository's zip is over 64 MB");
  }
  return filesFromZip(new Uint8Array(bytes), target.subpath);
};

export { readGitHubRepo };
