import { isOwner, isRef, isRepo, TOKEN_HEADER } from "~/github-url";

// `GET /api/github/zip`: fetches a public repository's zip from
// codeload.github.com (which sends no CORS headers, so the page cannot) and
// streams it back unchanged.
//
// One load is one request to GitHub, and only after the visitor passed a
// Turnstile challenge and a per-IP rate limit. Responses are cached at the
// edge for ten minutes, so repeat loads of a repository never reach GitHub.
// The route builds the codeload URL itself from checked names: it is not an
// open proxy.

/** The bindings this route uses; the secret is set in Cloudflare. */
type ZipEnv = {
  readonly GITHUB_LIMITER: {
    readonly limit: (options: {
      readonly key: string;
    }) => Promise<{ readonly success: boolean }>;
  };
  readonly TURNSTILE_SECRET?: string;
};

/** Workers' `fetch` options that the DOM's `RequestInit` does not declare. */
type CloudflareInit = RequestInit & {
  readonly cf?: {
    readonly cacheEverything: boolean;
    readonly cacheTtl: number;
  };
};

type Fetch = (url: string, init?: CloudflareInit) => Promise<Response>;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The page refuses bigger zips too (`MAX_ZIP_BYTES` in `zip-files.ts`). */
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const CACHE_SECONDS = 600;

const failure = (status: number, error: string): Response =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } }
  );

/** Whether Turnstile accepts the visitor's token. Fails closed. */
const verifyToken = async (
  fetcher: Fetch,
  secret: string,
  token: string,
  ip: string | null
): Promise<boolean> => {
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (ip !== null) {
    body.set("remoteip", ip);
  }
  try {
    const response = await fetcher(SITEVERIFY, { method: "POST", body });
    if (!response.ok) {
      return false;
    }
    const outcome: unknown = await response.json();
    return (
      typeof outcome === "object" &&
      outcome !== null &&
      "success" in outcome &&
      outcome.success === true
    );
  } catch {
    return false;
  }
};

/**
 * Passes `body` through, erroring the stream once it carries more than
 * `limit` bytes. The page's read then fails instead of parsing a cut zip.
 */
const capped = (
  body: ReadableStream<Uint8Array>,
  limit: number
): ReadableStream<Uint8Array> => {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          controller.error(new Error("zip over the size limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
};

/** `GET /api/github/zip?owner=&repo=[&ref=]`, the Turnstile token in a header. */
const handleZip = async (
  request: Request,
  env: ZipEnv,
  fetcher: Fetch
): Promise<Response> => {
  if (request.method !== "GET") {
    return failure(405, "only GET is supported");
  }
  const query = new URL(request.url).searchParams;
  const owner = query.get("owner") ?? "";
  const repo = query.get("repo") ?? "";
  const ref = query.get("ref") ?? "HEAD";
  if (!isOwner(owner) || !isRepo(repo) || !isRef(ref)) {
    return failure(400, "not a GitHub repository name");
  }
  const ip = request.headers.get("CF-Connecting-IP");
  const { success } = await env.GITHUB_LIMITER.limit({ key: ip ?? "unknown" });
  if (!success) {
    return failure(429, "too many repositories loaded: wait a minute");
  }
  const secret = env.TURNSTILE_SECRET;
  if (secret === undefined || secret === "") {
    return failure(503, "loading from GitHub is not set up on this server");
  }
  const token = request.headers.get(TOKEN_HEADER);
  if (token === null || token === "") {
    return failure(403, "the verification check is missing: try again");
  }
  if (!(await verifyToken(fetcher, secret, token, ip))) {
    return failure(403, "the verification check failed: try again");
  }
  const url = `https://codeload.github.com/${owner}/${repo}/zip/${ref}`;
  let upstream: Response;
  try {
    upstream = await fetcher(url, {
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
    });
  } catch {
    return failure(502, "GitHub could not be reached");
  }
  if (upstream.status === 404) {
    return failure(404, `${owner}/${repo} not found, or it is private`);
  }
  if (!upstream.ok || upstream.body === null) {
    return failure(502, `GitHub answered ${upstream.status}`);
  }
  const length = Number(upstream.headers.get("Content-Length") ?? "0");
  if (length > MAX_ZIP_BYTES) {
    return failure(413, "the repository's zip is over 64 MB");
  }
  return new Response(capped(upstream.body, MAX_ZIP_BYTES), {
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export { handleZip };
export type { Fetch, ZipEnv };
