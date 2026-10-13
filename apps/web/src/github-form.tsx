import type { ReactNode, SubmitEvent } from "react";

// The landing page's GitHub row: a public repository's URL, the Turnstile
// check before it may load, and an open button. Markup only; `landing.tsx`
// holds the state.

/** The GitHub URL field's state; absent when this build has no Turnstile key. */
type GitHubField = {
  readonly url: string;
  readonly onUrl: (url: string) => void;
  readonly onOpen: () => void;
  /** The URL names a GitHub repository. */
  readonly valid: boolean;
  /** The URL is valid and the visitor passed the check. */
  readonly ready: boolean;
  /** The Turnstile widget, shown once the URL is valid. */
  readonly check: ReactNode;
};

/** A public repository's URL, its verification check and an open button. */
const GitHubForm = ({
  field,
  busy,
}: {
  readonly field: GitHubField;
  readonly busy: boolean;
}) => {
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy && field.ready) {
      field.onOpen();
    }
  };
  return (
    <form
      aria-label="Load from GitHub"
      className="flex w-full flex-col items-center gap-3"
      onSubmit={onSubmit}
    >
      <div className="flex w-full gap-2">
        <input
          type="text"
          inputMode="url"
          aria-label="GitHub repository URL"
          placeholder="github.com/owner/repo"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-amber-100/30 bg-black/60 px-3 py-1 text-amber-50 placeholder:text-amber-100/40"
          value={field.url}
          disabled={busy}
          onChange={(event) => field.onUrl(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="cursor-pointer rounded border border-amber-100/30 px-3 py-1 hover:bg-amber-100/10 disabled:cursor-default disabled:opacity-40"
          disabled={busy || !field.ready}
        >
          open
        </button>
      </div>
      {field.valid && !busy && field.check}
      {!field.valid && field.url.trim() !== "" && (
        <p className="text-xs text-amber-100/60">
          a public repository: github.com/owner/repo, or …/tree/branch/folder
          for one folder
        </p>
      )}
    </form>
  );
};

export { GitHubForm };
export type { GitHubField };
