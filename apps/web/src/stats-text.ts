import type { RenderSample } from "@repo/renderer/stats";

/** `420`, `184k`, `1.2M`: short enough to read while walking. */
const shortCount = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${Math.round(count / 1000)}k`;
  }
  return String(count);
};

/**
 * `312 draws · 184k tris · 420 geo · 36 tex · 9 areas · 16.7 ms/frame`, or
 * the areas alone before the first sample.
 */
const statsText = (sample: RenderSample | null, areas: number): string => {
  const built = areas === 1 ? "1 area" : `${areas} areas`;
  if (sample === null) {
    return built;
  }
  return [
    `${shortCount(sample.calls)} draws`,
    `${shortCount(sample.triangles)} tris`,
    `${shortCount(sample.geometries)} geo`,
    `${shortCount(sample.textures)} tex`,
    built,
    `${sample.frameMs.toFixed(1)} ms/frame`,
  ].join(" · ");
};

export { statsText };
