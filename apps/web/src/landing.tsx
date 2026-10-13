import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ReactNode } from "react";

import { backdropAllowed } from "~/backdrop";
import { filesFromFolder } from "~/folder-files";
import { readGitHubRepo } from "~/github-files";
import { GitHubForm } from "~/github-form";
import type { GitHubField } from "~/github-form";
import { gitHubPath, parseGitHubUrl } from "~/github-url";
import { createReadGuard, folderLabel, readErrorMessage } from "~/local-reads";
import { searchOfRepo } from "~/source-request";
import type { SourceRequest } from "~/source-request";
import { TurnstileCheck, turnstileSiteKey } from "~/turnstile";
import type { LocalFiles } from "~/zip-files";

// The bare URL's page: paste a public GitHub URL, pick a local folder, or
// open this repository (`?code=self`). A GitHub repository comes through this
// site's Worker (`api/`) as one zip download; a folder is read in the tab and
// never leaves it.

/** Bundled examples linked under the Demo button. */
const EXAMPLES: readonly string[] = ["demo", "loops", "switches", "repo"];

const HINTS =
  "WASD move · Shift sprint · mouse look · E source · Tab world map · Backspace back · Q quality · Esc release";

// The demo world drifting behind the page: its own chunk, fetched after the
// page has painted, so the pickers never wait for three.js.
const LandingBackdrop = lazy(() =>
  import("~/landing-backdrop").then((m) => ({ default: m.LandingBackdrop }))
);

/** Whether this browser should run the backdrop at all. */
const supportsBackdrop = (): boolean => {
  const probe = document.createElement("canvas").getContext("webgl2");
  // Hand the probe's context back now rather than when it is collected.
  probe?.getExtension("WEBGL_lose_context")?.loseContext();
  return backdropAllowed({ webgl2: probe !== null });
};

/** Renders nothing once its child throws: a failed backdrop is no error. */
class BackdropBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The backdrop, once the page has painted and only where it may run. */
const useBackdrop = (): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(supportsBackdrop()), 0);
    return () => clearTimeout(timer);
  }, []);
  return shown;
};

const BUTTON =
  "cursor-pointer rounded border border-amber-100/30 px-3 py-1 hover:bg-amber-100/10 has-disabled:cursor-default has-disabled:opacity-40";

const LINK =
  "cursor-pointer underline decoration-amber-100/30 hover:text-amber-50 has-disabled:cursor-default has-disabled:opacity-40";

/**
 * How long the backdrop takes to darken once a read starts. A read never
 * hands over sooner, so even a quick one fades into the black loading screen
 * instead of cutting to it.
 */
const FADE_MS = 300;

type LandingViewProps = {
  /** What is being read, as the line to show ("downloading o/r…"), or null. */
  readonly reading: string | null;
  readonly error: string | null;
  readonly onFolder: (files: readonly File[]) => void;
  /** The GitHub field; absent when this build has no Turnstile key. */
  readonly github?: GitHubField;
  /** Drawn behind the page; none in tests and where WebGL cannot run. */
  readonly backdrop?: ReactNode;
};

/** The picked files, copied out before the input is reset. */
const takeFiles = (event: ChangeEvent<HTMLInputElement>): File[] => {
  const files = [...(event.currentTarget.files ?? [])];
  // Picking the same folder again still fires a change.
  event.currentTarget.value = "";
  return files;
};

