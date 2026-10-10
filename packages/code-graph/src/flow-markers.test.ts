import { describe, expect, it } from "vitest";

import type {
  BranchNode,
  CallSite,
  CodeGraph,
  FlowStep,
  SourceSpan,
} from "./code-graph";
import { replaceComposite } from "./flow-budget";
import { clusterOf, FN, fnWith, site, switchNode, valid } from "./flow-fixture";
import { layoutFlow, planFlow } from "./flow-layout";
import { indexSites } from "./flow-text";
import { measureTree } from "./flow-tree";
import { markerPortalId } from "./ids";
import { portalSubject } from "./subjects";
import { toWorldGraph } from "./world-graph";

const spanOf = (start: number, end: number): SourceSpan => ({
  start,
  end,
  startLine: 1,
  startColumn: start,
  endLine: 1,
  endColumn: end,
});

/** A call the world cannot follow, at [start, start + 3). */
const open = (start: number): CallSite => ({
  id: `${FN}@${start}`,
  callerId: FN,
  calleeName: `x${start}`,
  calleeId: null,
  resolution: "external",
  kind: "call",
  awaited: false,
  span: spanOf(start, start + 3),
});

/** A plain statement spanning [start, end). */
const stepIn = (start: number, end: number): FlowStep => ({
  id: `${FN}@${start}:step`,
  kind: "step",
  span: spanOf(start, end),
  statements: 1,
});

/** A statement spanning [start, end) calling the resolved `sites`. */
const callIn = (
  start: number,
  end: number,
  sites: readonly CallSite[]
): FlowStep => ({
  id: `${FN}@${start}:call`,
  kind: "call",
  span: spanOf(start, end),
  callSiteIds: sites.map((item) => item.id),
});

/** `if` over [start, end) with no `else`: the alternate spans the whole branch. */
const branchIn = (
  start: number,
  end: number,
  then: readonly FlowStep[]
): BranchNode => ({
  id: `${FN}@${start}:branch`,
  kind: "branch",
  span: spanOf(start, end),
  condition: "x",
  callSiteIds: [],
  consequent: {
    id: `${FN}@${start}:sequence:then`,
    kind: "sequence",
    span: spanOf(start, end),
    steps: then,
  },
  alternate: {
    id: `${FN}@${start}:sequence:else`,
    kind: "sequence",
    span: spanOf(start, end),
    steps: [],
  },
});

const markersIn = (cluster: ReturnType<typeof clusterOf>, roomId: string) =>
  cluster.portals.filter(
    (portal) => portal.roomId === roomId && portal.kind === "marker"
  );

