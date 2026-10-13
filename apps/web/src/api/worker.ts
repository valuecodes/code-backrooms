import { handleZip } from "~/api/github-zip";
import type { Fetch, ZipEnv } from "~/api/github-zip";
import { ZIP_ROUTE } from "~/github-url";

// The Cloudflare Worker in front of the static app, named by `main` in
// `wrangler.jsonc`. `run_worker_first` sends it only `/api/*`; everything
// else is served from the static assets without running it. Routes live
// beside this file, one per module.

/** The bindings `wrangler.jsonc` declares. */
type Env = ZipEnv & {
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
};

/** The API's routes, else the static assets. */
const handle = (
  request: Request,
  env: Env,
  fetcher: Fetch
): Promise<Response> =>
  new URL(request.url).pathname === ZIP_ROUTE
    ? handleZip(request, env, fetcher)
    : env.ASSETS.fetch(request);

export default {
  fetch: (request: Request, env: Env): Promise<Response> =>
    handle(request, env, (url, init) => fetch(url, init)),
};

export { handle };
export type { Env };
