import { describe, expect, it, vi } from "vitest";

import { handleZip as handle } from "./github-zip";
import type { Fetch, ZipEnv } from "./github-zip";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const env = (overrides: Partial<ZipEnv> = {}): ZipEnv => ({
  GITHUB_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: true })) },
  TURNSTILE_SECRET: "secret",
  ...overrides,
});

/** Turnstile answers `verified`; codeload answers `zip`. */
const upstream = (
  zip: () => Response,
  verified = true
): ReturnType<typeof vi.fn<Fetch>> =>
  vi.fn<Fetch>((url) =>
    Promise.resolve(
      url === SITEVERIFY ? Response.json({ success: verified }) : zip()
    )
  );

const zipRequest = (
  query: string,
  headers: Record<string, string> = { "CF-Turnstile-Token": "token" }
): Request =>
  new Request(`https://backrooms.test/api/github/zip?${query}`, {
    headers: { "CF-Connecting-IP": "203.0.113.7", ...headers },
  });

const codeloadCalls = (fetcher: ReturnType<typeof vi.fn<Fetch>>): string[] =>
  fetcher.mock.calls
    .map(([url]) => url)
    .filter((url) => url.startsWith("https://codeload.github.com/"));

const errorOf = async (response: Response): Promise<unknown> =>
  ((await response.json()) as { error: unknown }).error;

describe("the GitHub zip route", () => {
  it("fetches one zip from codeload, cached, and streams it back", async () => {
    const fetcher = upstream(() => new Response(new Uint8Array([1, 2, 3])));
    const response = await handle(
      zipRequest("owner=pmndrs&repo=zustand&ref=v4.0.0"),
      env(),
      fetcher
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(codeloadCalls(fetcher)).toEqual([
      "https://codeload.github.com/pmndrs/zustand/zip/v4.0.0",
    ]);
    const codeloadInit = fetcher.mock.calls.find(([url]) =>
      url.startsWith("https://codeload")
    )?.[1];
    expect(codeloadInit?.cf).toEqual({ cacheEverything: true, cacheTtl: 600 });
  });

  it("uses HEAD without a ref", async () => {
    const fetcher = upstream(() => new Response("zip"));
    await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(codeloadCalls(fetcher)).toEqual([
      "https://codeload.github.com/o/r/zip/HEAD",
    ]);
  });

  it("sends the secret, token and visitor IP to Turnstile", async () => {
    const fetcher = upstream(() => new Response("zip"));
    await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    const body = fetcher.mock.calls.find(([url]) => url === SITEVERIFY)?.[1]
      ?.body;
    expect(body instanceof FormData ? Object.fromEntries(body) : body).toEqual({
      secret: "secret",
      response: "token",
      remoteip: "203.0.113.7",
    });
  });

  it.each([
    "owner=o",
    "owner=o&repo=r&ref=..",
    "owner=o&repo=r&ref=a%2Fb",
    "owner=o%2F..&repo=r",
    "owner=o&repo=..",
    "owner=o&repo=r%3Fx%3D1",
    "owner=evil.com&repo=r",
  ])("refuses %s before contacting anyone", async (query) => {
    const fetcher = upstream(() => new Response("zip"));
    const limiter = env();
    const response = await handle(zipRequest(query), limiter, fetcher);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(limiter.GITHUB_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("refuses a request without a token, never reaching GitHub", async () => {
    const fetcher = upstream(() => new Response("zip"));
    const response = await handle(
      zipRequest("owner=o&repo=r", {}),
      env(),
      fetcher
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a token Turnstile rejects, never reaching GitHub", async () => {
    const fetcher = upstream(() => new Response("zip"), false);
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(403);
    expect(codeloadCalls(fetcher)).toEqual([]);
  });

  it("fails closed when Turnstile cannot be reached", async () => {
    const fetcher = vi.fn<Fetch>(() => Promise.reject(new Error("offline")));
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses when no secret is configured", async () => {
    const fetcher = upstream(() => new Response("zip"));
    const response = await handle(
      zipRequest("owner=o&repo=r"),
      env({ TURNSTILE_SECRET: undefined }),
      fetcher
    );
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rate-limits by visitor IP before verifying anything", async () => {
    const fetcher = upstream(() => new Response("zip"));
    const limited = env({
      GITHUB_LIMITER: {
        limit: vi.fn(() => Promise.resolve({ success: false })),
      },
    });
    const response = await handle(
      zipRequest("owner=o&repo=r"),
      limited,
      fetcher
    );
    expect(response.status).toBe(429);
    expect(limited.GITHUB_LIMITER.limit).toHaveBeenCalledWith({
      key: "203.0.113.7",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says a missing repository is not found or private", async () => {
    const fetcher = upstream(() => new Response("", { status: 404 }));
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("o/r not found, or it is private");
  });

  it("passes other GitHub failures on as 502", async () => {
    const fetcher = upstream(() => new Response("", { status: 503 }));
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(502);
  });

  it("refuses a zip whose length is over 64 MB", async () => {
    const fetcher = upstream(
      () =>
        new Response("zip", {
          headers: { "Content-Length": String(64 * 1024 * 1024 + 1) },
        })
    );
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(413);
  });

  it("breaks off a zip without a length once it passes 64 MB", async () => {
    const chunk = new Uint8Array(16 * 1024 * 1024);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const fetcher = upstream(() => new Response(endless));
    const response = await handle(zipRequest("owner=o&repo=r"), env(), fetcher);
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(sent).toBeLessThanOrEqual(6);
  });

  it("allows GET only", async () => {
    const fetcher = upstream(() => new Response("zip"));
    const response = await handle(
      new Request("https://backrooms.test/api/github/zip?owner=o&repo=r", {
        method: "POST",
      }),
      env(),
      fetcher
    );
    expect(response.status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
