import type { BuiltArea, WorldGraph } from "@repo/types";
import { describe, expect, it } from "vitest";

import { checkAreas } from "./area-checks";
import { createAreaStore } from "./area-store";
import type { AreaSpec } from "./area-store";
import { assembleAreas } from "./areas";
import { LayoutError } from "./layout";
import { areaGraphs } from "./portal-world";
import { generateWorld } from "./world-generator";

/**
 * The three test areas plus a fourth hub that the second one also leads
 * to, so two areas can be reached from a built one at the same time.
 */
const graphs: readonly (readonly [string, WorldGraph])[] = [
  ...areaGraphs.map(([id, graph]): readonly [string, WorldGraph] =>
    id === "two"
      ? [
          id,
          {
            ...graph,
            portals: [
              ...(graph.portals ?? []),
              {
                id: "module:hub2>hub4",
                kind: "module",
                from: "hub2",
                to: "hub4",
              },
            ],
            external: [...(graph.external ?? []), "hub4"],
          },
        ]
      : [id, graph]
  ),
  [
    "four",
    {
      rooms: [{ id: "hub4", width: 6, depth: 6, hub: true }],
      connections: [],
      portals: [
        { id: "module:hub4>hub", kind: "module", from: "hub4", to: "hub" },
      ],
      external: ["hub"],
    },
  ],
];

const specsOf = (
  seed: number,
  calls?: Map<string, number>
): readonly AreaSpec[] =>
  graphs.map(([id, graph]) => ({
    id,
    units: graph.rooms.map((room) => room.id),
    generate: () => {
      calls?.set(id, (calls.get(id) ?? 0) + 1);
      return generateWorld({ seed, graph, corridorPrefix: `${id}/corridor-` });
    },
  }));

const storeOf = (seed = 1, calls?: Map<string, number>) =>
  createAreaStore({ seed, entry: "one", specs: specsOf(seed, calls) });

const ids = (areas: readonly BuiltArea[]) => areas.map((area) => area.id);

/** Room positions with the area's offset taken away. */
const untranslated = (area: BuiltArea | undefined) =>
  area?.layout.rooms.map((room) => [
    room.id,
    room.position[0] - area.offset.x,
    room.position[2] - area.offset.z,
  ]);

/** Every order of ensures a player could cause: only areas a built one leads to. */
const walks = (
  built: readonly string[],
  pending: readonly string[],
  leadsTo: ReadonlyMap<string, readonly string[]>
): string[][] => {
  if (pending.length === 0) {
    return [[]];
  }
  const reachable = pending.filter((id) =>
    built.some((from) => leadsTo.get(from)?.includes(id) === true)
  );
  return reachable.flatMap((next) =>
    walks(
      [...built, next],
      pending.filter((id) => id !== next),
      leadsTo
    ).map((rest) => [next, ...rest])
  );
};

