import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingView } from "./landing";

const ignore = () => undefined;

const render = (
  state: {
    reading?: string | null;
    error?: string | null;
    backdrop?: ReactNode;
  } = {}
): string =>
  renderToStaticMarkup(
    <LandingView
      reading={state.reading ?? null}
      error={state.error ?? null}
      dragging={false}
      onZip={ignore}
      onFolder={ignore}
      onDragging={ignore}
      backdrop={state.backdrop}
    />
  );

describe("LandingView", () => {
  it("links the demo and the bundled examples", () => {
    const html = render();
    expect(html).toContain('data-state="landing"');
    expect(html).toContain('href="?code=self"');
    for (const name of ["demo", "loops", "switches", "repo"]) {
      expect(html).toContain(`href="?code=${name}"`);
    }
  });

  it("offers a zip picker and a folder picker", () => {
    const html = render();
    expect(html).toContain('accept=".zip,application/zip"');
    expect(html).toMatch(/<input[^>]*webkitdirectory=""[^>]*>/);
    expect(html).not.toContain('disabled=""');
  });

  it("disables both pickers and drops the links while reading", () => {
    const html = render({ reading: "repo-main.zip" });
    expect(html).toContain("reading repo-main.zip…");
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain("href=");
  });

  it("draws a backdrop behind the page, hidden from screen readers", () => {
    expect(render()).not.toContain("aria-hidden");
    const html = render({ backdrop: <canvas id="drift" /> });
    expect(html).toMatch(
      /<div aria-hidden="true" class="absolute inset-0 -z-10"><canvas id="drift"><\/canvas>/
    );
    expect(html).toContain('href="?code=self"');
  });

  it("says that nothing is uploaded", () => {
    expect(render()).toContain("nothing is uploaded");
  });

  it("shows a failed read's message as an alert", () => {
    const html = render({ error: "not a zip file" });
    expect(html).toContain(
      '<p role="alert" class="text-red-300">not a zip file</p>'
    );
  });
});
