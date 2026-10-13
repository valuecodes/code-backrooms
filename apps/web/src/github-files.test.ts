import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { readGitHubRepo } from "./github-files";
import type { GitHubTarget } from "./github-url";
import { LocalLoadError } from "./source-filter";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const zipOf = (files: Readonly<Record<string, string>>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, strToU8(text)])
    )
  );

const zipResponse = (bytes: Uint8Array): Response =>
  new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/zip" },
  });

const REPO: GitHubTarget = {
  owner: "o",
  repo: "r",
  ref: null,
  subpath: null,
};

const GITHUB_ZIP = zipOf({
  "r-0123abc/package.json": '{ "name": "r" }',
  "r-0123abc/src/a.ts": "export const a = 1;",
  "r-0123abc/packages/p/src/b.ts": "export const b = 2;",
});

const failureMessage = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LocalLoadError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected a LocalLoadError");
};

describe("readGitHubRepo", () => {
  it("makes one request to the Worker with the token, then reads the zip", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(zipResponse(GITHUB_ZIP)));
    const result = await readGitHubRepo({ ...REPO, ref: "main" }, "token", {
      fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/github/zip?owner=o&repo=r&ref=main");
    expect(init?.headers).toEqual({ "CF-Turnstile-Token": "token" });
    expect(result.files.map((file) => file.path)).toEqual([
      "package.json",
      "packages/p/src/b.ts",
      "src/a.ts",
    ]);
  });

  it("leaves the ref out for the default branch", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(zipResponse(GITHUB_ZIP)));
    await readGitHubRepo(REPO, "token", { fetch });
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/github/zip?owner=o&repo=r");
  });

  it("reads only the files under a subpath, relative to it", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(zipResponse(GITHUB_ZIP)));
    const { files } = await readGitHubRepo(
      { ...REPO, subpath: "packages/p" },
      "token",
      { fetch }
    );
    expect(files).toEqual([{ path: "b.ts", source: "export const b = 2;" }]);
  });

  it("names a subpath the repository does not have", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(zipResponse(GITHUB_ZIP)));
    expect(
      await failureMessage(
        readGitHubRepo({ ...REPO, subpath: "nope" }, "token", { fetch })
      )
    ).toBe("no folder nope in the repository");
  });

  it("shows the Worker's error message", async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json(
          { error: "o/r not found, or it is private" },
          { status: 404 }
        )
      )
    );
    expect(await failureMessage(readGitHubRepo(REPO, "t", { fetch }))).toBe(
      "o/r not found, or it is private"
    );
  });

  it("explains a failure without the Worker's JSON", async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(new Response("Bad Gateway", { status: 502 }))
    );
    expect(await failureMessage(readGitHubRepo(REPO, "t", { fetch }))).toBe(
      "loading from GitHub failed (502): is the Worker running?"
    );
  });

  it("refuses a page that is not a zip, as Vite's dev server sends", async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response("<!doctype html>", {
          headers: { "Content-Type": "text/html" },
        })
      )
    );
    expect(await failureMessage(readGitHubRepo(REPO, "t", { fetch }))).toMatch(
      /^this server cannot load from GitHub/
    );
  });

  it("reports a download that broke off", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("cut"));
      },
    });
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response(broken, { headers: { "Content-Type": "application/zip" } })
      )
    );
    expect(await failureMessage(readGitHubRepo(REPO, "t", { fetch }))).toBe(
      "the download from GitHub broke off: the zip may be over 64 MB"
    );
  });

  it("reports an unreachable site as a load error", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.reject(new TypeError("offline")));
    expect(await failureMessage(readGitHubRepo(REPO, "t", { fetch }))).toBe(
      "could not reach this site's GitHub loader"
    );
  });

  it("passes an abort through as is", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<Fetch>(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    await expect(
      readGitHubRepo(REPO, "t", { fetch, signal: controller.signal })
    ).rejects.not.toBeInstanceOf(LocalLoadError);
  });
});
