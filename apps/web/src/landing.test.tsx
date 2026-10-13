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
    github?: { url: string; valid: boolean; ready: boolean };
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
      github={
        state.github === undefined
          ? undefined
          : {
              ...state.github,
              onUrl: ignore,
              onOpen: ignore,
              check: <div id="check" />,
            }
      }
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

  it("has no GitHub field when the build has no Turnstile key", () => {
    expect(render()).not.toContain("GitHub repository URL");
  });

  it("offers a GitHub URL field whose open waits for the check", () => {
    const empty = render({ github: { url: "", valid: false, ready: false } });
    expect(empty).toContain('aria-label="GitHub repository URL"');
    expect(empty).toMatch(/<button type="submit"[^>]*disabled=""/);
    // The check (and Turnstile's script) only once the URL is valid.
    expect(empty).not.toContain('id="check"');
    expect(empty).not.toContain("a public repository");

    const typed = render({ github: { url: "o/r", valid: true, ready: false } });
    expect(typed).toContain('value="o/r"');
    expect(typed).toContain('id="check"');

    const ready = render({ github: { url: "o/r", valid: true, ready: true } });
    expect(ready).not.toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it("explains what to type instead of loading the check for a bad URL", () => {
    const html = render({ github: { url: "o", valid: false, ready: false } });
    expect(html).toContain("a public repository: github.com/owner/repo");
    expect(html).not.toContain('id="check"');
  });

  it("disables the GitHub field and hides the check while reading", () => {
    const html = render({
      reading: "o/r",
      github: { url: "o/r", valid: true, ready: true },
    });
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).not.toContain('id="check"');
  });

  it("shows a failed read's message as an alert", () => {
    const html = render({ error: "not a zip file" });
    expect(html).toContain(
      '<p role="alert" class="text-red-300">not a zip file</p>'
    );
  });
});
