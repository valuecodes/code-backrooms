import { describe, expect, it } from "vitest";

import { examples } from "./examples";
import { parseWorldParams } from "./params";
import {
  labelOfRequest,
  requestFromParams,
  showsLanding,
} from "./source-request";
import type { SourceRequest } from "./source-request";

const NONE: SourceRequest = { kind: "none" };
const LOCAL: SourceRequest = {
  kind: "local",
  label: "my-repo",
  files: examples.demo,
  skipped: 0,
};

describe("requestFromParams", () => {
  it("asks for the URL's example", () => {
    expect(requestFromParams(parseWorldParams("?code=self"))).toEqual({
      kind: "example",
      name: "self",
    });
  });

  it("asks for nothing without a valid example", () => {
    expect(requestFromParams(parseWorldParams(""))).toEqual(NONE);
    expect(requestFromParams(parseWorldParams("?code=bogus"))).toEqual(NONE);
  });
});

describe("showsLanding", () => {
  it("shows for a bare URL", () => {
    expect(showsLanding(NONE, "")).toBe(true);
    expect(showsLanding(NONE, "?utm=x")).toBe(true);
  });

  it.each([
    "?rooms=20",
    "?seed=5",
    "?graph=branching",
    "?code=demo",
    "?code=bogus",
    "?eager=1",
    "?view=map",
  ])("opens a world directly for %s", (search) => {
    expect(showsLanding(NONE, search)).toBe(false);
  });

  it("never shows once there is something to build", () => {
    expect(showsLanding({ kind: "example", name: "demo" }, "")).toBe(false);
    expect(showsLanding(LOCAL, "")).toBe(false);
  });
});

describe("labelOfRequest", () => {
  it("names examples and local files, not random worlds", () => {
    expect(labelOfRequest(NONE)).toBeNull();
    expect(labelOfRequest({ kind: "example", name: "loops" })).toBe("loops");
    expect(labelOfRequest(LOCAL)).toBe("my-repo");
  });
});
