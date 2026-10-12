import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { knownSource, settleFiles } from "./use-source-files";

describe("settleFiles", () => {
  it("gives the files of a load that succeeds", async () => {
    await expect(settleFiles(Promise.resolve(examples.demo))).resolves.toEqual({
      state: "loaded",
      files: examples.demo,
    });
  });

  it("turns a failed chunk load into an error, never a throw", async () => {
    const settled = await settleFiles(
      Promise.reject(new Error("chunk failed"))
    );
    expect(settled.state).toBe("failed");
    expect(settled.state === "failed" && settled.error).toContain(
      "chunk failed"
    );
  });
});

describe("knownSource", () => {
  it("has no files when nothing was asked for", () => {
    expect(knownSource({ kind: "none" })).toEqual({
      state: "loaded",
      files: null,
    });
  });

  it("has a local request's files at once", () => {
    const files = examples.demo;
    expect(
      knownSource({ kind: "local", label: "mine", files, skipped: 0 })
    ).toEqual({ state: "loaded", files });
  });

  it("has a bundled example at once and waits for self", () => {
    expect(knownSource({ kind: "example", name: "loops" })).toEqual({
      state: "loaded",
      files: examples.loops,
    });
    expect(knownSource({ kind: "example", name: "self" })).toEqual({
      state: "loading",
    });
  });
});
