import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { settleFiles } from "./use-example-files";

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
