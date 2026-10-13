import { bakeLightmap } from "./bake";
import type { BakeResponse } from "./bake-client";
import { readBakeJob } from "./bake-job";

// Bakes area lightmaps off the main thread, one job per message. The answer
// carries the job's id; the texels move rather than copy.

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  // Only the page that made this worker can post to it, and its messages
  // carry no origin; anything else is not ours to answer.
  if (event.origin !== "" && event.origin !== globalThis.location.origin) {
    return;
  }
  const id = Number(
    typeof event.data === "object" && event.data !== null && "id" in event.data
      ? event.data.id
      : Number.NaN
  );
  let response: BakeResponse;
  try {
    const job = readBakeJob(
      typeof event.data === "object" &&
        event.data !== null &&
        "job" in event.data
        ? event.data.job
        : null
    );
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