describe("createAreaStore", () => {
  it("starts with the entry only and knows the area of every unit", () => {
    const { world, errors, lastMs } = storeOf().snapshot();
    expect(ids(world.areas)).toEqual(["one"]);
    expect(world.pending).toEqual(["two", "three", "four"]);
    expect(world.areaOf.get("work")).toBe("two");
    expect(world.areaOf.get("hub4")).toBe("four");
    expect(errors.size).toBe(0);
    expect(lastMs).toBeNull();
    expect(checkAreas(world)).toEqual([]);
  });

  it("keeps the snapshot until something changes and generates once", () => {
    const calls = new Map<string, number>();
    const store = storeOf(1, calls);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.snapshot();
    expect(store.snapshot()).toBe(before);
    const first = store.ensure("two");
    const grown = store.snapshot();
    expect(grown).not.toBe(before);
    expect(grown.lastMs).toBeGreaterThanOrEqual(0);
    expect(store.ensure("two")).toEqual(first);
    expect(store.snapshot()).toBe(grown);
    expect(calls.get("two")).toBe(1);
    expect(notified).toBe(1);
    expect(grown.world.pending).toEqual(["three", "four"]);
  });

  it("keeps every area it has by identity when it grows", () => {
    const store = storeOf();
    const [one] = store.snapshot().world.areas;
    store.ensure("two");
    const [same, two] = store.snapshot().world.areas;
    expect(same).toBe(one);
    expect(same?.built.rooms).toBe(one?.built.rooms);
    expect(two?.id).toBe("two");
  });

  it("places areas as the eager assembly does in the same order", () => {
    const store = storeOf(3);
    store.ensure("two");
    const parts = specsOf(3)
      .filter((spec) => spec.id === "one" || spec.id === "two")
      .map((spec) => ({ id: spec.id, world: spec.generate() }));
    expect(store.snapshot().world.areas).toEqual(
      assembleAreas(3, "one", parts).areas
    );
  });

  it("matches the eager assembly once every area is ensured", () => {
    const store = storeOf(2);
    store.ensureAll();
    const parts = specsOf(2).map((spec) => ({
      id: spec.id,
      world: spec.generate(),
    }));
    const { world } = store.snapshot();
    const eager = assembleAreas(2, "one", parts);
    expect(world.areas).toEqual(eager.areas);
    expect(world.pending).toEqual([]);
    expect(world.areaOf).toEqual(eager.areaOf);
  });

  it("places an area by the order it was asked for, nothing else", () => {
    const direct = storeOf();
    direct.ensure("four");
    const later = storeOf();
    later.ensure("three");
    later.ensure("four");
    const [ahead, behind] = [later, direct].map((store) =>
      store.snapshot().world.areas.find((area) => area.id === "four")
    );
    expect(ahead?.offset).not.toEqual(behind?.offset);
    expect(untranslated(ahead)).toEqual(untranslated(behind));
    expect(ahead?.graph).toEqual(behind?.graph);
  });

  it("passes checkAreas after every ensure, in every order a walk allows", () => {
    const leadsTo = new Map(
      graphs.map(([id, graph]) => [
        id,
        [
          ...new Set(
            (graph.external ?? []).map(
              (unit) =>
                graphs.find(([, g]) =>
                  g.rooms.some((room) => room.id === unit)
                )?.[0] ?? ""
            )
          ),
        ],
      ])
    );
    const orders = walks(["one"], ["two", "three", "four"], leadsTo);
    expect(orders).toEqual([
      ["two", "three", "four"],
      ["two", "four", "three"],
    ]);
    for (const seed of [1, 2, 3]) {
      for (const order of orders) {
        const store = storeOf(seed);
        for (const id of order) {
          store.ensure(id);
          expect(
            checkAreas(store.snapshot().world),
            `seed ${seed} ${order.join(",")} at ${id}`
          ).toEqual([]);
        }
      }
    }
  });

  it("remembers an area that fails and leaves the others intact", () => {
    const calls = new Map<string, number>();
    const failing = specsOf(1, calls).map((spec): AreaSpec =>
      spec.id === "three"
        ? {
            ...spec,
            generate: () => {
              calls.set("three", (calls.get("three") ?? 0) + 1);
              throw new LayoutError({ from: "hub3", to: "nowhere" });
            },
          }
        : spec
    );
    const store = createAreaStore({ seed: 1, entry: "one", specs: failing });
    store.ensure("two");
    const result = store.ensure("three");
    expect("error" in result ? result.error : "").toContain("hub3 -> nowhere");
    expect(store.ensure("three")).toEqual(result);
    expect(calls.get("three")).toBe(1);
    const { world, errors } = store.snapshot();
    expect(ids(world.areas)).toEqual(["one", "two"]);
    expect(world.pending).toEqual(["four"]);
    expect(errors.get("three")).toEqual(
      expect.stringContaining("hub3 -> nowhere")
    );
    store.ensure("four");
    expect(ids(store.snapshot().world.areas)).toEqual(["one", "two", "four"]);
  });

  it("answers an unknown area with an error and changes nothing", () => {
    const store = storeOf();
    const before = store.snapshot();
    expect(store.ensure("nowhere")).toEqual({
      error: 'Unknown area "nowhere"',
    });
    expect(store.snapshot()).toBe(before);
  });

  it("throws when the entry cannot be generated or does not exist", () => {
    expect(() =>
      createAreaStore({ seed: 1, entry: "missing", specs: specsOf(1) })
    ).toThrow('Unknown entry area "missing"');
    const broken = specsOf(1).map((spec): AreaSpec =>
      spec.id === "one"
        ? {
            ...spec,
            generate: () => {
              throw new Error("no layout");
            },
          }
        : spec
    );
    expect(() =>
      createAreaStore({ seed: 1, entry: "one", specs: broken })
    ).toThrow("no layout");
  });

  it("stops notifying a listener once unsubscribed", () => {
    const store = storeOf();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    unsubscribe();
    store.ensure("two");
    expect(notified).toBe(0);
  });
});