describe("markers", () => {
  it("gives a room with open calls one marker; alone it needs 3 m", () => {
    const room = `${FN}@200:step`;
    const cluster = valid(
      clusterOf([stepIn(100, 120), stepIn(200, 220)], [open(205), open(210)])
    );
    const rect = cluster.rooms.find((item) => item.id === room)?.rect;
    expect(rect === undefined ? null : rect.maxZ - rect.minZ).toBe(3);
    const [marker, ...others] = markersIn(cluster, room);
    expect(others).toEqual([]);
    expect(marker).toMatchObject({
      id: markerPortalId(room),
      kind: "marker",
      along: (rect?.minZ ?? 0) + 1.5,
      label: "2 calls",
    });
    expect(marker).not.toHaveProperty("target");
    expect(markersIn(cluster, `${FN}@100:step`)).toEqual([]);
  });

  it("hangs the marker after the call portals, on the next wall", () => {
    const sites = [site(301, "g1"), site(305, "g2"), site(309, "g3")];
    const room = `${FN}@300:call`;
    const cluster = valid(
      clusterOf(
        [stepIn(100, 120), callIn(300, 340, sites)],
        [...sites, open(320)]
      )
    );
    // The last room's return portal stays on its south wall.
    const portals = cluster.portals.filter(
      (portal) => portal.roomId === room && portal.kind !== "return"
    );
    expect(portals.map((portal) => portal.kind)).toEqual(["call", "marker"]);
    const [call, marker] = portals;
    expect(marker?.wall).not.toBe(call?.wall);
    expect(["east", "west"]).toContain(marker?.wall);
  });

  it("puts a boxed lane's marker on its south wall, within its width", () => {
    const sites = [site(301, "g1"), site(305, "g2")];
    const room = `${FN}@300:call`;
    const cluster = valid(
      clusterOf(
        [
          switchNode(1, [
            {
              labels: ["case 1"],
              body: [stepIn(50, 60)],
              fallsThrough: true,
            },
            {
              labels: ["case 2"],
              body: [callIn(300, 340, sites)],
              fallsThrough: true,
            },
            { labels: ["case 3"], body: [stepIn(70, 80)] },
            { labels: ["default"], body: [stepIn(90, 95)] },
          ]),
        ],
        [...sites, open(320)]
      )
    );
    expect(
      cluster.portals
        .filter((portal) => portal.roomId === room)
        .map((portal) => [portal.kind, portal.wall])
    ).toEqual([
      ["call", "south"],
      ["call", "south"],
      ["marker", "south"],
    ]);
  });

  it("gives a composite's header calls to its head, even with no else", () => {
    const fn = fnWith([stepIn(10, 20), branchIn(100, 200, [stepIn(110, 120)])]);
    const plan = planFlow(fn, [open(105), open(112)]);
    expect(plan.markers).toEqual(
      new Map([
        [`${FN}@100:branch`, [`${FN}@105`]],
        [`${FN}@110:step`, [`${FN}@112`]],
      ])
    );
  });

  it("gives the strays to the entry room, collapsed by the budget or not", () => {
    // @5 lies in no statement: a default parameter's call.
    const fn = fnWith([branchIn(100, 200, [stepIn(110, 120)])]);
    const sites = indexSites([open(5), open(150)], fn.flow);
    expect(sites.strays).toEqual([`${FN}@5`]);
    const items = measureTree(fn, sites);
    const [fork] = items;
    expect(fork?.kind === "fork" ? fork.head.markers : null).toEqual([
      `${FN}@5`,
      `${FN}@150`,
    ]);
    const collapsed =
      fork === undefined || fork.kind === "room"
        ? []
        : replaceComposite(items, fork, sites, true);
    expect(collapsed[0]).toMatchObject({
      role: "collapsed",
      markers: [`${FN}@5`, `${FN}@150`],
    });
    expect(
      measureTree(fnWith([]), indexSites([open(5)], fnWith([]).flow))[0]
    ).toMatchObject({ label: "empty body", markers: [`${FN}@5`] });
  });

  it("keeps every open call when the budget folds rooms together", () => {
    const steps = Array.from({ length: 70 }, (_, index) =>
      stepIn(1000 + index * 10, 1000 + index * 10 + 8)
    );
    const sites = steps.map((_, index) => open(1000 + index * 10 + 2));
    const plan = planFlow(fnWith(steps), sites);
    expect(plan.folds.size).toBeGreaterThan(0);
    const shown = [...plan.markers.values()].flat();
    expect(shown.toSorted()).toEqual(sites.map((item) => item.id).toSorted());
    expect(
      [...plan.markers.values()].some((markers) => markers.length > 1)
    ).toBe(true);
    const cluster = valid(layoutFlow(plan));
    expect(
      cluster.portals.filter((portal) => portal.kind === "marker")
    ).toHaveLength(plan.markers.size);
  });

  it("names a marker's calls and puts it on its own room in the graph", () => {
    const fn = fnWith([stepIn(100, 120)]);
    const graph: CodeGraph = {
      modules: [
        {
          id: "m.ts",
          path: "m.ts",
          language: "typescript",
          lineCount: 1,
          imports: [],
          exports: [],
        },
      ],
      functions: [fn],
      callSites: [open(105)],
      edges: [],
    };
    const room = `${FN}@100:step`;
    expect(portalSubject(graph, markerPortalId(room))).toMatchObject({
      kind: "marker",
      fn: { id: FN },
      roomId: room,
      sites: [{ id: `${FN}@105` }],
    });
    expect(
      toWorldGraph(graph).portals?.filter((portal) => portal.kind === "marker")
    ).toEqual([
      {
        id: markerPortalId(room),
        kind: "marker",
        from: room,
        to: room,
        label: "1 call",
      },
    ]);
  });
});
