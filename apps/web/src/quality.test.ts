import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUALITY,
  parseQuality,
  readQuality,
  toggleQuality,
  writeQuality,
} from "./quality";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

const throwingStorage = () => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
});

describe("parseQuality", () => {
  it("accepts only the two levels", () => {
    expect(parseQuality("low")).toBe("low");
    expect(parseQuality("high")).toBe("high");
    expect(parseQuality("ultra")).toBeNull();
    expect(parseQuality("")).toBeNull();
    expect(parseQuality(null)).toBeNull();
  });
});

describe("readQuality", () => {
  it("falls back to the default without a stored value", () => {
    expect(readQuality(memoryStorage())).toBe(DEFAULT_QUALITY);
    expect(readQuality(null)).toBe(DEFAULT_QUALITY);
  });

  it("ignores garbage", () => {
    const storage = memoryStorage();
    storage.setItem("quality", "medium");
    expect(readQuality(storage)).toBe(DEFAULT_QUALITY);
  });

  it("reads a stored level", () => {
    const storage = memoryStorage();
    storage.setItem("quality", "low");
    expect(readQuality(storage)).toBe("low");
  });

  it("falls back when storage throws", () => {
    expect(readQuality(throwingStorage())).toBe(DEFAULT_QUALITY);
  });
});

describe("writeQuality", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    writeQuality(storage, "low");
    expect(readQuality(storage)).toBe("low");
  });

  it("swallows a throwing storage", () => {
    expect(() => writeQuality(throwingStorage(), "low")).not.toThrow();
    expect(() => writeQuality(null, "low")).not.toThrow();
  });
});

describe("toggleQuality", () => {
  it("flips between the two levels", () => {
    expect(toggleQuality("high")).toBe("low");
    expect(toggleQuality("low")).toBe("high");
  });
});
