/**
 * Shown by either page while the world's files are on their way (`loading`)
 * or a repository the user brought is being parsed (`analysing`).
 */
const WorldLoading = ({
  label,
  phase,
}: {
  readonly label: string | null;
  readonly phase: "loading" | "analysing";
}) => (
  <div
    className="flex h-dvh w-screen items-center justify-center bg-black font-mono text-xs text-amber-100/70"
    data-state="loading"
  >
    <p>
      {phase} {label ?? "world"}…
    </p>
  </div>
);

export { WorldLoading };
