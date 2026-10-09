# @repo/renderer

React Three Fiber components, player and lights for a built world.

```tsx
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";

<Canvas shadows="percentage">
  <World world={built} />
  <Player world={built} enabled={locked} onRoomChange={setRoomId} />
  <PointerLook />
</Canvas>;
```

`onRoomChange` fires from the render loop only when the player crosses into
another room or corridor (and once for the start room), so a state setter is a
fine handler. `onPortal` fires once when the player walks into a portal's
trigger strip while facing it, `onNearTarget` when the door or portal in
front of them changes, and `placement` (a position, a facing point and a
nonce) puts the player somewhere else when it changes.

Each room is five draw calls (merged walls and lintels, floor, ceiling, merged
fixtures); every door frame in the world is one more, and the portals add
one frame mesh plus one dark plane mesh per kind. Lighting is a fixed
pool of eight point lights that follow the player to the nearest fixtures, so
shaders compile once, and a single static shadow map that re-renders only
when the shadow light hops to another fixture.
