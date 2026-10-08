# @repo/renderer

React Three Fiber components, player and lights for a built world.

```tsx
import { PointerLook } from "@repo/renderer/controls";
import { Player } from "@repo/renderer/player";
import { World } from "@repo/renderer/world";

<Canvas shadows="percentage">
  <World world={built} />
  <Player world={built} enabled={locked} />
  <PointerLook onLock={...} onUnlock={...} />
</Canvas>;
```

Each room is five draw calls (merged walls and lintels, floor, ceiling, merged
fixtures); every door frame in the world is one more. Lighting is a fixed
pool of eight point lights that follow the player to the nearest fixtures, so
shaders compile once, and a single static shadow map that re-renders only
when the shadow light hops to another fixture.
