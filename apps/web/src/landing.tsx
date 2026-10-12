import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { filesFromFolder } from "~/folder-files";
import {
  createReadGuard,
  folderLabel,
  isZipName,
  readErrorMessage,
  zipLabel,
} from "~/local-reads";
import type { SourceRequest } from "~/source-request";
import { readZipFile } from "~/zip-files";
import type { LocalFiles } from "~/zip-files";

// The bare URL's page: bring a repository as a zip or a folder, or open this
// one (`?code=self`). Files are read in the tab and never leave it.

/** Bundled examples linked under the Demo button. */
const EXAMPLES: readonly string[] = ["demo", "loops", "switches", "repo"];

const HINTS = "WASD move · mouse look · E source · Tab world map · Esc release";

const BUTTON =
  "cursor-pointer rounded border border-amber-100/30 px-3 py-1 hover:bg-amber-100/10 has-disabled:cursor-default has-disabled:opacity-40";

type LandingViewProps = {
  /** The zip or folder being read, or null. */
  readonly reading: string | null;
  readonly error: string | null;
  readonly dragging: boolean;
  readonly onZip: (file: File) => void;
  readonly onFolder: (files: readonly File[]) => void;
  readonly onDragging: (dragging: boolean) => void;
};

/** The picked files, copied out before the input is reset. */
const takeFiles = (event: ChangeEvent<HTMLInputElement>): File[] => {
  const files = [...(event.currentTarget.files ?? [])];
  // Picking the same file again still fires a change.
  event.currentTarget.value = "";
  return files;
};

/** A link, or plain text while a read runs: an anchor would still follow Enter. */
const PageLink = ({
  href,
  disabled,
  className,
  children,
}: {
  readonly href: string;
  readonly disabled: boolean;
  readonly className: string;
  readonly children: string;
}) =>
  disabled ? (
    <span className={`${className} opacity-40`}>{children}</span>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );

/** The landing page as markup, its state passed in. */
const LandingView = ({
  reading,
  error,
  dragging,
  onZip,
  onFolder,
  onDragging,
}: LandingViewProps) => {
  const busy = reading !== null;
  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    onDragging(!busy);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    onDragging(false);
    const [file] = event.dataTransfer.files;
    if (!busy && file !== undefined) {
      onZip(file);
    }
  };
  return (
    <main
      className="flex min-h-dvh w-screen flex-col items-center justify-center gap-8 bg-black px-6 py-10 font-mono text-sm text-amber-100/80"
      data-state="landing"
    >
      <div className="flex max-w-prose flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-50">
          Code Backrooms
        </h1>
        <p>
          Walk through a codebase: modules become areas, functions become rooms,
          calls become doors.
        </p>
      </div>
      <section
        aria-label="Load a repository"
        className={`flex w-full max-w-lg flex-col items-center gap-4 rounded border border-dashed px-6 py-8 text-center ${
          dragging ? "border-amber-200 bg-amber-100/10" : "border-amber-100/30"
        }`}
        onDragOver={onDragOver}
        onDragLeave={() => onDragging(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <p className="animate-pulse">reading {reading}…</p>
        ) : (
          <p>drop a .zip of a repository here</p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <label className={BUTTON}>
            choose zip
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const [file] = takeFiles(event);
                if (file !== undefined) {
                  onZip(file);
                }
              }}
            />
          </label>
          <label className={BUTTON}>
            choose folder
            <input
              type="file"
              multiple
              // React's types omit it; the browser reads the attribute.
              {...{ webkitdirectory: "" }}
              className="sr-only"
              disabled={busy}
              onChange={(event) => onFolder(takeFiles(event))}
            />
          </label>
        </div>
        {error !== null && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <p className="text-xs text-amber-100/50">
          read in this tab only · up to 400 source files, 8 MB
        </p>
      </section>
      <div className="flex flex-col items-center gap-2">
        <PageLink
          href="?code=self"
          disabled={busy}
          className="rounded bg-amber-100/15 px-4 py-1.5 text-amber-50 hover:bg-amber-100/25"
        >
          Demo: walk this repository
        </PageLink>
        <p className="flex gap-3 text-xs">
          examples:
          {EXAMPLES.map((name) => (
            <PageLink
              key={name}
              href={`?code=${name}`}
              disabled={busy}
              className="underline decoration-amber-100/30 hover:text-amber-50"
            >
              {name}
            </PageLink>
          ))}
        </p>
      </div>
      <p className="text-xs text-amber-100/50">{HINTS}</p>
    </main>
  );
};

/** The landing page: reads a zip or folder, then hands its files to `onLoad`. */
const Landing = ({
  onLoad,
}: {
  readonly onLoad: (request: SourceRequest) => void;
}) => {
  const [reading, setReading] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const guard = useMemo(() => createReadGuard(), []);

  // A read that ends after the page is gone never loads a world.
  useEffect(() => () => guard.cancel(), [guard]);

  const read = useCallback(
    (name: string, label: string, load: () => Promise<LocalFiles>) => {
      if (reading !== null) {
        return;
      }
      const id = guard.start();
      setReading(name);
      setFailure(null);
      void load().then(
        ({ files, skipped }) => {
          if (guard.isCurrent(id)) {
            onLoad({ kind: "local", label, files, skipped });
          }
        },
        (error: unknown) => {
          if (guard.isCurrent(id)) {
            setReading(null);
            setFailure(readErrorMessage(error));
          }
        }
      );
    },
    [reading, guard, onLoad]
  );

  const onZip = useCallback(
    (file: File) => {
      if (!isZipName(file.name)) {
        setFailure("drop a .zip file (use choose folder for folders)");
        return;
      }
      read(file.name, zipLabel(file.name), () => readZipFile(file));
    },
    [read]
  );

  const onFolder = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) {
        return;
      }
      const label = folderLabel(files);
      read(label, label, () => filesFromFolder(files));
    },
    [read]
  );

  return (
    <LandingView
      reading={reading}
      error={failure}
      dragging={dragging}
      onZip={onZip}
      onFolder={onFolder}
      onDragging={setDragging}
    />
  );
};

export { Landing, LandingView };
