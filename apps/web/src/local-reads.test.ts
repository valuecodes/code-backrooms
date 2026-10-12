import { describe, expect, it } from "vitest";

import {
  createReadGuard,
  folderLabel,
  isZipName,
  readErrorMessage,
  zipLabel,
} from "./local-reads";
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

describe("zip names", () => {
  it("accepts .zip in any case and nothing else", () => {
    expect(isZipName("repo-main.zip")).toBe(true);
    expect(isZipName("A.ZIP")).toBe(true);
    expect(isZipName("a.zip.txt")).toBe(false);
    expect(isZipName("notes.txt")).toBe(false);
  });

  it("labels a zip by its name without the extension", () => {
    expect(zipLabel("repo-main.zip")).toBe("repo-main");
    expect(zipLabel("A.ZIP")).toBe("A");
    expect(zipLabel(".zip")).toBe(".zip");
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
