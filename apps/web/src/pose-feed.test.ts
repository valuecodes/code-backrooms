import { describe, expect, it } from "vitest";

import { createPoseFeed } from "./pose-feed";

const pose = (x: number) => ({
  position: { x, z: 0 },
  facing: { x: x + 1, z: 0 },
});

describe("createPoseFeed", () => {
  it("holds nothing until the first publish, then the latest pose", () => {
    const feed = createPoseFeed();
    expect(feed.get()).toBeNull();
    const first = pose(1);
    feed.publish(first);
    expect(feed.get()).toBe(first);
    expect(feed.get()).toBe(feed.get());
  });

  it("tells subscribers of every publish until they unsubscribe", () => {
    const feed = createPoseFeed();
    const seen: number[] = [];
    const unsubscribe = feed.subscribe(() => {
      seen.push(feed.get()?.position.x ?? -1);
    });
    feed.publish(pose(1));
    feed.publish(pose(2));
    unsubscribe();
    feed.publish(pose(3));
    expect(seen).toEqual([1, 2]);
    expect(feed.get()?.position.x).toBe(3);
  });
});
