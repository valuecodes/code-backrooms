// A GitHub repository named by the user, as pasted on the landing page or
// given as `?repo=`. Shared by the page and the Worker (`api/github-zip.ts`), which
// checks the same names again before it builds the one codeload URL it
// fetches: nothing the client sends is ever used as a URL.

/** The Worker's route that streams a repository's zip. */
const ZIP_ROUTE = "/api/github/zip";
/** The request header carrying the visitor's Turnstile token. */
const TOKEN_HEADER = "CF-Turnstile-Token";

type GitHubTarget = {
  readonly owner: string;
  readonly repo: string;
  /** A branch, tag or commit, or null for the default branch. */
  readonly ref: string | null;
  /** A folder inside the repository, `/`-separated, or null for all of it. */
  readonly subpath: string | null;
};

// GitHub's own rules: a user or organisation is up to 39 letters, digits or
// inner single hyphens; a repository up to 100 of letters, digits, `.`, `-`, `_`.
const OWNER = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// One path segment of a ref: refs with `/` cannot be told apart from the
// folder after them in a `/tree/` URL, so they are not supported.
const REF = /^[A-Za-z0-9._-]{1,100}$/;
// Folder names with spaces or other characters a URL must escape are left
// out, so the canonical form stays readable in `?repo=`.
const SEGMENT = /^[A-Za-z0-9._@+-]{1,255}$/;

const isDots = (name: string): boolean => /^\.+$/.test(name);

const isOwner = (name: string): boolean => OWNER.test(name);

const isRepo = (name: string): boolean => REPO.test(name) && !isDots(name);

const isRef = (name: string): boolean =>
  REF.test(name) &&
  !isDots(name) &&
  !name.startsWith("-") &&
  !name.includes("..") &&
  !name.endsWith(".lock");

const isSubpath = (path: string): boolean =>
  path.split("/").every((segment) => SEGMENT.test(segment) && !isDots(segment));

/** `https://github.com/o/r`, `github.com/o/r.git`, `o/r/tree/main/src` and the like. */
const parseGitHubUrl = (input: string): GitHubTarget | null => {
  let rest = input.trim().replace(/[?#].*$/, "");
  rest = rest.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^github\.com\//i.test(rest)) {
    rest = rest.slice("github.com/".length);
  } else if (rest.includes(":") || /^[^/]*\.[^/]*\//.test(rest)) {
    // Another host, or a scheme other than http(s).
    return null;
  }
  const segments = rest.split("/");
  while (segments.at(-1) === "") {
    segments.pop();
  }
  const [owner = "", rawRepo = "", kind, ref, ...folder] = segments;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!isOwner(owner) || !isRepo(repo)) {
    return null;
  }
  if (kind === undefined) {
    return { owner, repo, ref: null, subpath: null };
  }
  if (kind !== "tree" || ref === undefined || !isRef(ref)) {
    return null;
  }
  const subpath = folder.length === 0 ? null : folder.join("/");
  if (subpath !== null && !isSubpath(subpath)) {
    return null;
  }
  return { owner, repo, ref, subpath };
};

/** The shortest form that parses back to the same target, for `?repo=` and the HUD. */
const gitHubPath = ({ owner, repo, ref, subpath }: GitHubTarget): string => {
  const base = `${owner}/${repo}`;
  if (ref === null) {
    return base;
  }
  return subpath === null
    ? `${base}/tree/${ref}`
    : `${base}/tree/${ref}/${subpath}`;
};

export {
  gitHubPath,
  isOwner,
  isRef,
  isRepo,
  parseGitHubUrl,
  TOKEN_HEADER,
  ZIP_ROUTE,
};
export type { GitHubTarget };
