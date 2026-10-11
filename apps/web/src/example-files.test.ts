import { describe, expect, it } from "vitest";

import { bundledFiles, isExampleName, loadExample } from "./example-files";
import { examples } from "./examples";
import { selfFiles } from "./self-files";

describe("isExampleName", () => {
  it("knows the bundled examples and self", () => {
    expect(isExampleName("demo")).toBe(true);
    expect(isExampleName("repo")).toBe(true);
    expect(isExampleName("self")).toBe(true);
  });

  it("rejects anything else, prototype keys included", () => {
    expect(isExampleName("nope")).toBe(false);
    expect(isExampleName("constructor")).toBe(false);
    expect(isExampleName("Self")).toBe(false);
  });
});

describe("bundledFiles", () => {
  it("has a bundled example's files up front, never self's", () => {
    expect(bundledFiles("demo")).toBe(examples.demo);
    expect(bundledFiles("self")).toBeNull();
  });
});

describe("loadExample", () => {
  it("resolves a bundled example to its files", async () => {
    await expect(loadExample("repo")).resolves.toBe(examples.repo);
  });

  it("loads self from its own module", async () => {
    await expect(loadExample("self")).resolves.toBe(selfFiles);
  });
});
