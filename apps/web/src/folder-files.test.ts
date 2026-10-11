import { describe, expect, it, vi } from "vitest";

import { filesFromFolder } from "./folder-files";
import { LocalLoadError } from "./source-filter";

/** A picked file whose `text()` is a spy. */
const picked = (webkitRelativePath: string, source: string, name?: string) => ({
  name: name ?? webkitRelativePath.split("/").at(-1) ?? "",
  size: source.length,
  webkitRelativePath,
  text: vi.fn(() => Promise.resolve(source)),
});

describe("filesFromFolder", () => {
  it("reads a folder pick by webkitRelativePath, root stripped", async () => {
    const files = [
      picked("my-app/src/main.ts", "main();"),
      picked("my-app/package.json", '{ "name": "my-app" }'),
    ];
    await expect(filesFromFolder(files)).resolves.toEqual({
      files: [
        { path: "package.json", source: '{ "name": "my-app" }' },
        { path: "src/main.ts", source: "main();" },
      ],
      skipped: 0,
    });
  });

  it("falls back to name without a relative path", async () => {
    const { files } = await filesFromFolder([
      picked("", "a();", "a.ts"),
      { name: "b.ts", size: 4, text: () => Promise.resolve("b();") },
    ]);
    expect(files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("reads only the kept files", async () => {
    const kept = picked("app/src/a.ts", "a();");
    const ignored = picked("app/node_modules/x/index.js", "x();");
    const test = picked("app/src/a.test.ts", "test();");
    await filesFromFolder([kept, ignored, test]);
    expect(kept.text).toHaveBeenCalledOnce();
    expect(ignored.text).not.toHaveBeenCalled();
    expect(test.text).not.toHaveBeenCalled();
  });

  it("throws LocalLoadError when nothing is left", async () => {
    const readme = picked("app/README.md", "# app");
    await expect(filesFromFolder([readme])).rejects.toThrow(
      new LocalLoadError("no JavaScript or TypeScript sources found")
    );
    expect(readme.text).not.toHaveBeenCalled();
  });
});
