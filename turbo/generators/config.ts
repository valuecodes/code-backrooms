import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlopTypes } from "@turbo/gen";

// Workspace globs from `pnpm-workspace.yaml`. A new package name must not
// collide with any of them, not just with directories under `packages/`.
const WORKSPACE_DIRS = ["apps", "packages", "tooling"];

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// The `### Packages` heading, then the table header and separator rows.
const PACKAGES_TABLE =
  /^### Packages \(`packages\/`\)\n\n\|.*\|\n\|[- |]+\|\n/gm;

const workspaceNames = (root: string): Set<string> => {
  const names = new Set<string>();
  for (const dir of WORKSPACE_DIRS) {
    const base = path.join(root, dir);
    if (!existsSync(base)) {
      continue;
    }
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      names.add(entry.name);
      const manifest = path.join(base, entry.name, "package.json");
      if (existsSync(manifest)) {
        const { name } = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: unknown;
        };
        if (typeof name === "string") {
          names.add(name);
        }
      }
    }
  }
  return names;
};

const validateName = (root: string, input: unknown): true | string => {
  if (typeof input !== "string" || !NAME_PATTERN.test(input)) {
    return "Use kebab-case (e.g. `http-client`), without the `@repo/` scope.";
  }
  const taken = workspaceNames(root);
  if (taken.has(input) || taken.has(`@repo/${input}`)) {
    return `A workspace named \`${input}\` already exists.`;
  }
  return true;
};

const validateDescription = (input: unknown): true | string => {
  if (typeof input !== "string" || input.trim() === "") {
    return "A one-line description is required.";
  }
  // It becomes a Markdown table cell in AGENTS.md.
  if (/[\n\r|]/.test(input)) {
    return "Keep it to one line, without `|`.";
  }
  return true;
};

// Returns AGENTS.md with a row for the new package appended to the Packages
// table. Spliced in literally (no regex replacement), and throws rather than
// silently skipping when the table cannot be found.
const withPackageRow = (
  content: string,
  name: string,
  description: string
): string => {
  const matches = [...content.matchAll(PACKAGES_TABLE)];
  const [match] = matches;
  if (matches.length !== 1 || match === undefined) {
    throw new Error(
      "Could not find exactly one Packages table in AGENTS.md; add the row by hand."
    );
  }
  const row = `| ${name} | \`@repo/${name}\` | ${description.trim()} |\n`;
  let end = match.index + match[0].length;
  while (content.startsWith("|", end)) {
    const newline = content.indexOf("\n", end);
    if (newline === -1) {
      // The table ends the file without a trailing newline.
      return `${content}\n${row}`;
    }
    end = newline + 1;
  }
  return content.slice(0, end) + row + content.slice(end);
};

const packageAnswers = (
  answers: PlopTypes.Answers
): { name: string; description: string } => {
  const { name, description } = answers;
  if (typeof name !== "string" || typeof description !== "string") {
    throw new TypeError("Expected `name` and `description` answers");
  }
  return { name, description };
};

const generator = (plop: PlopTypes.NodePlopAPI): void => {
  // This file lives at `<root>/turbo/generators/config.ts`.
  const root = path.resolve(plop.getPlopfilePath(), "..", "..");
  const agentsFile = path.join(root, "AGENTS.md");

  plop.setGenerator("package", {
    description:
      "Node library package in packages/, following @repo/logger's conventions",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (kebab-case, becomes @repo/<name>):",
        validate: (input: unknown) => validateName(root, input),
      },
      {
        type: "input",
        name: "description",
        message: "One-line description:",
        validate: validateDescription,
      },
    ],
    actions: [
      // Runs before anything is written, so a missing table fails cleanly
      // instead of leaving a half-registered package behind.
      (answers) => {
        const { name, description } = packageAnswers(answers);
        withPackageRow(readFileSync(agentsFile, "utf8"), name, description);
        return "AGENTS.md Packages table found";
      },
      {
        type: "addMany",
        destination: path.join(root, "packages", "{{ name }}"),
        base: "templates/package",
        templateFiles: "templates/package/**",
        stripExtensions: ["hbs"],
        globOptions: { dot: true },
      },
      (answers) => {
        const { name, description } = packageAnswers(answers);
        const content = readFileSync(agentsFile, "utf8");
        writeFileSync(agentsFile, withPackageRow(content, name, description));
        return "Added the package to AGENTS.md";
      },
      // Re-aligns the AGENTS.md table. Failure is reported, not fatal: every
      // file is already written, so rerunning the generator is not the fix.
      (answers) => {
        const { name } = packageAnswers(answers);
        try {
          execFileSync(
            "pnpm",
            ["exec", "prettier", "--write", "AGENTS.md", `packages/${name}`],
            { cwd: root, stdio: "ignore" }
          );
          return "Formatted. Next: run `pnpm install`";
        } catch {
          return "Prettier failed. Next: run `pnpm format` and `pnpm install`";
        }
      },
    ],
  });
};

export default generator;
