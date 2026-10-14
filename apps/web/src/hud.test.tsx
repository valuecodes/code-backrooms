import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hud } from "./hud";

const render = (locked: boolean): string =>
  renderToStaticMarkup(
    <Hud
      locked={locked}
      seed={7}
      rooms={20}
      quality="low"
      modules={{ built: 1, total: 1 }}
      zone={null}
      lastMs={null}
      preset={null}
      label={null}
      place={null}
      breadcrumb={null}
      prompt={null}
      warnings={[]}
      notices={[]}
      error={null}
    />
  );

describe("Hud", () => {
  it("lists the quality key and the current level before walking", () => {
    const html = render(false);
    expect(html).toContain("toggle quality");
    expect(html).toContain("seed 7 · 20 rooms · quality low");
  });

  it("shows the current level while walking", () => {
    expect(render(true)).toContain("seed 7 · 20 rooms · quality low");
  });

  it("links home to the landing page only before walking", () => {
    expect(render(false)).toContain('href="/"');
    expect(render(true)).not.toContain('href="/"');
  });
});
