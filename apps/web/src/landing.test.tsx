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
      onFolder={ignore}
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

  const GITHUB = { url: "", valid: false, ready: false };

  it("links this project's GitHub repository in a new tab", () => {
    // Still a live link while a read runs: it leaves the app.
    const html = render({ reading: "reading…" });
    expect(html).toContain(
      'href="https://github.com/valuecodes/code-backrooms" target="_blank" rel="noreferrer"'
    );
    expect(html).toContain('aria-label="Code Backrooms on GitHub"');
  });

  it("offers no zip picker, and one folder picker either way", () => {
    for (const html of [render(), render({ github: GITHUB })]) {
      expect(html).not.toContain(".zip");
      expect(html.match(/<input[^>]*webkitdirectory=""[^>]*>/g)).toHaveLength(
        1
      );
      expect(html).not.toMatch(/<input[^>]*disabled=""/);
    }
  });

  it("makes the folder the main action without a Turnstile key", () => {
    expect(render()).toContain("choose a folder");
    expect(render()).toContain("never uploaded");
    const html = render({ github: GITHUB });
    expect(html).not.toContain("choose a folder");
    expect(html).toContain("walk a local folder");
    expect(html).toContain("public repositories");
  });

  it("disables the picker, shows the status and drops the links while reading", () => {
    const html = render({ reading: "reading my-repo…" });
    expect(html).toContain("reading my-repo…");
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain('href="?');
  });

  it("darkens the backdrop while reading instead of dropping it", () => {
    const backdrop = <canvas id="drift" />;
    expect(render({ backdrop })).toContain("opacity-45");
    const html = render({ backdrop, reading: "reading my-repo…" });
    expect(html).toContain('<canvas id="drift">');
    expect(html).toContain("opacity-90");
  });

  it("draws a backdrop behind the page, hidden from screen readers", () => {
    expect(render()).not.toContain("-z-10");
    const html = render({ backdrop: <canvas id="drift" /> });
    expect(html).toMatch(
      /<div aria-hidden="true" class="absolute inset-0 -z-10"><canvas id="drift"><\/canvas>/
    );
    expect(html).toContain('href="?code=self"');
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
      reading: "downloading o/r from GitHub…",
      github: { url: "o/r", valid: true, ready: true },
    });
    expect(html).toContain("downloading o/r from GitHub…");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).not.toContain('id="check"');
  });

  it("shows a failed read's message as an alert", () => {
    const html = render({ error: "o/r not found, or it is private" });
    expect(html).toContain(
      '<p role="alert" class="text-red-300">o/r not found, or it is private</p>'
    );
  });
});
