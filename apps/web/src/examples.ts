import type { SourceFile } from "@repo/parser";

// Bundled programs the app can turn into rooms with `?code=<name>`. Editing a
// source here regenerates the world on reload, which is the whole point:
// the rooms come from the code, not the other way round.

/** The reference demo from the product plan: a branch and a call chain. */
const demo: SourceFile = {
  path: "demo.ts",
  source: `function main() {
  const user = getUser();

  if (user) {
    showDashboard();
  } else {
    showLogin();
  }
}

function getUser() {
  return loadSession();
}

function showDashboard() {}

function showLogin() {}

function loadSession() {}
`,
};

/** A straight chain of calls: three rooms in a row. */
const chain: SourceFile = {
  path: "chain.ts",
  source: `function main() {
  login();
}

function login() {
  validateUser();
}

function validateUser() {}
`,
};

/** Two unrelated functions: two rooms off the file's hub. */
const pair: SourceFile = {
  path: "pair.ts",
  source: `function foo() {}

function bar() {}
`,
};

/** Methods as rooms: this.*, static and constructor calls resolve. */
const service: SourceFile = {
  path: "service.ts",
  source: `class UserService {
  constructor(private readonly rows: string[]) {}

  static create() {
    return new UserService([]);
  }

  load() {
    const rows = this.fetchRows();
    return rows.map((row) => this.parse(row));
  }

  fetchRows() {
    return this.rows;
  }

  parse(row: string) {
    return row.trim();
  }
}

function main() {
  const service = UserService.create();
  const other = new UserService(["a"]);
  service.load();
  other.load();
}
`,
};

/** Runtime calls are external markers, not doors; one room per function. */
const external: SourceFile = {
  path: "external.ts",
  source: `async function main() {
  console.log("starting");
  const config = JSON.parse("{}");
  const response = await fetch("/api");
  setTimeout(() => tick(), 100);
  const cache = new Map();
  return [config, response, cache];
}

function tick() {
  console.log(Date.now());
}
`,
};

/**
 * Three callers of one function (one door, two portals) and a recursive
 * function (a portal back into its own room).
 */
const portals: SourceFile = {
  path: "portals.ts",
  source: `function main() {
  const a = load("a");
  const b = render(a);
  countdown(3);
  return format(b);
}

function load(key: string) {
  return format(key);
}

function render(value: string) {
  return format(value);
}

function format(value: string) {
  return value.trim();
}

function countdown(n: number): number {
  if (n === 0) {
    return 0;
  }
  return countdown(n - 1);
}
`,
};

const examples = { demo, chain, pair, service, external, portals } as const;

type ExampleName = keyof typeof examples;

const isExampleName = (name: string): name is ExampleName =>
  Object.hasOwn(examples, name);

export { examples, isExampleName };
export type { ExampleName };
