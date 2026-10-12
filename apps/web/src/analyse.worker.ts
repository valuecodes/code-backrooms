import type { SourceFile } from "@repo/parser";

import { respond } from "~/analyse";

// Parses a repository the user brought off the main thread. One worker per
// repository: the page posts the files once and terminates the worker after.

globalThis.addEventListener(
  "message",
  (event: MessageEvent<readonly SourceFile[]>) => {
    globalThis.postMessage(respond(event.data));
  }
);
