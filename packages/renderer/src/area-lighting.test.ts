import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { createAreaLighting, lightmapTexture } from "./area-lighting";
import type { BakedLightmap, BakeJob } from "./bake";
import type { BakeDone, BakeQueue } from "./bake-client";
import { areaOf, testRoom } from "./test-rooms";

/** A queue the test finishes by hand. */
const fakeQueue = () => {
  const jobs: { job: BakeJob; onDone: BakeDone; cancelled: boolean }[] = [];
  let disposed = 0;
  const queue: BakeQueue = {
    request: (job, onDone) => {
      const entry = { job, onDone, cancelled: false };
      jobs.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    dispose: () => {
      disposed += 1;
    },
  };
  const finish = (index: number, lightmap: BakedLightmap | null) => {
    const entry = jobs[index];
    if (entry !== undefined && !entry.cancelled) {
      entry.onDone(lightmap);
    }
  };
  return { queue, jobs, finish, disposed: () => disposed };
};

const bakedFor = (job: BakeJob): BakedLightmap => ({
  width: job.layout.width,
  height: job.layout.height,
  data: new Uint16Array(job.layout.width * job.layout.height * 4),
});

const shared = () => {
  const lightMap = lightmapTexture(new Uint16Array(4), 1, 1);
  return {
    lightMap,
    wall: new MeshStandardMaterial({ vertexColors: true, lightMap }),
    floor: new MeshStandardMaterial({ lightMap }),
    ceiling: new MeshStandardMaterial({ lightMap }),
  };
};

const A = areaOf(testRoom("a", 0, 0, 4, 4));
const B = areaOf(testRoom("b", 10, 0, 4, 4));

describe("createAreaLighting", () => {
  it("lights a new area with the placeholder at once and the bake later", () => {
    const surfaces = shared();
    const fake = fakeQueue();
    const store = createAreaLighting(surfaces, fake.queue);
    const lighting = store.get(A);
    expect(lighting.floor).not.toBe(surfaces.floor);
    expect(lighting.floor.lightMap).toBe(surfaces.lightMap);
    store.sync([A]);
    expect(fake.jobs).toHaveLength(1);
    const job = fake.jobs[0]?.job;
    expect(job?.lights).toHaveLength(1);
    if (job === undefined) {
      return;
    }
    fake.finish(0, bakedFor(job));
    expect(lighting.floor.lightMap).not.toBe(surfaces.lightMap);
    expect(lighting.wall.lightMap).toBe(lighting.floor.lightMap);
    // The shared materials keep the placeholder.
    expect(surfaces.floor.lightMap).toBe(surfaces.lightMap);
  });

  it("keeps every program-relevant setting of the shared materials", () => {
    const surfaces = shared();
    const fake = fakeQueue();
    const store = createAreaLighting(surfaces, fake.queue);
    const lighting = store.get(A);
    store.sync([A]);
    const job = fake.jobs[0]?.job;
    if (job !== undefined) {
      fake.finish(0, bakedFor(job));
    }
    for (const key of ["wall", "floor", "ceiling"] as const) {
      const clone = lighting[key];
      const original = surfaces[key];
      expect(clone.defines).toEqual(original.defines);
      expect(clone.vertexColors).toBe(original.vertexColors);
      const baked = clone.lightMap;
      const placeholder = original.lightMap;
      expect(baked).not.toBeNull();
      expect(baked?.channel).toBe(1);
      expect(baked?.channel).toBe(placeholder?.channel);
      expect(baked?.type).toBe(placeholder?.type);
      expect(baked?.format).toBe(placeholder?.format);
      expect(baked?.colorSpace).toBe(placeholder?.colorSpace);
    }
  });

  it("asks once per area, however often it syncs", () => {
    const fake = fakeQueue();
    const store = createAreaLighting(shared(), fake.queue);
    store.sync([A]);
    store.sync([A, B]);
    store.sync([A, B]);
    expect(fake.jobs).toHaveLength(2);
  });

  it("cancels and drops an area that left; a new generation bakes anew", () => {
    const fake = fakeQueue();
    const store = createAreaLighting(shared(), fake.queue);
    const old = store.get(A);
    store.sync([A]);
    const regenerated = areaOf(testRoom("a", 0, 0, 4, 4));
    store.sync([regenerated]);
    expect(fake.jobs[0]?.cancelled).toBe(true);
    expect(fake.jobs).toHaveLength(2);
    expect(store.get(regenerated)).not.toBe(old);
  });

  it("keeps the placeholder for an area past the budget", () => {
    const surfaces = shared();
    const fake = fakeQueue();
    const sizeA = createAreaLighting(shared(), fakeQueue().queue).get(A).layout;
    const store = createAreaLighting(
      surfaces,
      fake.queue,
      sizeA.width * sizeA.height
    );
    store.sync([A, B]);
    expect(fake.jobs).toHaveLength(1);
    expect(store.get(B).floor.lightMap).toBe(surfaces.lightMap);
  });

  it("gives back a failed bake's budget and keeps the placeholder", () => {
    const surfaces = shared();
    const fake = fakeQueue();
    const size = createAreaLighting(shared(), fakeQueue().queue).get(A).layout;
    const store = createAreaLighting(
      surfaces,
      fake.queue,
      size.width * size.height
    );
    store.sync([A]);
    fake.finish(0, null);
    expect(store.get(A).floor.lightMap).toBe(surfaces.lightMap);
    store.sync([B]);
    expect(fake.jobs).toHaveLength(2);
  });

  it("re-queues unfinished bakes after dispose, keeping the same lighting", () => {
    const surfaces = shared();
    const fake = fakeQueue();
    const store = createAreaLighting(surfaces, fake.queue);
    const lighting = store.get(A);
    store.sync([A]);
    store.dispose();
    expect(fake.jobs[0]?.cancelled).toBe(true);
    expect(fake.disposed()).toBe(1);
    store.sync([A]);
    expect(store.get(A)).toBe(lighting);
    expect(fake.jobs).toHaveLength(2);
    const job = fake.jobs[1]?.job;
    if (job !== undefined) {
      fake.finish(1, bakedFor(job));
    }
    expect(lighting.floor.lightMap).not.toBe(surfaces.lightMap);
  });
});
