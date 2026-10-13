import { bakeLightmap } from "./bake";
import type { BakeRequest, BakeResponse } from "./bake-client";

// Bakes area lightmaps off the main thread, one job per message. The answer
// carries the job's id; the texels move rather than copy.

globalThis.addEventListener("message", (event: MessageEvent<BakeRequest>) => {
  const { id, job } = event.data;
  let response: BakeResponse;
  try {
    response = { id, lightmap: bakeLightmap(job) };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  globalThis.postMessage(response, {
    transfer: "lightmap" in response ? [response.lightmap.data.buffer] : [],
  });
});
