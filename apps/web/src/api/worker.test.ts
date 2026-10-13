import { describe, expect, it, vi } from "vitest";

import type { Fetch } from "./github-zip";
import { handle } from "./worker";
import type { Env } from "./worker";

const env = (): Env => ({
  ASSETS: { fetch: vi.fn(() => Promise.resolve(new Response("asset"))) },
  GITHUB_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: true })) },
  TURNSTILE_SECRET: "secret",
});

describe("the Worker", () => {
  it("sends the zip route to its handler, not the assets", async () => {
    const bindings = env();
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(new Response("zip")));
    // No token: the route answers 403 itself without any upstream call.
    const response = await handle(
      new Request("https://backrooms.test/api/github/zip?owner=o&repo=r"),
      bindings,
      fetcher
    );
    expect(response.status).toBe(403);
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("sends every other path to the static assets", async () => {
    const bindings = env();
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(new Response("zip")));
    for (const path of ["/index.html", "/api/other", "/api/github/zip/x"]) {
      const response = await handle(
        new Request(`https://backrooms.test${path}`),
        bindings,
        fetcher
      );
      expect(await response.text()).toBe("asset");
    }
    expect(bindings.ASSETS.fetch).toHaveBeenCalledTimes(3);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
