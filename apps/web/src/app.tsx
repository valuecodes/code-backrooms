import { Canvas } from "@react-three/fiber";
import { useState } from "react";

import { PointerLook } from "~/game/controls";
import { buildWorld } from "~/game/geometry";
import { Player } from "~/game/player";
import { World } from "~/game/world";
import { worldData } from "~/game/world-data";
import { Hud } from "~/hud";

const world = buildWorld(worldData);

const App = () => {
  const [locked, setLocked] = useState(false);
  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black">
      <Canvas
        shadows="soft"
        dpr={[1, 1.5]}
        camera={{ fov: 75, near: 0.05, far: 60 }}
        gl={{ antialias: true }}
      >
        <World world={world} />
        <Player world={world} enabled={locked} />
        <PointerLook
          onLock={() => setLocked(true)}
          onUnlock={() => setLocked(false)}
        />
      </Canvas>
      <Hud locked={locked} />
    </div>
  );
};

export { App };
