import { describe, expect, it } from "vitest";

import { createReadGuard, folderLabel, readErrorMessage } from "./local-reads";
import { LocalLoadError } from "./source-filter";

describe("createReadGuard", () => {
  it("lets only the latest read finish", () => {
    const guard = createReadGuard();
    const first = guard.start();
    expect(guard.isCurrent(first)).toBe(true);
    const second = guard.start();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("drops the current read once cancelled", () => {
    const guard = createReadGuard();
    const id = guard.start();
    guard.cancel();
    expect(guard.isCurrent(id)).toBe(false);
  });
});

describe("folderLabel", () => {
  it("is the picked folder's name", () => {
    expect(folderLabel([{ webkitRelativePath: "my-repo/src/a.ts" }, {}])).toBe(
      "my-repo"
    );
  });

  it("falls back when the browser gave no relative path", () => {
    expect(folderLabel([{ webkitRelativePath: "" }])).toBe("folder");
    expect(folderLabel([])).toBe("folder");
  });
});

describe("readErrorMessage", () => {
  it("shows a load error as is", () => {
    expect(readErrorMessage(new LocalLoadError("not a zip file"))).toBe(
      "not a zip file"
    );
  });

  it("explains any other failure", () => {
    expect(readErrorMessage(new Error("permission denied"))).toBe(
      "could not read the files: permission denied"
    );
  });
});
