import { beforeAll, describe, expect, it, vi } from "vitest";

import { examples } from "./examples";
import type { LoadedExample } from "./use-example-files";
import { sourceSeedOf } from "./world-from-code";
import type { WorldSetup } from "./world-setup";

describe("worldSetup", () => {
  // `world-setup` reads the URL as it loads: give it an empty one first.
  let worldSetup: (example: LoadedExample) => WorldSetup;
  beforeAll(async () => {
    vi.stubGlobal("location", { search: "" });
    ({ worldSetup } = await import("./world-setup"));
  });

  it("is a random world when no example was asked for", () => {
    const setup = worldSetup({ state: "loaded", files: null });
    expect(setup.code).toBeNull();
    expect(setup.worldOptions.codeGraph).toBeNull();
    expect(setup.worldOptions.codeError).toBeNull();
    expect(setup.areaLinks).toEqual([]);
  });

  it("parses an example and seeds the world from its source", () => {
    const setup = worldSetup({ state: "loaded", files: examples.repo });
    expect(setup.codeGraph).not.toBeNull();
    expect(setup.worldOptions.codeGraph).toBe(setup.codeGraph);
    expect(setup.startSeed).toBe(sourceSeedOf(examples.repo));
    expect(setup.areaLinks.length).toBeGreaterThan(0);
  });

  it("shows an example that failed to load as the world's error", () => {
    const setup = worldSetup({ state: "failed", error: "no chunk" });
    expect(setup.codeGraph).toBeNull();
    expect(setup.worldOptions.codeError).toBe("no chunk");
  });
});
