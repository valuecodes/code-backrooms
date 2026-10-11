import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { LocalLoadError, MAX_FILE_BYTES } from "./source-filter";
import { filesFromZip, readZipFile } from "./zip-files";

/** A zip of these texts, deflated, as GitHub's "Download ZIP" would hold them. */
const zipOf = (files: Readonly<Record<string, string>>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [
        name,
        [strToU8(text), { level: 6 }],
      ])
    )
  );

const loadError = (run: () => unknown): LocalLoadError => {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalLoadError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a LocalLoadError");
};

describe("filesFromZip", () => {
  it("reads a GitHub-shaped zip into stripped, sorted source files", () => {
    const result = filesFromZip(
      zipOf({
        "repo-main/src/b.ts": "export const b = 2;",
        "repo-main/package.json": '{ "name": "repo" }',
        "repo-main/src/a.ts": "export const a = 1;",
        "repo-main/node_modules/x/index.js": "module.exports = 1;",
        "repo-main/README.md": "# repo",
      })
    );
    expect(result).toEqual({
      files: [
        { path: "package.json", source: '{ "name": "repo" }' },
        { path: "src/a.ts", source: "export const a = 1;" },
        { path: "src/b.ts", source: "export const b = 2;" },
      ],
      skipped: 0,
    });
  });

  it("decodes UTF-8 and drops a BOM", () => {
    const { files } = filesFromZip(
      zipOf({ "r/a.ts": '﻿const greeting = "hyvää päivää";' })
    );
    expect(files).toEqual([
      { path: "a.ts", source: 'const greeting = "hyvää päivää";' },
    ]);
  });

  it("throws LocalLoadError('not a zip file') for other bytes", () => {
    expect(loadError(() => filesFromZip(strToU8("plain text"))).message).toBe(
      "not a zip file"
    );
  });

  it("passes the filter's fatal reason through as LocalLoadError", () => {
    expect(
      loadError(() => filesFromZip(zipOf({ "r/package.json": "{}" }))).message
    ).toBe("no JavaScript or TypeScript sources found");
  });

  it("counts skipped oversize files", () => {
    const result = filesFromZip(
      zipOf({ "r/big.ts": "a".repeat(MAX_FILE_BYTES + 1), "r/a.ts": "a;" })
    );
    expect(result.files.map((file) => file.path)).toEqual(["a.ts"]);
    expect(result.skipped).toBe(1);
  });

  it("refuses a zip that lists the same name twice", () => {
    const once = zipOf({ "r/a.ts": "a;" });
    const twice = zipOf({ "r/a.ts": "a;", "r/b.ts": "b;" });
    // Rename the second entry to the first in both of its headers.
    const text = strFromU8(twice, true);
    const renamed = strToU8(text.replaceAll("r/b.ts", "r/a.ts"), true);
    expect(filesFromZip(once).files).toHaveLength(1);
    expect(loadError(() => filesFromZip(renamed)).message).toBe(
      "the zip lists r/a.ts twice"
    );
  });

  it("reports an entry that fails to inflate as a damaged zip", () => {
    const bytes = zipOf({ "r/a.ts": "export const a = 1;\n".repeat(50) });
    // The entry's data starts after the 30-byte local header and its name;
    // 0xFF opens a final block of the reserved type 3, which never inflates.
    bytes[30 + "r/a.ts".length] = 0xff;
    expect(loadError(() => filesFromZip(bytes)).message).toMatch(
      /^the zip is damaged: /
    );
  });
});

describe("readZipFile", () => {
  it("reads the file's bytes", async () => {
    const bytes = zipOf({ "r/a.ts": "a;" });
    const file = new File([new Uint8Array(bytes)], "repo.zip");
    await expect(readZipFile(file)).resolves.toEqual({
      files: [{ path: "a.ts", source: "a;" }],
      skipped: 0,
    });
  });

  it("refuses a zip over 64 MB without reading it", async () => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    await expect(
      readZipFile({ size: 64 * 1024 * 1024 + 1, arrayBuffer })
    ).rejects.toThrow(
      new LocalLoadError("64.0 MB zip, more than the 64 MB allowed")
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