/** A folder picker styled by `className`: a button or a quiet link. */
const FolderPicker = ({
  busy,
  className,
  onFolder,
  children,
}: {
  readonly busy: boolean;
  readonly className: string;
  readonly onFolder: (files: readonly File[]) => void;
  readonly children: string;
}) => (
  <label className={className}>
    {children}
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
);

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
  onFolder,
  github,
  backdrop,
}: LandingViewProps) => {
  const busy = reading !== null;
  return (
    <main
      className="relative isolate flex min-h-dvh w-screen flex-col items-center justify-center gap-8 overflow-hidden bg-black px-6 py-10 font-mono text-sm text-amber-100/80"
      data-state="landing"
    >
      {backdrop !== undefined && (
        <div aria-hidden className="absolute inset-0 -z-10">
          {backdrop}
          <div
            className={`absolute inset-0 bg-black transition-opacity duration-300 ${
              busy ? "opacity-90" : "opacity-45"
            }`}
          />
        </div>
      )}
      <div className="flex max-w-prose flex-col gap-2 text-center drop-shadow">
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
        className="flex w-full max-w-lg flex-col items-center gap-4 rounded border border-amber-100/30 bg-black/60 px-6 py-6 text-center backdrop-blur-sm"
      >
        {github === undefined ? (
          <FolderPicker busy={busy} className={BUTTON} onFolder={onFolder}>
            choose a folder
          </FolderPicker>
        ) : (
          <GitHubForm field={github} busy={busy} />
        )}
        {busy && <p className="animate-pulse">{reading}</p>}
        {error !== null && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <p className="text-xs text-amber-100/50">
          {github === undefined
            ? "read in this tab, never uploaded"
            : "public repositories"}{" "}
          · up to 400 source files, 8 MB
        </p>
      </section>
      {github !== undefined && (
        <p className="-mt-4 text-xs text-amber-100/60">
          or{" "}
          <FolderPicker busy={busy} className={LINK} onFolder={onFolder}>
            walk a local folder
          </FolderPicker>
          , read in this tab and never uploaded
        </p>
      )}
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

/**
 * The landing page: reads a GitHub repository or a folder, then hands its
 * files to `onLoad`. `initialRepo` fills the GitHub field (`?repo=`, a shared
 * link) and opens it as soon as the visitor's Turnstile check passes, once.
 */
const Landing = ({
  onLoad,
  initialRepo,
}: {
  readonly onLoad: (request: SourceRequest) => void;
  readonly initialRepo: string;
}) => {
  const [reading, setReading] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [token, setToken] = useState<string | null>(null);
  // The same token, taken synchronously: an auto-open and a click in the
  // same tick must not both spend it.
  const unspent = useRef<string | null>(null);
  // A shared `?repo=` link opens once its check passes, unless edited first.
  const autoOpen = useRef(parseGitHubUrl(initialRepo) !== null);
  // Bumped to remount the check after each use: a token is accepted once.
  const [checkRound, setCheckRound] = useState(0);
  const download = useRef<AbortController | null>(null);
  const guard = useMemo(() => createReadGuard(), []);
  const siteKey = useMemo(() => turnstileSiteKey(), []);
  const backdrop = useBackdrop();

  // A read that ends after the page is gone never loads a world.
  useEffect(
    () => () => {
      guard.cancel();
      download.current?.abort();
    },
    [guard]
  );

  const read = useCallback(
    (status: string, label: string, load: () => Promise<LocalFiles>) => {
      if (reading !== null) {
        return;
      }
      const id = guard.start();
      setReading(status);
      setFailure(null);
      const faded = new Promise((resolve) => setTimeout(resolve, FADE_MS));
      void Promise.all([load(), faded]).then(
        ([{ files, skipped }]) => {
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

  const onFolder = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) {
        return;
      }
      const label = folderLabel(files);
      read(`reading ${label}…`, label, () => filesFromFolder(files));
    },
    [read]
  );

  const onToken = useCallback((next: string | null) => {
    unspent.current = next;
    setToken(next);
  }, []);

  const target = useMemo(() => parseGitHubUrl(repoUrl), [repoUrl]);

  const onRepo = useCallback(() => {
    // The button is disabled until both hold; Enter is checked the same way.
    const spent = unspent.current;
    if (target === null || spent === null || reading !== null) {
      return;
    }
    unspent.current = null;
    autoOpen.current = false;
    const path = gitHubPath(target);
    const controller = new AbortController();
    download.current = controller;
    setToken(null);
    setCheckRound((round) => round + 1);
    read(`downloading ${path} from GitHub…`, path, async () => {
      const files = await readGitHubRepo(target, spent, {
        fetch: (url, init) => globalThis.fetch(url, init),
        signal: controller.signal,
      });
      // The address bar is now this world's share link.
      globalThis.history.replaceState(null, "", searchOfRepo(path));
      return files;
    });
  }, [target, reading, read]);

  // A shared link opens by itself once the check hands over a token.
  useEffect(() => {
    if (autoOpen.current && token !== null) {
      onRepo();
    }
  }, [token, onRepo]);

  const github: GitHubField | undefined =
    siteKey === null
      ? undefined
      : {
          url: repoUrl,
          onUrl: (url) => {
            autoOpen.current = false;
            setRepoUrl(url);
            setFailure(null);
          },
          onOpen: onRepo,
          valid: target !== null,
          ready: target !== null && token !== null,
          check: (
            <TurnstileCheck
              key={checkRound}
              siteKey={siteKey}
              onToken={onToken}
            />
          ),
        };

  return (
    <LandingView
      reading={reading}
      error={failure}
      onFolder={onFolder}
      github={github}
      // Kept, darkened, through the read: the page unmounts on `onLoad`, which
      // frees the GPU before the world is parsed.
      backdrop={
        backdrop ? (
          <BackdropBoundary>
            <Suspense fallback={null}>
              <LandingBackdrop />
            </Suspense>
          </BackdropBoundary>
        ) : undefined
      }
    />
  );
};

export { Landing, LandingView };
