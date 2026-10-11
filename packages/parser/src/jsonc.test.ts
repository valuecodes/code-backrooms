import { describe, expect, it } from "vitest";

import { parseJsonc } from "./jsonc";

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc("a.json", '{"a": [1, 2], "b": null}')).toEqual({
      a: [1, 2],
      b: null,
    });
  });

  it("drops line and block comments", () => {
    const text = [
      "{",
      "  // a line comment",
      '  "a": 1, /* inline */ "b": 2,',
      "  /* a block",
      "     over lines */",
      '  "c": 3',
      "} // trailing",
    ].join("\n");
    expect(parseJsonc("a.json", text)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("keeps comment-like text and escaped quotes inside strings", () => {
    const text = String.raw`{"url": "https://x.dev/*", "q": "say \"//hi\"", "s": "a\\"}`;
    expect(parseJsonc("a.json", text)).toEqual({
      url: "https://x.dev/*",
      q: 'say "//hi"',
      s: "a\\",
    });
  });

  it("drops trailing commas in objects and arrays", () => {
    const text = '{"a": [1, 2, ], "b": {"c": 3,\n // note\n },}';
    expect(parseJsonc("a.json", text)).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it("keeps a comma inside a string before a brace", () => {
    expect(parseJsonc("a.json", '{"a": ",}"}')).toEqual({ a: ",}" });
  });

  it("names the file in a syntax error", () => {
    expect(() => parseJsonc("apps/web/tsconfig.json", "{ nope }")).toThrow(
      /^apps\/web\/tsconfig\.json: /
    );
  });
});
