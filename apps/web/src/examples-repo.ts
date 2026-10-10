import type { SourceFile } from "@repo/parser";

// A small repository: calls cross files through named, default and
// namespace-free imports, a barrel (`export *` and an alias), a TS-style
// `.js` specifier, a directory index and one package import.

const index: SourceFile = {
  path: "src/index.ts",
  source: `import { startServer } from "./server";
import config from "./config";

function main() {
  startServer(config.port);
}

main();
`,
};

const config: SourceFile = {
  path: "src/config.ts",
  source: `export function loadConfig() {
  return { port: 3000 };
}

export default loadConfig();
`,
};

const server: SourceFile = {
  path: "src/server.ts",
  source: `import { handleRequest, renderPage } from "./handlers";
import { log } from "./util/log.js";

export function startServer(port: number) {
  log("listening", port);
  const request = { path: "/" };
  handleRequest(request);
  renderPage(request.path);
}
`,
};

const handlers: SourceFile = {
  path: "src/handlers/index.ts",
  source: `export * from "./auth";
export { render as renderPage } from "./render";
`,
};

const auth: SourceFile = {
  path: "src/handlers/auth.ts",
  source: `import { render } from "./render";

export class Session {
  constructor(readonly user: string) {}

  static open(user: string) {
    return new Session(user);
  }

  refresh() {}
}

export function handleRequest(request: { path: string }) {
  const session = Session.open("guest");
  session.refresh();
  return render(request.path);
}
`,
};

const render: SourceFile = {
  path: "src/handlers/render.ts",
  source: `export function render(path: string) {
  return \`<h1>\${path}</h1>\`;
}
`,
};

const log: SourceFile = {
  path: "src/util/log.ts",
  source: `import { format } from "node:util";

export function log(...parts: unknown[]) {
  console.log(format(...parts));
}
`,
};

/** In the order a reader would open them; the parser sorts by path anyway. */
const repo: readonly SourceFile[] = [
  index,
  config,
  server,
  handlers,
  auth,
  render,
  log,
];

export { repo };
